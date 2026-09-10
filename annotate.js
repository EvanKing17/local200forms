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

  /* ---------- Text ----------
   * A note typed onto the page, wrapped to its box. Helvetica on screen and in the file, so the
   * lines break in the same places in both. `size` scales with the page the way stroke widths
   * do, so a note reads the same size on a letter sheet and on a screenshot.
   */
  const TEXT_FONT = 'Helvetica, Arial, sans-serif';
  const LINE_HEIGHT = 1.25;
  const TEXT_PAD = 0.35;          // of the font size, inside the box on every side

  function fontSizeFor(page, a) {
    return Math.max(3, (a.size || 16) * Math.min(page.width, page.height) / 700);
  }

  function wrapWith(measure, text, maxWidth) {
    const lines = [];
    String(text || '').split('\n').forEach(paragraph => {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); return; }
      let line = '';
      words.forEach(word => {
        const trial = line ? line + ' ' + word : word;
        if (line && measure(trial) > maxWidth) { lines.push(line); line = word; }
        else line = trial;
      });
      lines.push(line);
    });
    return lines;
  }

  /* The lines a note breaks into inside a box `boxW` wide, with the font size in those units */
  function textLayout(page, a, boxW, measureAt) {
    const size = fontSizeFor(page, a) * (boxW / page.width);
    const pad = size * TEXT_PAD;
    const lines = wrapWith(t => measureAt(t, size), a.text, Math.max(size, a.w * boxW - pad * 2));
    return { size, pad, lines, height: lines.length * size * LINE_HEIGHT + pad * 2 };
  }

  let scratch = null;
  function canvasMeasure(ctx) {
    return (text, size) => { ctx.font = size + 'px ' + TEXT_FONT; return ctx.measureText(text).width; };
  }

  /* How tall a note is, as a fraction of its page, measured without a canvas on screen */
  function textHeight(page, a) {
    if (!scratch) scratch = document.createElement('canvas').getContext('2d');
    const boxW = 1000;
    const layout = textLayout(page, a, boxW, canvasMeasure(scratch));
    return layout.height / (boxW * page.height / page.width);
  }

  function drawText(ctx, a, page, w, h) {
    const layout = textLayout(page, a, w, canvasMeasure(ctx));
    a.h = layout.height / h;
    ctx.font = layout.size + 'px ' + TEXT_FONT;
    ctx.fillStyle = a.color;
    ctx.textBaseline = 'alphabetic';
    const x = a.x * w + layout.pad;
    const ascent = layout.size * 0.78 + (layout.size * (LINE_HEIGHT - 1)) / 2;
    layout.lines.forEach((line, i) => {
      ctx.fillText(line, x, a.y * h + layout.pad + i * layout.size * LINE_HEIGHT + ascent);
    });
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

    if (a.type === 'text') {
      if (!a.editing) drawText(ctx, a, page, w, h);   // while it is being typed, the box on top shows it
    } else if (a.type === 'pen' || a.type === 'highlight') {
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

  /* ---------- Geometry ----------
   * Everything the editor needs to pick a mark up, move it and resize it. All in fractions of
   * the page, like the marks themselves.
   */
  function boundsOf(a, page) {
    if (a.type === 'arrow') {
      return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2),
               w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
    }
    if (a.points) {
      let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
      a.points.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
      return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    }
    if (a.type === 'text') {
      const h = a.h || (page ? textHeight(page, a) : 0.05);
      return { x: a.x, y: a.y, w: a.w, h };
    }
    return { x: a.x, y: a.y, w: a.w, h: a.h };
  }

  function segmentDistance(px, py, x1, y1, x2, y2, aspect) {
    // aspect turns fractions of a non-square page into comparable distances
    const dx = (x2 - x1) * aspect, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? (((px - x1) * aspect) * dx + (py - y1) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = (x1 * aspect) + t * dx, cy = y1 + t * dy;
    return Math.hypot(px * aspect - cx, py - cy);
  }

  /* Is the point on the mark? `tol` is in fractions of the page height; `aspect` is w/h */
  function hits(a, page, px, py, tol, aspect) {
    if (a.type === 'arrow') return segmentDistance(px, py, a.x1, a.y1, a.x2, a.y2, aspect) <= tol;
    if (a.points) {
      const reach = tol + (strokeWidthFor(page, a) / page.height) * (a.type === 'highlight' ? 2 : 0.5);
      if (a.points.length === 1) return Math.hypot((px - a.points[0][0]) * aspect, py - a.points[0][1]) <= reach;
      for (let i = 1; i < a.points.length; i++) {
        const [x1, y1] = a.points[i - 1], [x2, y2] = a.points[i];
        if (segmentDistance(px, py, x1, y1, x2, y2, aspect) <= reach) return true;
      }
      return false;
    }
    const b = boundsOf(a, page);
    return px >= b.x - tol / aspect && px <= b.x + b.w + tol / aspect && py >= b.y - tol && py <= b.y + b.h + tol;
  }

  function overlaps(a, page, box) {
    const b = boundsOf(a, page);
    return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
  }

  function translate(a, dx, dy) {
    if (a.type === 'arrow') { a.x1 += dx; a.x2 += dx; a.y1 += dy; a.y2 += dy; return; }
    if (a.points) { a.points = a.points.map(([x, y]) => [x + dx, y + dy]); return; }
    a.x += dx;
    a.y += dy;
  }

  /* Maps a mark from one box into another, so a resize works the same for every kind */
  function fitTo(a, from, to) {
    const sx = from.w > 0 ? to.w / from.w : 1;
    const sy = from.h > 0 ? to.h / from.h : 1;
    const mx = x => to.x + (x - from.x) * sx;
    const my = y => to.y + (y - from.y) * sy;
    if (a.type === 'arrow') { a.x1 = mx(a.x1); a.x2 = mx(a.x2); a.y1 = my(a.y1); a.y2 = my(a.y2); return; }
    if (a.points) { a.points = a.points.map(([x, y]) => [mx(x), my(y)]); return; }
    a.x = to.x;
    a.y = to.y;
    a.w = Math.max(0.002, to.w);
    if (a.type !== 'text') a.h = Math.max(0.002, to.h);
  }

  function snapshot(a) {
    return JSON.parse(JSON.stringify(a));
  }

  function restore(a, saved) {
    Object.keys(a).forEach(k => { if (!(k in saved)) delete a[k]; });
    Object.assign(a, snapshot(saved));
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

  /* One Helvetica per output document, embedded the first time a note needs it */
  const fonts = new WeakMap();
  async function helvetica(PDFLib, out) {
    if (!fonts.has(out)) fonts.set(out, await out.embedFont(PDFLib.StandardFonts.Helvetica));
    return fonts.get(out);
  }

  async function drawOnPdfPage(PDFLib, out, pdfPage, page) {
    const { width, height } = pdfPage.getSize();
    const sx = v => v * width;
    const sy = v => height - v * height;          // PDF y runs up from the bottom

    for (const a of page.annotations) {
      const colour = a.color ? hexToRgb(PDFLib, a.color) : PDFLib.rgb(0, 0, 0);
      const thickness = strokeWidthFor(page, a) * (width / page.width);

      if (a.type === 'text') {
        if (!String(a.text || '').trim()) continue;
        const font = await helvetica(PDFLib, out);
        const layout = textLayout(page, a, width, (t, size) => font.widthOfTextAtSize(t, size));
        const ascent = layout.size * 0.78 + (layout.size * (LINE_HEIGHT - 1)) / 2;
        layout.lines.forEach((line, i) => {
          if (!line) return;
          line = line.replace(/[^\x20-\x7e\xa0-\xff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/g, '?');
          pdfPage.drawText(line, {
            x: sx(a.x) + layout.pad,
            y: sy(a.y) - layout.pad - i * layout.size * LINE_HEIGHT - ascent,
            size: layout.size, font, color: colour,
          });
        });
      } else if (a.type === 'pen' || a.type === 'highlight') {
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
  async function appendInto(PDFLib, out, docs, fit, orient) {
    for (let i = 0; i < docs.length; i++) {
      const item = docs[i];

      if (item.kind === 'pdf') {
        const src = await PDFLib.PDFDocument.load(item.bytes, { ignoreEncryption: true });
        const copied = await out.copyPages(src, src.getPageIndices());
        for (let n = 0; n < copied.length; n++) {
          out.addPage(copied[n]);
          await drawOnPdfPage(PDFLib, out, copied[n], item.pages[n]);
        }
        continue;
      }

      /*
       * Two to a sheet. Pictures that belong together usually arrive together, so consecutive
       * images pair up; a PDF between them breaks the pair rather than reaching past it, and an
       * odd one out takes the top half on its own instead of being stretched to fill the page.
       */
      if (fit === 'pair') {
        const next = docs[i + 1];
        const partner = next && next.kind !== 'pdf' ? next : null;
        const first = await embedImage(out, item);
        const second = partner ? await embedImage(out, partner) : null;
        const layout = pairBoxes(naturalSize(item), partner ? naturalSize(partner) : null, orient);
        const sheet = out.addPage(layout.page);

        sheet.drawImage(first, layout.top);
        await drawOnPdfPage(PDFLib, out, boxProxy(sheet, layout.top), item.pages[0]);
        if (second) {
          sheet.drawImage(second, layout.bottom);
          await drawOnPdfPage(PDFLib, out, boxProxy(sheet, layout.bottom), partner.pages[0]);
          i++;                                  // the partner has been used up
        }
        continue;
      }

      const image = await embedImage(out, item);
      const box = imageBox(naturalSize(item), fit, orient);
      const sheet = out.addPage(box.page);
      sheet.drawImage(image, box);
      // The marks were placed against the image, so they are drawn in that same box
      await drawOnPdfPage(PDFLib, out, boxProxy(sheet, box), item.pages[0]);
    }
    return out;
  }

  /*
   * A phone photo is 3-5MB and four thousand pixels across; six of them made a 25MB grievance.
   * Anything big is drawn to a canvas at a size that still prints sharp and written back out as
   * JPEG. Going through a canvas also bakes in the camera's rotation flag, which pdf-lib would
   * otherwise leave for the reader to ignore. The original bytes are never touched: a small
   * screenshot goes in as it is, and `item.bytes` is what a .grv or a re-upload gets.
   */
  const EMBED_MAX_EDGE = 2000;               // about 240dpi across a letter sheet
  const EMBED_KEEP_BYTES = 700 * 1024;
  const EMBED_QUALITY = 0.86;

  async function encodeForPdf(item) {
    const page = item.pages[0];
    const edge = Math.max(page.width, page.height);
    if (item.bytes.length <= EMBED_KEEP_BYTES && edge <= EMBED_MAX_EDGE) return { kind: item.kind, bytes: item.bytes };
    const scale = Math.min(1, EMBED_MAX_EDGE / edge);
    const bitmap = await createImageBitmap(new Blob([item.bytes]));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';                  // JPEG has no transparency; a clear PNG lands on white
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', EMBED_QUALITY));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Never trade up: if the original was the smaller file, it stays
    if (scale === 1 && bytes.length >= item.bytes.length) return { kind: item.kind, bytes: item.bytes };
    return { kind: 'jpg', bytes };
  }

  async function embedImage(out, item) {
    if (!item.embedded) item.embedded = await encodeForPdf(item);
    return item.embedded.kind === 'png' ? out.embedPng(item.embedded.bytes) : out.embedJpg(item.embedded.bytes);
  }

  /* The picture's own pixel size, which decides its page, whatever size it was written out at */
  function naturalSize(item) {
    return { width: item.pages[0].width, height: item.pages[0].height };
  }

  /* Makes a box on a sheet look like a page, so marks land where the picture actually is */
  function boxProxy(sheet, box) {
    return {
      getSize: () => ({ width: box.width, height: box.height }),
      drawLine: (o) => sheet.drawLine(shift(o, box.x, box.y)),
      drawRectangle: (o) => sheet.drawRectangle(shift(o, box.x, box.y)),
      drawEllipse: (o) => sheet.drawEllipse(shift(o, box.x, box.y)),
      drawSvgPath: (p, o) => sheet.drawSvgPath(p, shift(o, box.x, box.y)),
      drawImage: (img, o) => sheet.drawImage(img, shift(o, box.x, box.y)),
      drawText: (t, o) => sheet.drawText(t, shift(o, box.x, box.y)),
    };
  }

  /*
   * Written without object streams. pdf-lib keeps the form's own metadata across a load and
   * save, but packs the Info dictionary into a compressed stream, and the reader that fills a
   * form back in from its PDF looks for it in the raw bytes — so a grievance with photos on
   * the end could not be re-opened. Uncompressed, it reads back the way it went in, at the
   * cost of a few hundred bytes.
   */
  const SAVE = { useObjectStreams: false };

  async function appendTo(formBytes, docs, fit, orient) {
    const PDFLib = await loadPdfLib();
    const out = await PDFLib.PDFDocument.load(formBytes);
    await appendInto(PDFLib, out, docs, fit || 'letter', orient);
    return out.save(SAVE);
  }

  /*
   * Where an image sits on its page, and how big that page is.
   *
   * 'image' gives the picture a page of its own exactly its own size, which is what a pile of
   * screenshots wants — no margin, no shrinking, nothing to line up. Screenshots are measured in
   * CSS pixels, so they convert at 96 to the inch.
   *
   * 'letter' is the sheet a form's attachments have always been put on: centred, with a margin,
   * on paper that matches the rest of the document.
   */
  const PT_PER_PX = 72 / 96;
  const SHEET = 612, SHEET_LONG = 792, MARGIN = 24, PAIR_GAP = 24;

  /*
   * Which way up the paper is. 'portrait' and 'landscape' are the answer whatever the picture
   * looks like, because a stack of pages that all turn the same way is what gets printed and
   * handed over; 'auto' turns each sheet to match its picture, which wastes less of it.
   */
  function isLandscape(image, orient) {
    if (orient === 'landscape') return true;
    if (orient === 'auto') return image.width > image.height;
    return false;                       // portrait, the default
  }

  function imageBox(image, fit, orient) {
    if (fit === 'image') {
      const width = Math.max(1, Math.round(image.width * PT_PER_PX));
      const height = Math.max(1, Math.round(image.height * PT_PER_PX));
      return { page: [width, height], x: 0, y: 0, width, height };
    }
    const landscape = isLandscape(image, orient);
    const pw = landscape ? SHEET_LONG : SHEET;
    const ph = landscape ? SHEET : SHEET_LONG;
    return { page: [pw, ph], ...fitInside(image, MARGIN, MARGIN, pw - MARGIN * 2, ph - MARGIN * 2) };
  }

  /* Two to a sheet: stacked on portrait paper, side by side on landscape */
  function pairBoxes(first, second, orient) {
    if (isLandscape(first, orient)) {
      const slotW = (SHEET_LONG - MARGIN * 2 - PAIR_GAP) / 2;
      const slotH = SHEET - MARGIN * 2;
      return {
        page: [SHEET_LONG, SHEET],
        top: fitInside(first, MARGIN, MARGIN, slotW, slotH),
        bottom: second ? fitInside(second, MARGIN + slotW + PAIR_GAP, MARGIN, slotW, slotH) : null,
      };
    }
    const slotH = (SHEET_LONG - MARGIN * 2 - PAIR_GAP) / 2;
    const slotW = SHEET - MARGIN * 2;
    return {
      page: [SHEET, SHEET_LONG],
      top: fitInside(first, MARGIN, MARGIN + slotH + PAIR_GAP, slotW, slotH),
      bottom: second ? fitInside(second, MARGIN, MARGIN, slotW, slotH) : null,
    };
  }

  /* Largest the picture can be inside a slot without distorting it, centred there */
  function fitInside(image, slotX, slotY, slotW, slotH) {
    const scale = Math.min(slotW / image.width, slotH / image.height);
    const width = image.width * scale, height = image.height * scale;
    return { x: slotX + (slotW - width) / 2, y: slotY + (slotH - height) / 2, width, height };
  }

  /*
   * A new document built from nothing but what's handed to it — images each becoming a page,
   * PDFs contributing their pages as they are. Used by the builder on the Forms page, where a
   * dozen screenshots get compiled into one thing to send off.
   */
  async function compile(items, fit, orient) {
    const PDFLib = await loadPdfLib();
    const out = await PDFLib.PDFDocument.create();
    await appendInto(PDFLib, out, items, fit || 'image', orient);
    if (out.getPageCount() === 0) throw new Error('there are no pages to save');
    return out.save(SAVE);
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
  async function standalone(item, orient) {
    const PDFLib = await loadPdfLib();
    const out = await PDFLib.PDFDocument.create();
    await appendInto(PDFLib, out, [item], 'letter', orient);
    return out.save(SAVE);
  }

  /*
   * Renders finished PDF bytes to canvases, for showing a document we've just produced.
   *
   * Drawn at the screen's own pixel density, not in CSS pixels: on a display running at 150% or
   * 200% a canvas built at 1:1 gets stretched by the browser to fill the same space, and the
   * page looks soft when the file it came from is perfectly sharp. Capped by the longest edge,
   * because a screenshot-sized page at 2x is tens of megabytes of canvas and that has already
   * cost this app its frame rate once.
   */
  const MAX_RENDER_EDGE = 2600;

  async function renderToCanvases(bytes, scale) {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const density = Math.min(window.devicePixelRatio || 1, 2);
    const canvases = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: (scale || 1.5) * density });
      const room = MAX_RENDER_EDGE / Math.max(base.width, base.height);
      const viewport = room < 1
        ? page.getViewport({ scale: (scale || 1.5) * density * room })
        : base;
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
    readFile, renderPage, drawAnnotation, appendTo, standalone, renderToCanvases, compile, imageBox, pairBoxes,
    loadPdfJs, loadPdfLib, strokeWidthFor, fontSizeFor, textHeight, encodeForPdf,
    geometry: { boundsOf, hits, overlaps, translate, fitTo, snapshot, restore },
  };
})();
