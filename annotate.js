/*
 * Supporting documents: attaching pages to a form, marking them up, and writing them back out.
 *
 * The original pages are kept as they are. pdf.js renders each page to a canvas so there is
 * something to draw on and look at, but that canvas is only ever the view — the file that comes
 * out is built with pdf-lib from the untouched source pages, with the marks added as vector
 * shapes on top. Attached PDFs stay sharp at any zoom and stay searchable.
 *
 * A black box therefore covers text rather than deleting it: the words are still in the file
 * underneath. That is a deliberate, understood trade for keeping the documents intact.
 *
 * Both libraries load on demand — together they are over 2MB, and neither is needed until a
 * document is actually attached. The service worker precaches them, so this works offline.
 */
(function () {
  'use strict';

  const VIEW_SCALE = 1.6;     // how finely a page is rendered for the editor view
  const MAX_VIEW_EDGE = 1800;

  let pdfjsPromise = null;
  let pdflibPromise = null;

  function loadPdfJs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import('./vendor/pdf.min.mjs').then(lib => {
        lib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
        return lib;
      });
    }
    return pdfjsPromise;
  }

  function loadPdfLib() {
    if (!pdflibPromise) {
      pdflibPromise = window.PDFLib
        ? Promise.resolve(window.PDFLib)
        : new Promise((resolve, reject) => {
            const tag = document.createElement('script');
            tag.src = './vendor/pdf-lib.min.js';
            tag.onload = () => resolve(window.PDFLib);
            tag.onerror = () => reject(new Error('Couldn’t load the PDF writer.'));
            document.head.appendChild(tag);
          });
    }
    return pdflibPromise;
  }

  /* ---------- Reading a file ----------
   * `bytes` is the untouched original, kept for the output. `view` is a canvas, kept only so
   * the page can be seen and drawn on.
   */
  async function readFile(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    return isPdf ? readPdf(file, bytes) : readImage(file, bytes);
  }

  async function readPdf(file, bytes) {
    const pdfjs = await loadPdfJs();
    // pdf.js takes ownership of the buffer it is given, so it gets a copy
    const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const limit = Math.min(VIEW_SCALE, MAX_VIEW_EDGE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale: limit });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      pages.push({ view: canvas, annotations: [], width: base.width, height: base.height });
    }
    return { name: file.name, kind: 'pdf', bytes, pages };
  }

  function readImage(file, bytes) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const limit = Math.min(1, MAX_VIEW_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * limit);
        canvas.height = Math.round(img.naturalHeight * limit);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve({
          name: file.name,
          kind: /\.png$/i.test(file.name) || file.type === 'image/png' ? 'png' : 'jpg',
          bytes,
          pages: [{ view: canvas, annotations: [], width: img.naturalWidth, height: img.naturalHeight }],
        });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('that image couldn’t be read')); };
      img.src = url;
    });
  }

  /* ---------- Drawing on screen ----------
   * Marks are stored as fractions of the page, so the same numbers drive the on-screen canvas
   * and the vector output without either having to know the other's size.
   */
  function strokeWidthFor(page, a) {
    return Math.max(1, a.width * Math.min(page.width, page.height) / 700);
  }

  function pixelate(ctx, canvas, a) {
    const x = Math.round(a.x * canvas.width), y = Math.round(a.y * canvas.height);
    const w = Math.round(a.w * canvas.width), h = Math.round(a.h * canvas.height);
    if (w < 2 || h < 2) return;
    // Blocks sized from the region, and kept small — the old fixed divisor turned a wide
    // selection into a handful of enormous squares
    const block = Math.max(3, Math.round(Math.min(w, h) / 14));
    const cols = Math.max(1, Math.round(w / block));
    const rows = Math.max(1, Math.round(h / block));
    const small = document.createElement('canvas');
    small.width = cols;
    small.height = rows;
    small.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, cols, rows);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, cols, rows, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  function drawArrow(ctx, a, w, h, lineWidth) {
    const x1 = a.x1 * w, y1 = a.y1 * h, x2 = a.x2 * w, y2 = a.y2 * h;
    const head = Math.max(8, lineWidth * 4);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - Math.cos(angle) * head * 0.8, y2 - Math.sin(angle) * head * 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fillStyle = a.color;
    ctx.fill();
  }

  function drawAnnotation(ctx, canvas, page, a) {
    const w = canvas.width, h = canvas.height;
    const scale = w / page.width;               // page units to canvas pixels
    const lineWidth = Math.max(1, strokeWidthFor(page, a) * scale);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = a.color;
    ctx.lineWidth = lineWidth;

    if (a.type === 'pen' || a.type === 'highlight') {
      if (a.type === 'highlight') {
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = lineWidth * 4;
        ctx.lineCap = 'butt';
        ctx.globalCompositeOperation = 'multiply';
      }
      ctx.beginPath();
      a.points.forEach(([px, py], i) => {
        const x = px * w, y = py * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    } else if (a.type === 'rect' || a.type === 'ellipse') {
      const x = a.x * w, y = a.y * h, rw = a.w * w, rh = a.h * h;
      ctx.beginPath();
      if (a.type === 'rect') ctx.rect(x, y, rw, rh);
      else ctx.ellipse(x + rw / 2, y + rh / 2, Math.abs(rw / 2), Math.abs(rh / 2), 0, 0, Math.PI * 2);
      if (a.fill) { ctx.fillStyle = a.color; ctx.fill(); }
      else ctx.stroke();
    } else if (a.type === 'arrow') {
      drawArrow(ctx, a, w, h, lineWidth);
    } else if (a.type === 'pixelate') {
      pixelate(ctx, canvas, a);
    }
    ctx.restore();
  }

  function renderPage(target, page) {
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(page.view, 0, 0, target.width, target.height);
    page.annotations.forEach(a => drawAnnotation(ctx, target, page, a));
  }

  /* A pixelated patch has no vector equivalent, so that region alone becomes a small image */
  function pixelPatch(page, a) {
    const src = page.view;
    const x = Math.round(a.x * src.width), y = Math.round(a.y * src.height);
    const w = Math.round(a.w * src.width), h = Math.round(a.h * src.height);
    if (w < 2 || h < 2) return null;
    const patch = document.createElement('canvas');
    patch.width = w;
    patch.height = h;
    const pctx = patch.getContext('2d');
    pctx.drawImage(src, x, y, w, h, 0, 0, w, h);
    pixelate(pctx, patch, { x: 0, y: 0, w: 1, h: 1 });
    return patch;
  }

  /* ---------- Writing the output ---------- */
  function hexToRgb(PDFLib, hex) {
    const v = hex.replace('#', '');
    const n = parseInt(v.length === 3 ? v.split('').map(c => c + c).join('') : v, 16);
    return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  async function drawOnPdfPage(PDFLib, out, pdfPage, page) {
    const { width, height } = pdfPage.getSize();
    const sx = v => v * width;
    const sy = v => height - v * height;          // PDF y runs up from the bottom

    for (const a of page.annotations) {
      const colour = a.color ? hexToRgb(PDFLib, a.color) : PDFLib.rgb(0, 0, 0);
      const thickness = strokeWidthFor(page, a) * (width / page.width);

      if (a.type === 'pen' || a.type === 'highlight') {
        const highlight = a.type === 'highlight';
        for (let i = 1; i < a.points.length; i++) {
          pdfPage.drawLine({
            start: { x: sx(a.points[i - 1][0]), y: sy(a.points[i - 1][1]) },
            end: { x: sx(a.points[i][0]), y: sy(a.points[i][1]) },
            thickness: highlight ? thickness * 4 : thickness,
            color: colour,
            opacity: highlight ? 0.4 : 1,
            lineCap: highlight ? PDFLib.LineCapStyle.Butt : PDFLib.LineCapStyle.Round,
          });
        }
      } else if (a.type === 'rect') {
        pdfPage.drawRectangle({
          x: sx(a.x), y: sy(a.y + a.h), width: a.w * width, height: a.h * height,
          ...(a.fill ? { color: colour } : { borderColor: colour, borderWidth: thickness }),
        });
      } else if (a.type === 'ellipse') {
        pdfPage.drawEllipse({
          x: sx(a.x + a.w / 2), y: sy(a.y + a.h / 2),
          xScale: (a.w * width) / 2, yScale: (a.h * height) / 2,
          ...(a.fill ? { color: colour } : { borderColor: colour, borderWidth: thickness }),
        });
      } else if (a.type === 'arrow') {
        const x1 = sx(a.x1), y1 = sy(a.y1), x2 = sx(a.x2), y2 = sy(a.y2);
        const head = Math.max(6, thickness * 4);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        pdfPage.drawLine({
          start: { x: x1, y: y1 },
          end: { x: x2 - Math.cos(angle) * head * 0.8, y: y2 - Math.sin(angle) * head * 0.8 },
          thickness, color: colour, lineCap: PDFLib.LineCapStyle.Round,
        });
        const tip = `M 0 0 L ${-head * Math.cos(angle - Math.PI / 7) + 0} ${head * Math.sin(angle - Math.PI / 7)} `
                  + `L ${-head * Math.cos(angle + Math.PI / 7)} ${head * Math.sin(angle + Math.PI / 7)} Z`;
        pdfPage.drawSvgPath(tip, { x: x2, y: y2, color: colour, borderWidth: 0 });
      } else if (a.type === 'pixelate') {
        const patch = pixelPatch(page, a);
        if (!patch) continue;
        const png = await out.embedPng(patch.toDataURL('image/png'));
        pdfPage.drawImage(png, {
          x: sx(a.x), y: sy(a.y + a.h), width: a.w * width, height: a.h * height,
        });
      }
    }
  }

  /*
   * Appends each attached document to `formBytes`, keeping the original pages as they are and
   * putting the marks on top of them. Returns the finished PDF as bytes.
   */
  async function appendInto(PDFLib, out, docs) {
    for (const item of docs) {
      if (item.kind === 'pdf') {
        const src = await PDFLib.PDFDocument.load(item.bytes, { ignoreEncryption: true });
        const copied = await out.copyPages(src, src.getPageIndices());
        for (let i = 0; i < copied.length; i++) {
          out.addPage(copied[i]);
          await drawOnPdfPage(PDFLib, out, copied[i], item.pages[i]);
        }
      } else {
        const image = item.kind === 'png' ? await out.embedPng(item.bytes) : await out.embedJpg(item.bytes);
        const page = item.pages[0];
        const sheet = out.addPage([612, 792]);
        const scale = Math.min((612 - 48) / image.width, (792 - 48) / image.height);
        const w = image.width * scale, h = image.height * scale;
        sheet.drawImage(image, { x: (612 - w) / 2, y: (792 - h) / 2, width: w, height: h });
        // The marks were placed against the image, so they are drawn in that same box
        await drawOnPdfPage(PDFLib, out, {
          getSize: () => ({ width: w, height: h }),
          drawLine: (o) => sheet.drawLine(shift(o, (612 - w) / 2, (792 - h) / 2)),
          drawRectangle: (o) => sheet.drawRectangle(shift(o, (612 - w) / 2, (792 - h) / 2)),
          drawEllipse: (o) => sheet.drawEllipse(shift(o, (612 - w) / 2, (792 - h) / 2)),
          drawSvgPath: (p, o) => sheet.drawSvgPath(p, shift(o, (612 - w) / 2, (792 - h) / 2)),
          drawImage: (img, o) => sheet.drawImage(img, shift(o, (612 - w) / 2, (792 - h) / 2)),
        }, page);
      }
    }
    return out;
  }

  async function appendTo(formBytes, docs) {
    const PDFLib = await loadPdfLib();
    const out = await PDFLib.PDFDocument.load(formBytes);
    await appendInto(PDFLib, out, docs);
    return out.save();
  }

  /* Moves a drawing call into the box an image was placed in */
  function shift(options, dx, dy) {
    const moved = { ...options };
    if (moved.x !== undefined) moved.x += dx;
    if (moved.y !== undefined) moved.y += dy;
    if (moved.start) moved.start = { x: moved.start.x + dx, y: moved.start.y + dy };
    if (moved.end) moved.end = { x: moved.end.x + dx, y: moved.end.y + dy };
    return moved;
  }

  /*
   * A document opened on its own, marked up and saved back out. Built straight into a fresh
   * document rather than saved empty and reloaded — that round trip was leaving a blank A4
   * sheet in front of the pages.
   */
  async function standalone(item) {
    const PDFLib = await loadPdfLib();
    const out = await PDFLib.PDFDocument.create();
    await appendInto(PDFLib, out, [item]);
    return out.save();
  }

  /* Renders finished PDF bytes to canvases, for showing a document we've just produced */
  async function renderToCanvases(bytes, scale) {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const canvases = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: scale || 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      canvases.push(canvas);
    }
    return canvases;
  }

  window.Annotator = {
    readFile, renderPage, drawAnnotation, appendTo, standalone, renderToCanvases,
    loadPdfJs, loadPdfLib, strokeWidthFor,
  };
})();
