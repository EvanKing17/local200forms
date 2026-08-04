/*
 * Supporting documents: attaching pages to a form, marking them up, and flattening them back
 * out so they can be appended to the generated PDF.
 *
 * Everything is rasterised on the way in. That isn't a shortcut — it's what makes redaction
 * real. A black box drawn over a PDF that keeps its text layer hides nothing: the words are
 * still in the file and copy straight out, which is how redacted names have leaked from court
 * filings and newspapers. Turning each page into pixels first means a black box destroys what
 * was under it. The cost is that attached PDFs stop being searchable and the file gets larger.
 *
 * pdf.js is loaded on demand rather than at startup: it's 1.7MB, most of it a worker, and it's
 * only needed when someone actually opens a PDF. The service worker still precaches it, so
 * this works with no connection.
 */
(function () {
  'use strict';

  const MAX_EDGE = 2000;      // cap on a rasterised page, to keep the output a sane size
  const PDF_SCALE = 2;        // ~150dpi for a Letter page, enough to read a photocopy

  let pdfjsPromise = null;

  function loadPdfJs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import('./vendor/pdf.min.mjs').then(lib => {
        lib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
        return lib;
      });
    }
    return pdfjsPromise;
  }

  /* ---------- Turning a file into pages ---------- */

  function canvasFrom(source, width, height) {
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function pagesFromImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const canvas = canvasFrom(img, img.naturalWidth, img.naturalHeight);
        URL.revokeObjectURL(url);
        resolve([{ base: canvas, annotations: [] }]);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image couldn’t be read.')); };
      img.src = url;
    });
  }

  async function pagesFromPdf(file) {
    const pdfjs = await loadPdfJs();
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: PDF_SCALE });
      const canvas = document.createElement('canvas');
      const limit = Math.min(1, MAX_EDGE / Math.max(viewport.width, viewport.height));
      canvas.width = Math.round(viewport.width * limit);
      canvas.height = Math.round(viewport.height * limit);
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: context,
        viewport: page.getViewport({ scale: PDF_SCALE * limit }),
      }).promise;
      pages.push({ base: canvas, annotations: [] });
    }
    return pages;
  }

  function isPdf(file) {
    return /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
  }

  async function readFile(file) {
    const pages = isPdf(file) ? await pagesFromPdf(file) : await pagesFromImage(file);
    return { name: file.name, pages };
  }

  /* ---------- Drawing ----------
   * Annotation coordinates are stored 0..1 across the page, so the same marks render correctly
   * on the small on-screen canvas and again at full size on export.
   */
  function drawArrow(ctx, a, w, h) {
    const x1 = a.x1 * w, y1 = a.y1 * h, x2 = a.x2 * w, y2 = a.y2 * h;
    const head = Math.max(10, a.width * 3.5);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2 - Math.cos(angle) * head * 0.7, y2 - Math.sin(angle) * head * 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fillStyle = a.color;
    ctx.fill();
  }

  function pixelate(ctx, canvas, a) {
    const x = Math.round(a.x * canvas.width), y = Math.round(a.y * canvas.height);
    const w = Math.round(a.w * canvas.width), h = Math.round(a.h * canvas.height);
    if (w < 2 || h < 2) return;
    const blocks = Math.max(3, Math.round(Math.min(w, h) / 12));
    const small = document.createElement('canvas');
    small.width = blocks;
    small.height = Math.max(1, Math.round(blocks * h / w));
    const sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(canvas, x, y, w, h, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  function drawAnnotation(ctx, canvas, a) {
    const w = canvas.width, h = canvas.height;
    const scale = Math.min(w, h) / 1000;          // keeps stroke weight proportional to the page
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = a.color;
    ctx.lineWidth = Math.max(1, a.width * scale);

    if (a.type === 'pen' || a.type === 'highlight') {
      if (a.type === 'highlight') {
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = Math.max(6, a.width * scale * 3);
        ctx.globalCompositeOperation = 'multiply';
      }
      ctx.beginPath();
      a.points.forEach(([px, py], i) => {
        const x = px * w, y = py * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      if (a.points.length === 1) { ctx.lineTo(a.points[0][0] * w + 0.1, a.points[0][1] * h); }
      ctx.stroke();
    } else if (a.type === 'rect' || a.type === 'ellipse') {
      const x = a.x * w, y = a.y * h, rw = a.w * w, rh = a.h * h;
      ctx.beginPath();
      if (a.type === 'rect') ctx.rect(x, y, rw, rh);
      else ctx.ellipse(x + rw / 2, y + rh / 2, Math.abs(rw / 2), Math.abs(rh / 2), 0, 0, Math.PI * 2);
      if (a.fill) { ctx.globalAlpha = 0.28; ctx.fillStyle = a.color; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.stroke();
    } else if (a.type === 'arrow') {
      drawArrow(ctx, a, w, h);
    } else if (a.type === 'redact') {
      ctx.fillStyle = '#000';
      ctx.fillRect(a.x * w, a.y * h, a.w * w, a.h * h);
    } else if (a.type === 'pixelate') {
      pixelate(ctx, canvas, a);
    }
    ctx.restore();
  }

  /* Renders a page and its marks onto a target canvas at that canvas's own size */
  function renderPage(target, page) {
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(page.base, 0, 0, target.width, target.height);
    page.annotations.forEach(a => drawAnnotation(ctx, target, a));
  }

  /* Full-size flatten, for embedding in the PDF */
  function flatten(page) {
    const out = document.createElement('canvas');
    out.width = page.base.width;
    out.height = page.base.height;
    renderPage(out, page);
    return out;
  }

  window.Annotator = { readFile, renderPage, flatten, drawAnnotation, isPdf, loadPdfJs, MAX_EDGE };
})();
