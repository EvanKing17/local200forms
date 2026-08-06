const panels = document.querySelectorAll('.form-panel');

/*
 * Form display names (homepage card + sheet-header/PDF title) live in forms.config.js rather than
 * hardcoded here, so they can be edited without touching this file — see admin.html, a
 * local-only page for editing that file directly. It's a plain <script src> (loaded before this
 * file, see index.html) rather than a fetch()'d JSON file specifically so this keeps working when
 * the app is opened straight from disk via file:// — fetch() of a local file is blocked by CORS
 * in Chrome/Edge under file://, but a <script src> tag loads local files fine regardless.
 */
const DEFAULT_FORMS_CONFIG = {
  ford: {
    title: 'Grievance Investigation & Claim Form',
    homeLabel: 'Grievance Investigation & Claim Form',
    homeSub: 'Ford — Section A intake',
  },
  policy: {
    title: 'Policy Grievance Form',
    homeLabel: 'Policy Grievance Form',
    homeSub: 'Ford — policy grievance',
  },
  unifor: {
    title: 'Local 200 Grievance Committee Fact Sheet',
    homeLabel: 'Local 200 Fact Sheet',
    homeSub: 'Unifor — first stage appeal',
  },
  investigation: {
    title: '4.01 Investigation Form',
    homeLabel: '4.01 Investigation Form',
    homeSub: 'Workplace incident intake',
  },
};
const FORMS_CONFIG = { ...DEFAULT_FORMS_CONFIG, ...(window.FORMS_CONFIG_DATA || {}) };

/* Where drafts are kept. Declared here rather than with the rest of the draft code near the
   bottom of the file: showHome() runs at module level well above that block and reaches in
   through refreshDraftFlags(), so a const declared down there would still be unreachable. */
const DRAFT_PREFIX = 'local200forms:draft:';

function applyFormsConfig() {
  // Checks for null/undefined specifically (not just falsy) so an intentionally-cleared field
  // (empty string, from admin.html) actually clears the display instead of being skipped —
  // only a genuinely *missing* key falls back to whatever's already in the static HTML.
  Object.entries(FORMS_CONFIG).forEach(([type, cfg]) => {
    const card = document.querySelector(`.form-card[data-form="${type}"]`);
    if (card) {
      const label = card.querySelector('.picker-label');
      const sub = card.querySelector('.picker-sub');
      if (label && cfg.homeLabel != null) label.textContent = cfg.homeLabel;
      if (sub && cfg.homeSub != null) sub.textContent = cfg.homeSub;
    }
    const heading = document.getElementById(`form-${type}-heading`);
    if (heading && cfg.title != null) heading.textContent = cfg.title;
  });
}

const workspace = document.getElementById('workspace');

/* ============ Helpers ============ */
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
function fd(form) {
  const data = {};
  new FormData(form).forEach((v, k) => { data[k] = v; });
  return data;
}

/*
 * Date spellings for one ISO date, fullest first: "December 31 2027", "Dec 31 2027",
 * "12/31/2027". Dates read better spelled out, but a cell is only so wide — fmtDateFit picks
 * the fullest one that actually fits so a long month can't overflow or get wrapped in half.
 */
function dateVariants(iso) {
  if (!iso) return [''];
  const [y, m, d] = iso.split('-');
  const monthIndex = parseInt(m, 10) - 1;
  if (!y || !MONTH_NAMES_FULL[monthIndex]) return [iso];
  const day = parseInt(d, 10);
  return [
    `${MONTH_NAMES_FULL[monthIndex]} ${day} ${y}`,
    `${MONTH_NAMES_SHORT[monthIndex]} ${day} ${y}`,
    `${m}/${d}/${y}`,
  ];
}

/* The full spelling — for places with room to spare, or no width to measure against */
function fmtDate(iso) {
  return dateVariants(iso)[0];
}

/* The fullest spelling that fits maxWidth on one line at the grid's value size */
function fmtDateFit(doc, iso, maxWidth) {
  const variants = dateVariants(iso);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  return variants.find(v => doc.getTextWidth(v) <= maxWidth) || variants[variants.length - 1];
}

/* Strips any existing formatting ($, commas, ...) and returns a plain "0.00" string for the PDF */
function formatCurrency(val) {
  if (val === undefined || val === null || val === '') return '';
  const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  if (isNaN(num)) return String(val);
  return num.toFixed(2);
}

/* Reformats a currency <input> in place, as "$0.00", once the user leaves the field */
function formatCurrencyInput(el) {
  const raw = el.value.replace(/[^0-9.-]/g, '');
  if (raw === '' || raw === '-') { el.value = ''; return; }
  const num = parseFloat(raw);
  el.value = isNaN(num) ? '' : `$${num.toFixed(2)}`;
}

document.querySelectorAll('.currency-input').forEach(el => {
  el.addEventListener('blur', () => formatCurrencyInput(el));
});

function download(doc, filename) {
  doc.save(filename);
}

/* ============ Full-screen PDF preview ============ */
const pdfViewer = document.getElementById('pdfViewer');
const pdfViewerPages = document.getElementById('pdfViewerPages');
const pdfViewerStatus = document.getElementById('pdfViewerStatus');
const pdfViewerName = document.getElementById('pdfViewerName');
let viewerDoc = null;
let viewerBlob = null;
let viewerBack = null;
let viewerFilename = '';
let viewerUrl = null;
let viewerToken = 0;

function openPdfViewer(doc, filename) {
  showPdf(doc.output('blob'), filename, doc);
}

/*
 * Shows any PDF. `doc` is optional — present when we built it with jsPDF, absent when the
 * bytes came from somewhere else. `onBack` is where the back arrow should return to.
 *
 * The pages are drawn here rather than handed to the browser's own PDF plugin. An embedded
 * plugin can decline to render inline — "always download PDFs" is a setting, and some builds
 * fall back to it on their own — and what you get then is a card with an Open button instead
 * of the document. Drawing it means there is always something on screen.
 */
async function showPdf(blob, filename, doc, onBack) {
  const token = ++viewerToken;
  viewerDoc = doc || null;
  viewerBlob = blob;
  viewerFilename = filename;
  viewerBack = onBack || null;
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = URL.createObjectURL(blob);

  pdfViewerName.value = filename.replace(/\.pdf$/i, '');
  pdfViewerPages.innerHTML = '';
  setViewerStatus('Preparing the preview…');
  pdfViewer.hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('pdfViewerClose').focus();

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const canvases = await window.Annotator.renderToCanvases(bytes, 1.5);
    if (token !== viewerToken) return;        // a newer preview opened while this one rendered
    pdfViewerPages.innerHTML = '';
    canvases.forEach((canvas, i) => {
      canvas.className = 'pdf-viewer-page';
      const wrap = document.createElement('div');
      wrap.className = 'pdf-viewer-sheet';
      const number = document.createElement('span');
      number.className = 'pdf-viewer-page-number';
      number.textContent = 'Page ' + (i + 1) + ' of ' + canvases.length;
      wrap.append(canvas, number);
      pdfViewerPages.appendChild(wrap);
    });
    setViewerStatus('');
  } catch (err) {
    if (token !== viewerToken) return;
    setViewerStatus('Couldn’t draw the preview. The file is fine — use Download.');
  }
}

let statusTimer = null;

function setViewerStatus(message, fade) {
  clearTimeout(statusTimer);
  pdfViewerStatus.textContent = message || '';
  pdfViewerStatus.hidden = !message;
  if (message && fade) statusTimer = setTimeout(() => { pdfViewerStatus.hidden = true; }, 4000);
}

/* The name typed in the viewer is what the file is saved as */
function viewerName() {
  const typed = pdfViewerName.value.trim();
  return (typed || viewerFilename.replace(/\.pdf$/i, '')) + '.pdf';
}

function closePdfViewer() {
  pdfViewer.hidden = true;
  pdfViewerPages.innerHTML = '';
  setViewerStatus('');
  document.body.style.overflow = '';
  if (viewerUrl) {
    URL.revokeObjectURL(viewerUrl);
    viewerUrl = null;
  }
  viewerDoc = null;
  viewerBlob = null;
  viewerBack = null;
}

document.getElementById('pdfViewerClose').addEventListener('click', closePdfViewer);
document.getElementById('pdfViewerBack').addEventListener('click', () => {
  const back = viewerBack;
  closePdfViewer();
  if (back) back();
});

document.getElementById('pdfViewerDownload').addEventListener('click', () => {
  const name = viewerName();
  if (viewerDoc) {
    download(viewerDoc, name);
  } else if (viewerBlob) {
    // No jsPDF document behind it, so the blob is saved directly
    const link = document.createElement('a');
    link.href = viewerUrl;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } else {
    return;
  }
  // Downloads land silently in a folder, so say where it went
  setViewerStatus('Saved “' + name + '” to your downloads.', true);
});

document.getElementById('pdfViewerPrint').addEventListener('click', () => {
  // Printing goes through the browser's own viewer in a new tab, which always has a print
  // command even when it won't render inside this page
  window.open(viewerUrl, '_blank', 'noopener');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !pdfViewer.hidden) closePdfViewer();
});

/*
 * "NAME - MMDDYYYY FORMTYPE.pdf" — a real Save As dialog isn't something a page can force open
 * (that's the user's own "always ask where to save files" browser setting); this just supplies
 * the suggested filename for whatever save behavior the browser is configured to use.
 */
const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_NAMES_SHORT = MONTH_NAMES_FULL.map(m => m.slice(0, 3));

function buildFilename(name, formTypeLabel, occurredIso) {
  // The date of the incident, not the day the PDF happened to be made — a grievance gets
  // reprinted and refiled, and it's the occurrence that identifies it. Falls back to today
  // when the incident date hasn't been filled in yet.
  const parts = String(occurredIso || '').split('-');
  const monthIndex = parseInt(parts[1], 10) - 1;
  let dateStr;
  if (parts.length === 3 && MONTH_NAMES_FULL[monthIndex]) {
    // Read off the string rather than via a Date, which would shift the day west of UTC
    dateStr = `${MONTH_NAMES_FULL[monthIndex]} ${parseInt(parts[2], 10)} ${parts[0]}`;
  } else {
    const today = new Date();
    dateStr = `${MONTH_NAMES_FULL[today.getMonth()]} ${today.getDate()} ${today.getFullYear()}`;
  }
  const safeName = (name || 'Unnamed').trim().replace(/[\\/:*?"<>|]/g, '') || 'Unnamed';
  return `${safeName} - ${dateStr} ${formTypeLabel}.pdf`;
}

const FORM_SIGNATURE = 'local200forms-v1';

/*
 * Every generated PDF carries its own form data back out again, tucked into the standard PDF
 * Subject/Keywords metadata fields — invisible in the document itself, but readable from the raw
 * file bytes without needing a PDF parser (see readEmbeddedFormData below). This only round-trips
 * for a PDF re-uploaded as-is; a printed-and-rescanned copy has no metadata left to read.
 */
function embedFormData(doc, formType, data) {
  const payload = JSON.stringify({ formType, data });
  const encoded = btoa(unescape(encodeURIComponent(payload)));
  doc.setProperties({ subject: FORM_SIGNATURE, keywords: encoded });
}

/* Reverses embedFormData from a raw PDF file's bytes. Returns null if unrecognized. */
function readEmbeddedFormData(bytes) {
  const text = new TextDecoder('latin1').decode(bytes);
  const subjectMatch = text.match(/\/Subject\s*\(([^)]*)\)/);
  if (!subjectMatch || subjectMatch[1] !== FORM_SIGNATURE) return null;

  const keywordsMatch = text.match(/\/Keywords\s*\(([^)]*)\)/);
  if (!keywordsMatch) return null;

  try {
    const json = decodeURIComponent(escape(atob(keywordsMatch[1])));
    const payload = JSON.parse(json);
    if (!payload || !payload.formType || !payload.data) return null;
    return payload;
  } catch {
    return null;
  }
}

const PAGE_BOTTOM = 760;

/* Adds a new page and resets to the top margin if the next block won't fit */
function ensureSpace(doc, y, estHeight, marginTop = 40) {
  if (y + estHeight > PAGE_BOTTOM) {
    doc.addPage();
    return marginTop;
  }
  return y;
}

/* Shrinks a single line of text down to minSize if it doesn't fit maxWidth */
function fitSingleLine(doc, text, maxWidth, baseSize, minSize = 6) {
  let size = baseSize;
  doc.setFontSize(size);
  while (size > minSize && doc.getTextWidth(text) > maxWidth) {
    size -= 0.5;
    doc.setFontSize(size);
  }
  return size;
}

const UNIFOR_LOGO_ASPECT = 1342 / 532;

/* The official Unifor logo (see unifor-logo.js), right-aligned so rightEdgeX is its right edge */
function drawUniforLogo(doc, rightEdgeX, topY, width = 110) {
  if (!window.UNIFOR_LOGO_PNG) return;
  const h = width / UNIFOR_LOGO_ASPECT;
  doc.addImage(window.UNIFOR_LOGO_PNG, 'PNG', rightEdgeX - width, topY, width, h);
}

/* SP number + logo, repeated at the top of every Unifor Fact Sheet page. Returns the y to start content at. */
const UNIFOR_HEADER_TOP = 42;
const UNIFOR_LOGO_W = 92;

function drawUniforPageHeader(doc, marginX, W, data) {
  const top = UNIFOR_HEADER_TOP;
  const logoH = UNIFOR_LOGO_W / UNIFOR_LOGO_ASPECT;
  drawUniforLogo(doc, marginX + W, top, UNIFOR_LOGO_W);

  // Just the number, no label — the "SP-" prefix already says what it is, and the grey fill
  // this used to sit on read as a UI chip rather than part of the form.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...DC.ink);
  doc.text(`SP-${data.spNumber || ''}`, marginX, top + logoH / 2 + 4);   // centred against the logo

  /*
   * The rule clears whichever of the two runs lower, rather than sitting at a fixed offset —
   * it was drawn at a fixed 28pt and the logo, being taller than that, printed straight
   * through it.
   */
  const ruleY = top + logoH + 10;
  doc.setDrawColor(...DC.primary);
  doc.setLineWidth(1.5);
  doc.line(marginX, ruleY, marginX + W, ruleY);
  return ruleY + 18;
}

/* "Unifor Local 200 / PRIVATE / pg. X / 5" footer, repeated at the bottom of every page */
function drawUniforFooter(doc, marginX, W, pageNum, totalPages = 5) {
  doc.setDrawColor(...DC.divider);
  doc.setLineWidth(0.75);
  doc.line(marginX, 758, marginX + W, 758);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...DC.labelSoft);
  doc.text('Unifor Local 200', marginX, 770);
  doc.text('PRIVATE', 306, 770, { align: 'center' });
  doc.text(`pg. ${pageNum} / ${totalPages}`, marginX + W, 770, { align: 'right' });
}

/* A bold question with Yes/No checkboxes at a fixed offset from x, for the short single-line questions */
/* Wraps label to fit before checkboxX if labelMaxWidth is given; returns the line count so the
   caller can advance y correctly (checkboxes stay pinned to the first line). */
function yesNoQuestion(doc, x, y, label, value, checkboxX, labelMaxWidth) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...DC.ink);
  const lines = labelMaxWidth ? doc.splitTextToSize(label, labelMaxWidth) : [label];
  doc.text(lines, x, y);
  checkboxText(doc, checkboxX, y - 3, 'Yes');
  checkboxText(doc, checkboxX + 55, y - 3, 'No');
  if (value === 'Yes') markCheckbox(doc, checkboxX, y - 3);
  else if (value === 'No') markCheckbox(doc, checkboxX + 55, y - 3);
  return lines.length;
}

/*
 * Palette from the Grievance Form Style Guide. The screen and the PDF draw from this one set of
 * values so the document view and the printed output are the same document, not two designs that
 * happen to resemble each other — see the matching --dc-* custom properties in style.css.
 */
const DC = {
  primary: [0, 40, 85],        // #002855 — section bands, rules, checked boxes
  bandSub: [217, 223, 229],    // white at 85% over the band, matching the guide's opacity
  ink: [42, 40, 36],           // #2A2824 — field values
  inkSoft: [58, 56, 47],       // #3A382F — body copy inside text boxes
  label: [121, 110, 101],      // #796E65 — field labels
  labelSoft: [138, 132, 120],  // #8A8478 — document subtitle
  border: [217, 212, 204],     // #D9D4CC — box borders
  divider: [228, 225, 220],    // #E4E1DC — dividers between cells inside a grid
  boxBorder: [163, 156, 143],  // #A39C8F — unchecked checkbox border
};

const DC_RADIUS = 2.5;  // the guide's 3px corner radius, in points

/*
 * Entered values are bold, so what someone filled in reads apart from the printed form around
 * it. Measuring has to use the same face as drawing, or splitTextToSize would wrap against a
 * narrower string than actually appears.
 */
function setValueStyle(doc, size = 9.5) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  doc.setTextColor(...DC.ink);
}

/* The guide's 0.06em label tracking. jsPDF char spacing is absolute, so it's derived per size. */
function setLabelStyle(doc, size = 6.5) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  doc.setTextColor(...DC.label);
  doc.setCharSpace(size * 0.06);
}

function clearLabelStyle(doc) {
  doc.setCharSpace(0);
}

/*
 * Document header lockup: title over a subtitle, on a rule in the primary colour.
 * Left-aligned per the style guide.
 */
function drawDocHeader(doc, x, y, w, title, subtitle, rightField) {
  /*
   * A short value sitting on the title's baseline, e.g. the Investigation form's "Step: 1".
   * Plain text rather than a boxed field — a lone digit in a drawn box reads as an empty
   * form control on paper, when it's really just part of the heading.
   */
  let titleWidth = w;
  if (rightField) {
    doc.setFontSize(11);
    doc.setTextColor(...DC.ink);
    const value = String(rightField.value || '');

    doc.setFont('helvetica', 'bold');
    const valueW = doc.getTextWidth(value);
    doc.text(value, x + w, y + 1, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    const labelW = doc.getTextWidth(rightField.label);
    doc.text(rightField.label, x + w - valueW - 5, y + 1, { align: 'right' });

    titleWidth = w - labelW - valueW - 28;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...DC.ink);
  const titleLines = doc.splitTextToSize(title, titleWidth);
  titleLines.forEach((line, i) => doc.text(line, x, y + i * 18));
  let cy = y + (titleLines.length - 1) * 18;

  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.25);
    doc.setTextColor(...DC.labelSoft);
    cy += 12;
    doc.text(subtitle, x, cy);
  }

  cy += 10;
  doc.setDrawColor(...DC.primary);
  doc.setLineWidth(1.5);
  doc.line(x, cy, x + w, cy);
  return cy + 16;
}

/* Section band: bold label plus a lighter continuation, white on the primary colour */
function sectionBar(doc, x, y, w, boldLabel, restLabel) {
  const h = 18;
  doc.setFillColor(...DC.primary);
  doc.rect(x, y, w, h, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(boldLabel, x + 8, y + 12);
  if (restLabel) {
    const bw = doc.getTextWidth(boldLabel);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...DC.bandSub);
    doc.text(restLabel, x + 8 + bw, y + 12);
  }
  return y + h;
}

/*
 * One continuous bordered row split into cells by thin divider lines.
 * Height grows automatically to fit whatever the label/value need — nothing is ever truncated.
 */
/*
 * Grid cell metrics, in points. CELL_X is generous enough that a wide first or last glyph
 * can't touch the cell border or a rounded corner, and CELL_TOP keeps labels off the section
 * band above them. The matching CSS in style.css converts each of these at 1pt = 1.3333px.
 */
const CELL_X = 7;          // text inset from the cell's left edge
const CELL_TOP = 12;       // cell top to the bottom of a one-line label block
const CELL_LABEL_GAP = 6;  // label block to the first value line
const CELL_BOTTOM = 6;     // last value line to the cell's bottom edge
const CELL_LINE = 11;      // value line height
const CELL_MIN_H = 35;

function prepareGridCells(doc, cells) {
  const labelFontSize = 6.5, valueFontSize = 9.5;
  return cells.map(c => {
    // Measured with the same bold face + tracking the label is drawn with, or the wrap
    // point would be computed against a narrower string than actually gets rendered.
    setLabelStyle(doc, labelFontSize);
    const labelLines = doc.splitTextToSize(c.label.toUpperCase(), c.width - CELL_X * 2).slice(0, 2);
    clearLabelStyle(doc);
    setValueStyle(doc, valueFontSize);
    const valueLines = doc.splitTextToSize(c.value || '', c.width - CELL_X * 2);
    return { ...c, labelLines, valueLines };
  });
}

function gridHeightFromPrepared(prepared, minH) {
  const maxLabelLines = Math.max(1, ...prepared.map(p => p.labelLines.length));
  const maxValueLines = Math.max(1, ...prepared.map(p => p.valueLines.length));
  const labelBlockH = CELL_TOP + (maxLabelLines - 1) * 7.5;
  const h = labelBlockH + CELL_LABEL_GAP + maxValueLines * CELL_LINE + CELL_BOTTOM;
  return { h: Math.max(minH, h), labelBlockH };
}

/* Measures the height boxedGrid(doc, x, y, w, cells, minH) would draw, without drawing it */
function measureBoxedGrid(doc, cells, minH = CELL_MIN_H) {
  return gridHeightFromPrepared(prepareGridCells(doc, cells), minH).h;
}

/*
 * A "Section X: ..." header bar + an optional fixed extra block (e.g. Ford's Approved/Denied
 * row) + a field grid + a Comments box, treated as one atomic unit: its full height is measured
 * up front, so the whole section moves to a new page together rather than splitting a header
 * or grid from the Comments box that follows it.
 */
function drawResponseSection(doc, marginX, W, y, boldLabel, restLabel, gridCells, gridMinH, commentsMinH, extra) {
  const gridH = measureBoxedGrid(doc, gridCells, gridMinH);
  const extraH = extra ? extra.height : 0;
  const totalH = 18 + extraH + gridH + 10 + 6 + commentsMinH;
  y = ensureSpace(doc, y, totalH);

  // Band, then whatever sits directly under it, all flush — one component, no seams.
  y = sectionBar(doc, marginX, y, W, boldLabel, restLabel);
  if (extra) {
    extra.draw(doc, marginX, y, W);
    y += extra.height;
  }
  y = boxedGrid(doc, marginX, y, W, gridCells, gridMinH, true);
  y += 10;
  y = flowTextBox(doc, marginX, y + 6, W, 'Comments:', '', commentsMinH);
  y += 14;
  return y;
}

/*
 * `attached` means this grid sits flush under a section band, so its top edge is the band's
 * bottom edge and only the lower corners are rounded.
 */
function boxedGrid(doc, x, y, w, cells, minH = CELL_MIN_H, attached = false) {
  const valueFontSize = 9.5;
  const prepared = prepareGridCells(doc, cells);
  const { h, labelBlockH } = gridHeightFromPrepared(prepared, minH);

  // A grid row is drawn as one piece (splitting a row's cells across a page break would look
  // broken), so if it doesn't fit here, move the whole thing to a fresh page instead of clipping.
  if (y + h > PAGE_BOTTOM) {
    doc.addPage();
    y = 40;
  }

  doc.setDrawColor(...DC.border);
  doc.setLineWidth(0.75);
  if (attached) doc.rect(x, y, w, h);
  else doc.roundedRect(x, y, w, h, DC_RADIUS, DC_RADIUS);

  // Dividers are lighter than the outer border, per the guide's continuous-grid treatment.
  let cx = x;
  doc.setDrawColor(...DC.divider);
  prepared.forEach((c, i) => {
    if (i > 0) doc.line(cx, y, cx, y + h);
    cx += c.width;
  });

  cx = x;
  prepared.forEach(c => {
    setLabelStyle(doc);
    doc.text(c.labelLines, cx + CELL_X, y + 10.5);
    clearLabelStyle(doc);
    setValueStyle(doc, valueFontSize);
    doc.text(c.valueLines, cx + CELL_X, y + labelBlockH + CELL_LABEL_GAP + 8);
    cx += c.width;
  });
  return y + h;
}

/*
 * Plain label above a bordered box (Details of Incident, Comments, the Unifor question boxes, ...).
 * Grows to fit the value; if the value is longer than a page can hold, spills onto a
 * "(continued)" box on a new page rather than cutting anything off.
 */
function flowTextBox(doc, x, y, w, label, value, minH = 26) {
  const fontSize = 9.5, lineHeight = 12;
  setValueStyle(doc, fontSize);
  const allLines = doc.splitTextToSize(value || '', w - CELL_X * 2);
  let idx = 0, currentY = y, first = true;
  do {
    // If even the minimum box height won't fit before the page edge, start fresh on a new page
    // rather than drawing an oversized box that gets physically clipped by the margin.
    if (currentY + 6 + minH > PAGE_BOTTOM) {
      doc.addPage();
      currentY = 40;
    }
    // An empty label means the box is already named by the section band above it, so the
    // label line is skipped entirely rather than left as a blank gap.
    let boxY = currentY;
    if (label) {
      const text = first ? label : label.replace(/:\s*$/, '') + ' (continued):';
      setLabelStyle(doc);
      doc.text(text.replace(/:\s*$/, '').toUpperCase(), x, currentY);
      clearLabelStyle(doc);
      boxY = currentY + 6;
    }
    const availH = PAGE_BOTTOM - boxY;
    const maxLines = Math.max(1, Math.floor((availH - 10) / lineHeight));
    const remaining = allLines.length - idx;
    const linesThisBox = Math.max(1, Math.min(remaining, maxLines));
    // Clamped to availH as a hard floor: the box can never be drawn past the page edge.
    const boxH = Math.min(availH, Math.max(minH, linesThisBox * lineHeight + 10));
    doc.setDrawColor(...DC.border);
    doc.setLineWidth(0.75);
    doc.roundedRect(x, boxY, w, boxH, DC_RADIUS, DC_RADIUS);
    setValueStyle(doc, fontSize);
    doc.text(allLines.slice(idx, idx + linesThisBox), x + CELL_X, boxY + 14);
    idx += linesThisBox;
    currentY = boxY + boxH;
    first = false;
    if (idx < allLines.length) {
      doc.addPage();
      currentY = 40;
    }
  } while (idx < allLines.length);
  return currentY;
}

const HOUR_CELL_H = 26;

/*
 * An hours cell reads as one ledger line: label on the left, figure on the right, rather than
 * the label-above-value used everywhere else. These hold a single number in a half-page-wide
 * box, so stacking them left the figure marooned in a lot of empty space — and a number
 * belongs against the right edge anyway, the way it would in the spreadsheets these replaced.
 */
function hourCell(doc, x, y, w, label, value) {
  doc.setDrawColor(...DC.border);
  doc.setLineWidth(0.75);
  doc.roundedRect(x, y, w, HOUR_CELL_H, DC_RADIUS, DC_RADIUS);

  const baseline = y + 16;
  setLabelStyle(doc);
  doc.text(doc.splitTextToSize(label.toUpperCase(), w * 0.62)[0], x + CELL_X, baseline);
  clearLabelStyle(doc);

  const val = (value || '').toString();
  setValueStyle(doc);
  fitSingleLine(doc, val, w * 0.3, 9.5, 6.5);
  doc.text(val, x + w - CELL_X, baseline, { align: 'right' });
  return y + HOUR_CELL_H;
}

/* A square checkbox (y is its vertical center) followed by its label — sized generously so a
   digital-signing tool's checkmark/X actually has room to land inside it.
   The 15pt box and its label offsets are deliberately unchanged from the printed originals;
   only the colours follow the style guide. */
const CHECKBOX_SIZE = 15;

function checkboxText(doc, x, y, label) {
  const size = CHECKBOX_SIZE;
  doc.setDrawColor(...DC.boxBorder);
  doc.setLineWidth(1);
  doc.rect(x, y - size / 2, size, size);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...DC.ink);
  doc.text(label, x + size + 6, y + 3.5);
}

/* Fills a checkbox drawn by checkboxText at the same x, y and draws a white checkmark in it */
function markCheckbox(doc, x, y) {
  const size = CHECKBOX_SIZE;
  const top = y - size / 2;
  doc.setFillColor(...DC.primary);
  doc.setDrawColor(...DC.primary);
  doc.setLineWidth(1);
  doc.rect(x, top, size, size, 'FD');

  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(1.6);
  doc.setLineCap('round');
  doc.setLineJoin('round');
  doc.lines([[2.6, 3.2], [5.6, -7.2]], x + 3.4, top + 7.6);
  doc.setLineCap('butt');
  doc.setLineJoin('miter');
}

/*
 * A labelled field whose value is a set of checkboxes, sized so the 15pt boxes sit clear of
 * both the label above and the cell border below — cramming them into a boxedGrid cell built
 * for a 9.5pt line of text is what made them collide with the text around them.
 */
const CHECKBOX_ROW_H = 46;

function checkboxFieldRow(doc, x, y, w, label, options, value, attached = false, height = CHECKBOX_ROW_H) {
  doc.setDrawColor(...DC.border);
  doc.setLineWidth(0.75);
  if (attached) doc.rect(x, y, w, height);
  else doc.roundedRect(x, y, w, height, DC_RADIUS, DC_RADIUS);

  setLabelStyle(doc);
  doc.text(label.toUpperCase(), x + CELL_X, y + 10.5);
  clearLabelStyle(doc);

  // Centre of the checkbox row, leaving the label its own band above
  const cy = y + height - 16;
  let cx = x + CELL_X;
  options.forEach(option => {
    checkboxText(doc, cx, cy, option);
    if (value === option) markCheckbox(doc, cx, cy);
    doc.setFontSize(9.5);
    cx += CHECKBOX_SIZE + 6 + doc.getTextWidth(option) + 22;
  });
  return y + height;
}

/* ============ FORD FORM ============ */
function buildFordDoc(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const marginX = 40;
  const W = 532;
  let y = drawDocHeader(doc, marginX, 54, W, FORMS_CONFIG.ford.title);

  // The band sits flush on the grid below it (no gap), so the two read as one component.
  y = sectionBar(doc, marginX, y, W, 'Section A:', ' Employee Details & Grievance Summary');

  const w4 = W / 4;
  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Employee Name', value: data.employeeName, width: w4 },
    { label: 'Global ID', value: data.globalId, width: w4 },
    { label: 'Department', value: data.department, width: w4 },
    { label: 'Process Coach', value: data.processCoach, width: w4 },
  ], 34, true);
  y += 10;

  // Article Violation spans two grid columns, Date of Incident/Filed each take one, so the
  // dividers in this row land exactly on the dividers from the row above.
  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Article Violation', value: data.article, width: w4 * 2 },
    { label: 'Date of Incident', value: fmtDateFit(doc, data.dateIncident, w4 - CELL_X * 2), width: w4 },
    { label: 'Date Filed', value: fmtDateFit(doc, data.dateFiled, w4 - CELL_X * 2), width: w4 },
  ]);
  y += 10;

  // flowTextBox paginates itself if the value is long, so no pre-emptive page-break needed here
  y = flowTextBox(doc, marginX, y + 6, W, 'Details of Incident:', data.details, 70);
  y += 14;

  // Two columns so the gap between them lands on the 4-column grid's centre divider above.
  const hoursGap = 10;
  const hoursColW = (W - hoursGap) / 2;
  const HOURS = [
    ['Hours at straight time', data.hoursStraight, 'Hours of #1 Shift Prem', data.hoursShift1],
    ['Hours at time & one half', data.hoursTimeHalf, 'Hours of #3 Shift Prem', data.hoursShift3],
    ['Hours at double time', data.hoursDouble, 'Hours at triple time', data.hoursTriple],
  ];
  y = ensureSpace(doc, y, HOURS.length * (HOUR_CELL_H + hoursGap));
  HOURS.forEach(([lLabel, lValue, rLabel, rValue]) => {
    hourCell(doc, marginX, y, hoursColW, lLabel, lValue);
    hourCell(doc, marginX + hoursColW + hoursGap, y, hoursColW, rLabel, rValue);
    y += HOUR_CELL_H + hoursGap;
  });
  y += 4;

  // ---- Section B: Department Response (reserved, left blank for department) ----
  // Column widths are quarters of W, same unit as Section A/D, so the dividers line up down the page.
  y = drawResponseSection(doc, marginX, W, y, 'Section B:', ' Department Response', [
    { label: 'Department Representative (print name)', value: '', width: w4 * 2 },
    { label: 'Signature', value: '', width: w4 },
    { label: 'Department Charge No', value: '', width: w4 },
  ], 34, 100, {
    height: 30,
    draw(doc, x, y, w) {
      const approveH = 30;
      doc.setDrawColor(...DC.border);
      doc.setLineWidth(0.75);
      doc.rect(x, y, w, approveH);
      doc.setDrawColor(...DC.divider);
      doc.line(x + w * 0.42, y, x + w * 0.58, y + approveH);
      checkboxText(doc, x + 16, y + approveH / 2, 'Grievance Approved');
      checkboxText(doc, x + w * 0.62, y + approveH / 2, 'Grievance Denied');
    },
  });

  // ---- Section C: Employee Relations Response (reserved) ----
  // Same quarter-width unit as every other grid row in this document.
  y = drawResponseSection(doc, marginX, W, y, 'Section C:', ' Employee Relations Response', [
    { label: 'Employee Relations Representative (print name)', value: '', width: w4 },
    { label: 'Signature', value: '', width: w4 },
    { label: 'Grievance Stage', value: '', width: w4 },
    { label: 'Number', value: '', width: w4 },
  ], 34, 100);

  // ---- Section D: Payroll & Accounting Department (reserved) ----
  y = drawResponseSection(doc, marginX, W, y, 'Section D:', ' Payroll & Accounting Department', [
    { label: 'Rate', value: '', width: w4 },
    { label: 'Hours', value: '', width: w4 },
    { label: 'Amount', value: '', width: w4 },
    { label: 'Pay Period', value: '', width: w4 },
  ], 34, 100);

  embedFormData(doc, 'ford', data);
  return doc;
}

const fordForm = document.getElementById('fordForm');

fordForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = fd(e.target);
  const doc = buildFordDoc(data);
  openWithAttachments(doc, 'ford', buildFilename(data.employeeName, 'Grievance Claim', data.dateIncident));
});

document.getElementById('fordClear').addEventListener('click', () => {
  clearForm(fordForm);
});

/* ============ POLICY GRIEVANCE FORM ============ */
/* A trimmed variant of the Ford form for policy grievances: same Section A layout, but with the
   hours grid and the money-related Section D (Payroll & Accounting) removed entirely. */
function buildPolicyDoc(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const marginX = 40;
  const W = 532;
  let y = drawDocHeader(doc, marginX, 54, W, FORMS_CONFIG.policy.title);

  y = sectionBar(doc, marginX, y, W, 'Section A:', ' Employee Details & Grievance Summary');

  const w4 = W / 4;
  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Employee Name', value: data.employeeName, width: w4 },
    { label: 'Global ID', value: data.globalId, width: w4 },
    { label: 'Department', value: data.department, width: w4 },
    { label: 'Process Coach', value: data.processCoach, width: w4 },
  ], 34, true);
  y += 10;

  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Article Violation', value: data.article, width: w4 * 2 },
    { label: 'Date of Incident', value: fmtDateFit(doc, data.dateIncident, w4 - CELL_X * 2), width: w4 },
    { label: 'Date Filed', value: fmtDateFit(doc, data.dateFiled, w4 - CELL_X * 2), width: w4 },
  ]);
  y += 10;

  y = flowTextBox(doc, marginX, y + 6, W, 'Details of Incident:', data.details, 70);
  y += 14;

  // ---- Section B: Department Response (reserved, left blank for department) ----
  // Column widths are quarters of W, same unit as Section A/D, so the dividers line up down the page.
  y = drawResponseSection(doc, marginX, W, y, 'Section B:', ' Department Response', [
    { label: 'Department Representative (print name)', value: '', width: w4 * 2 },
    { label: 'Signature', value: '', width: w4 },
    { label: 'Department Charge No', value: '', width: w4 },
  ], 34, 100, {
    height: 30,
    draw(doc, x, y, w) {
      const approveH = 30;
      doc.setDrawColor(...DC.border);
      doc.setLineWidth(0.75);
      doc.rect(x, y, w, approveH);
      doc.setDrawColor(...DC.divider);
      doc.line(x + w * 0.42, y, x + w * 0.58, y + approveH);
      checkboxText(doc, x + 16, y + approveH / 2, 'Grievance Approved');
      checkboxText(doc, x + w * 0.62, y + approveH / 2, 'Grievance Denied');
    },
  });

  // ---- Section C: Employee Relations Response (reserved) ----
  // Same quarter-width unit as every other grid row in this document.
  y = drawResponseSection(doc, marginX, W, y, 'Section C:', ' Employee Relations Response', [
    { label: 'Employee Relations Representative (print name)', value: '', width: w4 },
    { label: 'Signature', value: '', width: w4 },
    { label: 'Grievance Stage', value: '', width: w4 },
    { label: 'Number', value: '', width: w4 },
  ], 34, 100);

  embedFormData(doc, 'policy', data);
  return doc;
}

const policyForm = document.getElementById('policyForm');

policyForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = fd(e.target);
  const doc = buildPolicyDoc(data);
  openWithAttachments(doc, 'policy', buildFilename(data.employeeName, 'Policy Grievance', data.dateIncident));
});

document.getElementById('policyClear').addEventListener('click', () => {
  clearForm(policyForm);
});

/* ============ UNIFOR FORM ============ */
function buildUniforDoc(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const marginX = 40;
  const W = 532;
  let y = drawUniforPageHeader(doc, marginX, W, data);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...DC.ink);
  const uniforTitleLines = doc.splitTextToSize(FORMS_CONFIG.unifor.title, W);
  uniforTitleLines.forEach((line, i) => doc.text(line, 306, y + i * 18, { align: 'center' }));
  y += (uniforTitleLines.length - 1) * 18 + 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...DC.labelSoft);
  doc.text('For Local Union Use Only', 306, y, { align: 'center' });
  y += 12;
  doc.text('This form to accompany First Stage Grievance appealed to Bargaining Committee', 306, y, { align: 'center' });
  y += 24;

  const w4 = W / 4;
  const w3 = W / 3;

  // ---- Section A: who the grievor is ----
  y = sectionBar(doc, marginX, y, W, 'Section A:', ' Grievor');
  y = boxedGrid(doc, marginX, y, W, [
    { label: "Grievor's Name", value: data.grievorName, width: w4 * 2 },
    { label: 'GID #', value: data.gid, width: w4 },
    { label: 'Dept', value: data.dept, width: w4 },
  ], CELL_MIN_H, true);
  y += 10;

  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Classification', value: data.classification, width: w4 * 2 },
    { label: 'Seniority Date', value: fmtDateFit(doc, data.seniorityDate, w4 - CELL_X * 2), width: w4 },
    { label: 'Time in Classification', value: data.timeInClass, width: w4 },
  ]);
  y += 10;

  /*
   * Rate and COLA are read together, so they stay adjacent; Discipline sits beside them rather
   * than taking a band-width row of its own, being a fact about the grievor's record.
   *
   * Two half-width blocks with a gap between, not one full-width grid with a box laid over its
   * right half — drawn that way, the grid's own border ran on underneath the checkboxes and
   * printed as a stray line. Both are given the same height so their edges line up.
   */
  const halfW = (W - 10) / 2;
  const splitH = Math.max(measureBoxedGrid(doc, [
    { label: 'Rate $', value: formatCurrency(data.rate), width: halfW / 2 },
    { label: 'COLA $', value: formatCurrency(data.cola), width: halfW / 2 },
  ], CELL_MIN_H), CHECKBOX_ROW_H);

  boxedGrid(doc, marginX, y, halfW, [
    { label: 'Rate $', value: formatCurrency(data.rate), width: halfW / 2 },
    { label: 'COLA $', value: formatCurrency(data.cola), width: halfW / 2 },
  ], splitH);
  checkboxFieldRow(doc, marginX + halfW + 10, y, halfW,
    'Discipline on Record?', ['Yes', 'No'], data.discipline, false, splitH);
  y += splitH + 14;

  // ---- Section B: the chain of supervision, and the dates ----
  y = sectionBar(doc, marginX, y, W, 'Section B:', ' Supervision & Filing');
  y = boxedGrid(doc, marginX, y, W, [
    { label: "Employee's Supervisor", value: data.supervisor, width: w3 },
    { label: 'General Supervisor', value: data.generalSupervisor, width: w3 },
    { label: 'Superintendent', value: data.superintendent, width: w3 },
  ], CELL_MIN_H, true);
  y += 10;

  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Date of Incident', value: fmtDateFit(doc, data.uniforDateIncident, w4 * 2 - CELL_X * 2), width: w4 * 2 },
    { label: 'Date Grievance Filed', value: fmtDateFit(doc, data.uniforDateFiled, w4 * 2 - CELL_X * 2), width: w4 * 2 },
  ]);
  y += 14;

  // ---- Section C: the grievance itself ----
  y = sectionBar(doc, marginX, y, W, 'Section C:', ' The Grievance');
  y += 12;

  // flowTextBox paginates itself if the value is long, so no pre-emptive page-break needed here
  y = flowTextBox(doc, marginX, y, W, 'Who is involved in this grievance?', data.whoInvolved, 44);
  y += 12;

  y = boxedGrid(doc, marginX, y, W, [
    { label: 'When did it happen?', value: data.whenHappened, width: w4 * 2 },
    { label: 'Where did it happen?', value: data.whereHappened, width: w4 * 2 },
  ]);
  y += 12;

  y = flowTextBox(doc, marginX, y, W, 'Why is this a grievance?', data.whyGrievance, 70);
  y += 12;

  y = flowTextBox(doc, marginX, y, W, 'What do we want?', data.whatWeWant, 56);

  drawUniforFooter(doc, marginX, W, 1);

  // ---- Page 2: Supervisor's Statement / Your Observation / Additional Information ----
  doc.addPage();
  y = drawUniforPageHeader(doc, marginX, W, data);
  y = sectionBar(doc, marginX, y, W, 'Section D:', ' Statements');
  y += 12;
  y = flowTextBox(doc, marginX, y, W, "Supervisor's Statement", data.supervisorStatement, 170);
  y += 14;
  y = flowTextBox(doc, marginX, y, W, 'Your Observation', data.yourObservation, 170);
  y += 14;
  y = flowTextBox(doc, marginX, y, W, 'Additional Information', data.additionalInfo, 170);
  drawUniforFooter(doc, marginX, W, 2);

  // ---- Page 3: Investigation questions ----
  doc.addPage();
  y = drawUniforPageHeader(doc, marginX, W, data);
  y = sectionBar(doc, marginX, y, W, 'Section E:', ' Investigation');
  y += 16;

  // Checkboxes are drawn taller (15pt) than a text line, anchored to the question's first line —
  // so the gap after a yes/no question needs extra room beyond the label's own line height,
  // otherwise two consecutive checkbox rows (or a checkbox row and the next box) end up only a
  // few points apart. YES_NO_LINE_GAP covers a line of wrapped label text plus that clearance.
  const YES_NO_LINE_GAP = 16;
  const YES_NO_TRAILING_GAP = 16;

  const q1Lines = yesNoQuestion(
    doc, marginX, y,
    "Have you discussed the supervisor's disposition to the aggrieved? If not, please do so and detail below.",
    data.discussedDisposition, marginX + 340, 300
  );
  y += q1Lines * YES_NO_LINE_GAP + YES_NO_TRAILING_GAP;
  y = flowTextBox(doc, marginX, y, W, 'Details:', data.dispositionDetail, 44);
  y += 14;

  y = flowTextBox(doc, marginX, y, W, 'What other members are affected? (other than the aggrieved)', data.otherMembersAffected, 40);
  y += 14;
  y = flowTextBox(doc, marginX, y, W, 'Name any Witnesses (if possible, get individual signed statements)', data.witnesses, 40);
  y += 14;
  y = flowTextBox(doc, marginX, y, W, 'What has the past practice been in regard to similar violations?', data.pastPractice, 40);
  y += 14;

  const q2Lines = yesNoQuestion(doc, marginX, y, 'Has a violation of this nature been called to the Company’s attention before?', data.priorViolation, marginX + 340, 300);
  y += q2Lines * YES_NO_LINE_GAP + YES_NO_TRAILING_GAP;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...DC.ink);
  doc.text('If so, when?', marginX, y);
  setValueStyle(doc);
  doc.text(data.priorViolationWhen || '', marginX + 70, y);
  y += 18;
  y = flowTextBox(doc, marginX, y, W, 'What action did the company take?', data.companyAction, 40);
  y += 14;

  const q3Lines = yesNoQuestion(doc, marginX, y, 'Did the supervisor make any effort to settle this in the discussion?', data.settleEffort, marginX + 340, 300);
  y += q3Lines * YES_NO_LINE_GAP + YES_NO_TRAILING_GAP;
  const q4Lines = yesNoQuestion(doc, marginX, y, 'Did they make an offer?', data.madeOffer, marginX + 340, 300);
  y += q4Lines * YES_NO_LINE_GAP + YES_NO_TRAILING_GAP;
  flowTextBox(doc, marginX, y, W, 'What exactly were they willing to do?', data.willingToDo, 50);

  drawUniforFooter(doc, marginX, W, 3);

  // ---- Page 4: Statements, settlement, submission ----
  doc.addPage();
  y = drawUniforPageHeader(doc, marginX, W, data);
  y = sectionBar(doc, marginX, y, W, 'Section F:', ' Assessment & Submission');
  y += 12;
  y = flowTextBox(doc, marginX, y, W, "Which of the supervisor's statements are true?", data.statementsTrue, 46);
  y += 10;
  y = flowTextBox(doc, marginX, y, W, 'Which are false?', data.statementsFalse, 46);
  y += 10;
  y = flowTextBox(doc, marginX, y, W, 'What do you think a reasonable settlement would be?', data.reasonableSettlement, 50);
  y += 10;
  y = flowTextBox(doc, marginX, y, W, 'Any other suggestions or comments?', data.otherComments, 50);
  y += 14;

  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Submitted By', value: data.submittedBy, width: W * 0.65 },
    { label: 'Shift', value: data.shift, width: W * 0.35 },
  ]);
  y += 24;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...DC.ink);
  doc.text("Grievor's Signature:", marginX, y);
  doc.setDrawColor(...DC.ink);
  doc.setLineWidth(0.75);
  doc.line(marginX + 110, y + 2, marginX + 400, y + 2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...DC.labelSoft);
  const noteLines = doc.splitTextToSize(
    'NOTE: These facts are basic requirements to the grievance procedure. They must be filled out. ' +
    'Additional facts may be filled in on space available, or attached separately.',
    W
  );
  doc.text(noteLines, marginX, 748);

  drawUniforFooter(doc, marginX, W, 4);

  // ---- Page 5: Committee comments ----
  doc.addPage();
  y = drawUniforPageHeader(doc, marginX, W, data);
  y = sectionBar(doc, marginX, y, W, 'Section G:', ' Committee Comments');
  y += 12;
  y = flowTextBox(doc, marginX, y, W, "Committeeperson's Comments on Second Stage", data.committeepersonComments, 280);
  y += 14;
  flowTextBox(doc, marginX, y, W, "Plant Chair's Comments on Third Stage", data.plantChairComments, 280);

  drawUniforFooter(doc, marginX, W, 5);

  embedFormData(doc, 'unifor', data);
  return doc;
}

const uniforForm = document.getElementById('uniforForm');

uniforForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = fd(e.target);
  const doc = buildUniforDoc(data);
  openWithAttachments(doc, 'unifor', buildFilename(data.grievorName, 'Fact Sheet', data.uniforDateIncident));
});

document.getElementById('uniforClear').addEventListener('click', () => {
  clearForm(uniforForm);
});

/* ============ 4.01 INVESTIGATION FORM ============ */
function buildInvestigationDoc(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const marginX = 40;
  const W = 532;
  let y = 40;

  y = drawDocHeader(doc, marginX, 54, W, FORMS_CONFIG.investigation.title, '', { label: 'Step:', value: data.step });

  const w4 = W / 4;

  // ---- Details: where, when, and who was in the room ----
  y = sectionBar(doc, marginX, y, W, 'Details', '');
  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Name of Supervisor', value: data.supervisorName, width: w4 * 2 },
    { label: 'Area', value: data.area, width: w4 },
    { label: 'Dept #', value: data.deptNum, width: w4 },
  ], CELL_MIN_H, true);
  y += 10;
  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Date of Infraction', value: fmtDateFit(doc, data.dateInfraction, w4 - CELL_X * 2), width: w4 },
    { label: 'Time', value: data.time, width: w4 },
    { label: 'Date Filed', value: fmtDateFit(doc, data.dateFiled, w4 - CELL_X * 2), width: w4 },
    { label: 'Name of Witnesses', value: data.witnessNames, width: w4 },
  ]);
  y += 10;
  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Unifor Representative', value: data.uniforRep, width: w4 * 2 },
    { label: 'HR Representative', value: data.hrRep, width: w4 * 2 },
  ]);
  y += 14;

  // ---- Investigation: the account, and the supervisor's answer to it ----
  y = sectionBar(doc, marginX, y, W, 'Investigation', '');
  y += 12;
  y = flowTextBox(doc, marginX, y, W, 'Investigation of Incident:', data.investigation, 160);
  y += 14;
  y = flowTextBox(doc, marginX, y, W, "Supervisor's Remarks:", data.supervisorRemarks, 120);
  y += 14;

  // ---- Resolution: one box, already named by the band, so no label of its own ----
  y = sectionBar(doc, marginX, y, W, 'Resolution', '');
  flowTextBox(doc, marginX, y + 8, W, '', data.resolution, 100);

  embedFormData(doc, 'investigation', data);
  return doc;
}

const investigationForm = document.getElementById('investigationForm');

investigationForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = fd(e.target);
  const doc = buildInvestigationDoc(data);
  openWithAttachments(doc, 'investigation', buildFilename(data.supervisorName, 'Investigation Form', data.dateInfraction));
});

document.getElementById('investigationClear').addEventListener('click', () => {
  clearForm(investigationForm);
});


/* ============ Unsaved-changes guard ============ */
function formHasData(form) {
  return Array.from(form.elements).some(el => {
    if (!el.name) return false;
    if (el.type === 'radio' || el.type === 'checkbox') return false;
    return (el.value || '').toString().trim() !== '';
  });
}

/*
 * The "are you sure you want to leave" prompt only applies when drafts can't be saved. With
 * autosave working there's nothing to lose by closing the tab, and the prompt is just a dialog
 * in the way. If storage is unavailable — private browsing, or a locked-down profile — the
 * warning is the only protection left, so it comes back.
 */
window.addEventListener('beforeunload', (e) => {
  if (draftsAvailable()) return;
  if (formHasData(fordForm) || formHasData(policyForm) || formHasData(uniforForm) || formHasData(investigationForm)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ============ Form registry ============ */
const FORM_BUILDERS = {
  ford: { form: fordForm, build: buildFordDoc, label: 'Grievance Claim' },
  policy: { form: policyForm, build: buildPolicyDoc, label: 'Policy Grievance' },
  unifor: { form: uniforForm, build: buildUniforDoc, label: 'Fact Sheet' },
  investigation: { form: investigationForm, build: buildInvestigationDoc, label: 'Investigation Form' },
};

let currentFormType = null;

/* ============ Home / fill-form view routing ============ */
const homeView = document.getElementById('homeView');

function showHome() {
  currentFormType = null;
  homeView.hidden = false;
  workspace.hidden = true;
  builderView.hidden = true;
  refreshClearAllButton();
  refreshDraftFlags();
}

/*
 * Empties every field in a form. Deliberately not form.reset() — reset restores each field's
 * *default*, which for these forms is the sample content written into the HTML, so a button
 * labelled "Clear form" would put the sample data back instead of clearing anything.
 */
function clearForm(form) {
  Array.from(form.elements).forEach(el => {
    if (el.type === 'radio' || el.type === 'checkbox') el.checked = false;
    else if (el.type === 'hidden' && el.closest('.datepicker')) el.closest('.datepicker').setValue('');
    else if (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'date') el.value = '';
  });
  form.querySelectorAll('.datepicker').forEach(dp => dp.refreshDisplay && dp.refreshDisplay());
  form.querySelectorAll(DC_AUTOGROW).forEach(autoGrow);
  if (currentFormType) {
    discardDraft(currentFormType);
    updatePageBreaks(currentFormType);
  }
}

/* Fills a form's fields (including custom date pickers) from a plain {name: value} object */
function populateForm(form, data) {
  form.reset();
  Object.entries(data).forEach(([key, value]) => {
    const el = form.elements[key];
    if (!el) return;
    if (typeof RadioNodeList !== 'undefined' && el instanceof RadioNodeList) {
      Array.from(el).forEach(radio => { radio.checked = radio.value === value; });
    } else if (el.type === 'hidden' && el.closest('.datepicker')) {
      el.closest('.datepicker').setValue(value);
    } else {
      el.value = value;
    }
  });
}

function showForm(type, data) {
  currentFormType = type;
  homeView.hidden = true;
  builderView.hidden = true;
  workspace.hidden = false;
  panels.forEach(p => p.classList.remove('active'));
  document.getElementById('form-' + type).classList.add('active');
  const entry = FORM_BUILDERS[type];
  if (data) {
    populateForm(entry.form, data);
  } else {
    entry.form.reset();
    // Hand back whatever was last typed into this form on this device
    const draft = readDraft(type);
    if (draft) populateForm(entry.form, draft.data);
  }
  document.querySelectorAll('.datepicker').forEach(dp => dp.refreshDisplay && dp.refreshDisplay());
  // scrollHeight reads 0 while the panel is hidden, so size the textareas now that it's visible
  entry.form.querySelectorAll(DC_AUTOGROW).forEach(autoGrow);
  updatePageBreaks(type);
  if (entry.syncSheet) entry.syncSheet();
  renderAttachmentList(type);
}

document.querySelectorAll('.form-card').forEach(card => {
  card.addEventListener('click', () => showForm(card.dataset.form));
});

document.querySelectorAll('[data-back-to-forms]').forEach(button => {
  button.addEventListener('click', () => {
    // Nothing to warn about any more: the draft is already saved on this device
    showHome();
  });
});

/* ============ Upload & recognize a previously generated PDF ============ */
const uploadInput = document.getElementById('uploadInput');
const uploadError = document.getElementById('uploadError');

/*
 * A PDF we didn't make can't be auto-filled: the fields are read back out of metadata this app
 * embeds, and a form from anywhere else has none. Reading one back off the page would mean OCR,
 * which is the wrong tool — see the note on the upload handler.
 *
 * So rather than a dead end, an unrecognised file can still be opened and read here, which is
 * what it's usually wanted for: having the filed copy on screen while typing the next one.
 */
function showUploadError(message, file) {
  uploadError.textContent = '';
  const text = document.createElement('span');
  text.textContent = message;
  uploadError.appendChild(text);

  if (file) {
    const markUp = document.createElement('button');
    markUp.type = 'button';
    markUp.className = 'upload-error-action';
    markUp.textContent = 'Open and mark it up';
    markUp.addEventListener('click', () => {
      uploadError.hidden = true;
      openForMarkup(file);
    });

    const view = document.createElement('button');
    view.type = 'button';
    view.className = 'upload-error-action is-quiet';
    view.textContent = 'Just view it';
    view.addEventListener('click', () => {
      uploadError.hidden = true;
      showPdf(file, file.name, null);
    });

    uploadError.append(markUp, view);
  }
  uploadError.hidden = false;
}

/* One path for both ways in: the file picker and a file dropped on the page */
async function handleIncomingFile(file) {
  if (!file) return;

  uploadError.hidden = true;
  // A handover file from another application, riding in on the same route as a PDF
  if (/\.(json|grv)$/i.test(file.name) || file.type === 'application/json' ||
      file.type === 'application/grievance+json') {
    await handleJsonImport(file);
    return;
  }
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    showUploadError('That isn’t a PDF.');
    return;
  }

  /*
   * Recognition is by the metadata embedded on the way out, not by reading the page. OCR was
   * considered and doesn't fit: it would add megabytes to a bundle that has to work offline,
   * it can't read the handwriting that fills most of a returned grievance, and even with
   * perfect text it still wouldn't know which words belong in which field.
   */
  const bytes = new Uint8Array(await file.arrayBuffer());
  const payload = readEmbeddedFormData(bytes);
  if (!payload) {
    showUploadError('This PDF wasn’t made here, so its fields can’t be filled in.', file);
    return;
  }
  if (!FORM_BUILDERS[payload.formType]) {
    showUploadError('That PDF names a form this app doesn’t have.', file);
    return;
  }
  showForm(payload.formType, payload.data);
}

/* ============ Handing a form to another device ============
 *
 * The same values a .json handover carries, saved back out. The extension is .grv rather than
 * .json so the installed app can claim it without taking over every JSON file on the machine —
 * double-clicking one opens it here. Reading it is the route above; nothing extra is needed.
 */
function buildGrv(type) {
  // fd() is what the PDF round-trip already serialises with, so a .grv carries exactly as much
  const fields = {};
  Object.entries(fd(FORM_BUILDERS[type].form)).forEach(([key, value]) => {
    const text = String(value).trim();
    if (text) fields[key] = text;
  });
  return { app: 'local200forms', form: type, saved: new Date().toISOString(), fields };
}

function saveGrv(type) {
  const form = FORM_BUILDERS[type].form;
  const payload = buildGrv(type);
  const who = (form.elements[KEY_FIELD] && form.elements[KEY_FIELD].value.trim()) || 'Grievance';
  const name = who.replace(/[\/:*?"<>|]/g, '').trim() + ' - ' + FORM_BUILDERS[type].label + '.grv';

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/grievance+json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

document.querySelectorAll('[data-save-grv]').forEach(button => {
  button.addEventListener('click', () => {
    const type = button.dataset.saveGrv;
    if (!formHasContent(type)) {
      showUploadError('Nothing to save yet.');
      return;
    }
    const name = saveGrv(type);
    // Same reasoning as the PDF download: it lands in a folder without a word otherwise
    const said = button.textContent;
    button.textContent = 'Saved ' + name;
    button.disabled = true;
    setTimeout(() => { button.textContent = said; button.disabled = false; }, 3000);
  });
});

/*
 * Pasting a grievance straight onto the Forms page. Ctrl+V, nothing else — no button, no menu
 * item, no hint. It's one rep's shortcut for moving a grievance across from another app, and a
 * control on screen would be a thing every other rep has to wonder about.
 *
 * Which is why this is silent unless the clipboard genuinely holds a grievance. A stray Ctrl+V
 * with a phone number or half an email on the clipboard does nothing whatsoever — no error, no
 * flicker. The only time it speaks up is when the text really is JSON but can't be used, because
 * at that point someone is deliberately pasting and an unexplained silence would be worse.
 */
document.addEventListener('paste', (e) => {
  if (homeView.hidden) return;                       // only on the Forms page
  if (!importOverlay.hidden || !adminOverlay.hidden || !pdfViewer.hidden || !editor.hidden) return;

  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;  // let a real field have its paste

  const text = ((e.clipboardData || window.clipboardData).getData('text') || '').trim();
  // The cheap test first: anything that isn't a JSON object isn't ours, and isn't worth a word
  if (text.charAt(0) !== '{' || text.charAt(text.length - 1) !== '}') return;

  e.preventDefault();
  try {
    const result = readGrievanceJson(text);
    uploadError.hidden = true;              // clear anything left over from a previous attempt
    showImport(result, 'What you pasted');
  } catch (err) {
    showUploadError('That paste didn’t work: ' + err.message + '.');
  }
});

/* ============ How pictures are laid out on a page ============
 *
 * One control, the same three choices wherever pictures turn into pages — the builder and a
 * form's supporting documents both. The labels say what happens; there is no help text under
 * them, because a line of prose explaining "Two pictures per page" would be worse than nothing.
 */
const PAGE_LAYOUTS = [
  { value: 'image', label: 'Page fits the picture' },
  { value: 'letter', label: 'One picture per page' },
  { value: 'pair', label: 'Two pictures per page' },
];

function layoutPicker(current, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'layout-picker';

  const row = document.createElement('label');
  row.className = 'layout-row';
  const caption = document.createElement('span');
  caption.className = 'layout-caption';
  caption.textContent = 'Page layout';

  const select = document.createElement('select');
  select.className = 'layout-select';
  PAGE_LAYOUTS.forEach(option => {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    select.appendChild(el);
  });
  select.value = current;
  select.addEventListener('change', () => onChange(select.value));

  row.append(caption, select);
  wrap.appendChild(row);
  return wrap;
}

/* ============ Building a PDF out of images ============
 *
 * A dozen screenshots from the accounting software, sent as one document instead of a dozen
 * attachments. Each image becomes a page; a PDF dropped in contributes its pages unchanged,
 * still vector, still searchable.
 *
 * Separate from a form's attachments on purpose — that pile rides on the end of a grievance,
 * this one is the whole document.
 */
const builderView = document.getElementById('builderView');
const builderPages = document.getElementById('builderPages');
const builderError = document.getElementById('builderError');
let builderItems = [];
let builderFit = 'image';        // screenshots are what this is for, so pages match them

function showBuilder() {
  currentFormType = null;
  homeView.hidden = true;
  workspace.hidden = true;
  builderView.hidden = false;
  builderError.hidden = true;
  renderBuilder();
}

function builderPageCount() {
  return builderItems.reduce((n, item) => n + item.pages.length, 0);
}

function showBuilderError(message) {
  builderError.textContent = message;
  builderError.hidden = false;
}

function renderBuilder() {
  const pages = builderPageCount();
  document.getElementById('builderCount').textContent =
    builderItems.length === 0 ? 'Nothing added yet'
      : pages + (pages === 1 ? ' page' : ' pages') +
        ' from ' + builderItems.length + (builderItems.length === 1 ? ' file' : ' files');
  document.getElementById('builderPreview').disabled = builderItems.length === 0;
  document.getElementById('builderClear').disabled = builderItems.length === 0;

  // Only worth asking about once there's a picture for it to affect
  const layoutHost = document.getElementById('builderLayout');
  layoutHost.innerHTML = '';
  const hasPicture = builderItems.some(item => item.kind !== 'pdf');
  layoutHost.hidden = !hasPicture;
  if (hasPicture) {
    layoutHost.appendChild(layoutPicker(builderFit, value => { builderFit = value; }));
  }

  builderPages.innerHTML = '';
  let pageNumber = 1;
  builderItems.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'builder-card';

    const thumb = document.createElement('div');
    thumb.className = 'builder-thumb';
    if (item.pages[0] && item.pages[0].view) thumb.appendChild(item.pages[0].view);

    const name = document.createElement('span');
    name.className = 'builder-name';
    name.textContent = item.name;

    const where = document.createElement('span');
    where.className = 'builder-where';
    where.textContent = item.pages.length === 1
      ? 'Page ' + pageNumber
      : 'Pages ' + pageNumber + '–' + (pageNumber + item.pages.length - 1);
    pageNumber += item.pages.length;

    const actions = document.createElement('div');
    actions.className = 'builder-card-actions';

    // The same editor the supporting documents use — one set of tools to learn, not two
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'builder-markup';
    edit.textContent = 'Mark up';
    edit.addEventListener('click', () => openEditor(item, () => renderBuilder()));

    const move = (label, to, enabled) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'builder-move';
      b.textContent = label;
      b.disabled = !enabled;
      b.title = label === '↑' ? 'Move earlier' : 'Move later';
      b.addEventListener('click', () => {
        const [moved] = builderItems.splice(index, 1);
        builderItems.splice(to, 0, moved);
        renderBuilder();
      });
      return b;
    };
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'builder-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      builderItems.splice(index, 1);
      renderBuilder();
    });
    actions.append(move('↑', index - 1, index > 0),
                   move('↓', index + 1, index < builderItems.length - 1),
                   edit, remove);

    card.append(thumb, name, where, actions);
    builderPages.appendChild(card);
  });
}

/* Anything that can become a page. Rejected files are named rather than passed over in silence */
async function addToBuilder(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  const refused = [];
  for (const file of list) {
    const usable = /^image\//.test(file.type) || /\.(png|jpe?g)$/i.test(file.name) ||
                   /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    if (!usable) {
      refused.push(file.name || 'that file');
      continue;
    }
    try {
      builderItems.push(await Annotator.readFile(file));
    } catch (err) {
      refused.push((file.name || 'that file') + ' (' + err.message + ')');
    }
  }
  renderBuilder();
  if (refused.length) showBuilderError('Couldn’t use ' + refused.join(', ') + '.');
  else builderError.hidden = true;
}

document.getElementById('openBuilder').addEventListener('click', showBuilder);
document.getElementById('builderInput').addEventListener('change', (e) => {
  const files = e.target.files;
  e.target.value = '';                       // so the same file can be picked again
  addToBuilder(files);
});
document.getElementById('builderClear').addEventListener('click', () => {
  if (builderItems.length && !confirm('Start over? The pages added so far will be dropped.')) return;
  builderItems = [];
  builderError.hidden = true;
  renderBuilder();
});

document.getElementById('builderPreview').addEventListener('click', async () => {
  if (!builderItems.length) return;
  const button = document.getElementById('builderPreview');
  const said = button.textContent;
  button.textContent = 'Building…';
  button.disabled = true;
  try {
    const bytes = await Annotator.compile(builderItems, builderFit);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    await showPdf(blob, builderFilename(), null, showBuilder);
  } catch (err) {
    showBuilderError('Couldn’t build that PDF: ' + err.message + '.');
  } finally {
    button.textContent = said;
    button.disabled = false;
  }
});

function builderFilename() {
  const now = new Date();
  const date = MONTH_NAMES_FULL[now.getMonth()] + ' ' + now.getDate() + ' ' + now.getFullYear();
  return 'Supporting Documents - ' + date + '.pdf';
}

/* A screenshot on the clipboard is the whole point of this, so paste is the first-class way in */
document.addEventListener('paste', (e) => {
  if (builderView.hidden) return;
  const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
  const files = items.filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
  if (!files.length) return;
  e.preventDefault();
  addToBuilder(files);
});

/* ---------- Arriving from somewhere else ---------- */

/*
 * A grievance carried in the address, for the other app to hand one over with a plain link:
 *
 *   https://evanking17.github.io/local200forms/#grv=<base64 of the JSON>
 *
 * It goes after the # deliberately. A fragment is never sent in the HTTP request, so the
 * grievance never reaches GitHub's servers — put the same thing in a ?query and it lands in
 * their logs. On Android an installed copy claims links inside its own scope, so a link like
 * this opens the app; without it installed the same link opens the site and still works.
 */
function decodeGrvPayload(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) throw new Error('the link carried nothing');
  let text;
  try {
    text = decodeURIComponent(trimmed);
  } catch (err) {
    throw new Error('the link couldn’t be decoded');   // stray % escapes, usually a mangled paste
  }
  if (!text) throw new Error('the link carried nothing');
  if (text.charAt(0) === '{') return text;             // sent as plain JSON, already readable

  // base64, in either alphabet, with the padding the sender may well have trimmed
  let b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  b64 += '='.repeat((4 - (b64.length % 4)) % 4);
  try {
    return fromBase64(b64);
  } catch (err) {
    throw new Error('the link couldn’t be decoded');
  }
}

/* Pulls the payload out of a whole URL, since a shared link arrives as one */
function grvFromUrl(text) {
  const m = String(text).match(/[#&?]grv=([^&\s]+)/);
  return m ? m[1] : null;
}

function readGrvLink(payload) {
  const json = decodeGrvPayload(payload);
  return readGrievanceJson(json);
}

function consumeGrvLink() {
  const payload = grvFromUrl(location.hash);
  if (!payload) return;
  // Out of the address before anything else: a reload shouldn't offer the same import twice,
  // and a grievance has no business sitting in a visible URL
  window.history.replaceState(null, '', location.pathname + location.search);
  try {
    showImport(readGrvLink(payload), 'That link');
  } catch (err) {
    showUploadError('That link didn’t work: ' + err.message + '.');
  }
}

// Android may hand the link to a copy that's already open, which only changes the fragment
window.addEventListener('hashchange', consumeGrvLink);

/*
 * Android's share sheet posts to ./share, which the service worker answers by parking what was
 * shared and sending the browser here. Collected once, then cleared, so a later reload doesn't
 * reopen it. A share can be a file or plain text — copying a grievance in another app puts JSON
 * on the clipboard, and sharing that sends text with no file attached.
 */
async function collectSharedFile() {
  const mode = (location.search.match(/[?&]shared=(\w+)/) || [])[1];
  if (!mode || !window.caches) return;
  window.history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('local200forms-share');
    const response = await cache.match('shared-file');
    if (!response) return;
    await cache.delete('shared-file');

    if (mode === 'text') {
      const text = (await response.text()).trim();
      const link = grvFromUrl(text);                   // a shared link rather than the JSON itself
      try {
        showImport(link ? readGrvLink(link) : readGrievanceJson(text), 'What was shared');
      } catch (err) {
        showUploadError('That share didn’t work: ' + err.message + '.');
      }
      return;
    }

    const name = decodeURIComponent(response.headers.get('x-shared-name') || 'shared');
    const type = response.headers.get('content-type') || '';
    await handleIncomingFile(new File([await response.blob()], name, { type }));
  } catch (err) {
    showUploadError('Couldn’t read what was shared.');
  }
}

/* And on the desktop, a .grv opened from the file manager arrives through the launch queue */
if (window.launchQueue && 'files' in window.LaunchParams.prototype) {
  window.launchQueue.setConsumer(async params => {
    for (const handle of params.files || []) {
      await handleIncomingFile(await handle.getFile());
      break;                                   // one form at a time; the rest would overwrite it
    }
  });
}

uploadInput.addEventListener('change', () => {
  const file = uploadInput.files[0];
  uploadInput.value = '';   // so the same file can be chosen again later
  handleIncomingFile(file);
});

/*
 * Drag and drop over the whole window. dragenter/dragleave fire for every element crossed, so
 * a depth counter decides when the file has genuinely left rather than moved onto a child.
 */
const dropOverlay = document.getElementById('dropOverlay');
let dragDepth = 0;

function draggingFile(e) {
  return Array.from(e.dataTransfer && e.dataTransfer.types || []).includes('Files');
}

window.addEventListener('dragenter', (e) => {
  if (!draggingFile(e)) return;
  e.preventDefault();
  dragDepth += 1;
  // The builder highlights its own drop area instead — the overlay's wording is about opening
  // a PDF, which is not what dropping one in there does
  if (!builderView.hidden) builderView.classList.add('is-dragging');
  else dropOverlay.hidden = false;
});

window.addEventListener('dragover', (e) => {
  if (!draggingFile(e)) return;
  e.preventDefault();   // without this the browser refuses the drop
});

window.addEventListener('dragleave', (e) => {
  if (!draggingFile(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) {
    dropOverlay.hidden = true;
    builderView.classList.remove('is-dragging');
  }
});

window.addEventListener('drop', (e) => {
  if (!draggingFile(e)) return;
  e.preventDefault();   // otherwise the browser navigates to the file
  dragDepth = 0;
  dropOverlay.hidden = true;
  builderView.classList.remove('is-dragging');
  const files = Array.from(e.dataTransfer.files || []);
  if (!files.length) return;

  // In the builder everything dropped is a page, and all of it at once rather than the first one
  if (!builderView.hidden) {
    addToBuilder(files);
    return;
  }
  // Images have nowhere to go on a form, but they're exactly what the builder is for
  if (files.every(f => /^image\//.test(f.type))) {
    showBuilder();
    addToBuilder(files);
    return;
  }
  handleIncomingFile(files[0]);
});

/* ============ Clear all forms ============ */
/* Only offered when there's something to lose, rather than sitting there dead */
function refreshClearAllButton() {
  const button = document.getElementById('clearAllForms');
  if (!button || typeof FORM_BUILDERS === 'undefined') return;
  const filled = Object.keys(FORM_BUILDERS).filter(formHasContent);
  button.hidden = filled.length === 0;
  button.textContent = filled.length === 1 ? 'Clear 1 form' : `Clear all ${filled.length} forms`;
}

document.getElementById('clearAllForms').addEventListener('click', () => {
  const filled = Object.keys(FORM_BUILDERS).filter(formHasContent);
  // Wiping several forms and their saved drafts at once is worth one question
  const what = filled.length === 1 ? 'this form' : `all ${filled.length} forms`;
  if (!confirm(`Clear ${what}? Anything typed in and not yet saved as a PDF will be lost.`)) return;

  Object.keys(FORM_BUILDERS).forEach(type => {
    clearForm(FORM_BUILDERS[type].form);
    discardDraft(type);
  });
  refreshClearAllButton();
  refreshDraftFlags();
});

applyFormsConfig();
showHome();

/* ============ Custom date picker ============ */
function dateKeyLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateKey(key) {
  if (!key) return null;
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function isSameDay(a, b) {
  return dateKeyLocal(a) === dateKeyLocal(b);
}

const DATEPICKER_FOCUSABLE = 'button:not([disabled])';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/*
 * Replaces a native <input type="date"> with a popover calendar (quick-picks, month grid,
 * keyboard focus-trap) matching the app's existing DatePicker component. A hidden input keeps
 * the same name/value contract (YYYY-MM-DD, built from local date parts — never parsed through
 * `new Date("YYYY-MM-DD")`, which reads as UTC midnight and can display a day early).
 *
 * Three drill-down views — years -> months -> days — so a field like Seniority Date (which can
 * reach back to the 1980s) isn't stuck clicking "previous month" five hundred times. Clicking the
 * month/year header from anywhere always jumps straight to the year grid for a fast year change;
 * `options.startView` lets a specific field (Seniority Date) open directly into that year grid
 * instead of the usual current-month day view.
 */
function setupDatePicker(originalInput, options = {}) {
  const startView = options.startView || 'days';
  const name = originalInput.name;
  const originalId = originalInput.id;
  // Empty rather than "Select date": the field's own label already says it's a date, and the
  // calendar icon is what makes it look clickable. An unset date now reads like any other
  // blank field on the page.
  const placeholder = '';

  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.name = name;
  hidden.defaultValue = originalInput.value || '';
  hidden.value = originalInput.value || '';

  const wrapper = document.createElement('div');
  wrapper.className = 'datepicker';

  const triggerId = originalId || `dp-${name}`;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = triggerId;
  trigger.className = 'datepicker-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = '<span class="datepicker-value"></span>' +
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M3 10h18M8 2v4M16 2v4"></path></svg>';

  const panel = document.createElement('div');
  panel.className = 'datepicker-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Choose a date');
  panel.tabIndex = -1;
  panel.hidden = true;

  wrapper.appendChild(hidden);
  wrapper.appendChild(trigger);
  wrapper.appendChild(panel);

  const parentLabel = originalInput.closest('label');
  if (parentLabel) parentLabel.setAttribute('for', triggerId);
  originalInput.replaceWith(wrapper);

  let viewMonth = parseDateKey(hidden.value) || new Date();
  let view = 'days'; // 'days' | 'months' | 'years'
  let yearRangeStart = 0;
  let open = false;
  let previouslyFocused = null;

  function alignDecade(year) {
    return Math.floor(year / 12) * 12;
  }

  function selectedDate() { return parseDateKey(hidden.value); }

  function updateTriggerLabel() {
    const sel = selectedDate();
    const span = trigger.querySelector('.datepicker-value');
    if (sel) {
      // Spelled out to match what the PDF prints (see dateVariants)
      span.textContent = `${MONTH_NAMES_FULL[sel.getMonth()]} ${sel.getDate()} ${sel.getFullYear()}`;
      span.classList.remove('is-placeholder');
    } else {
      span.textContent = placeholder;
      span.classList.add('is-placeholder');
    }
  }

  function setValue(key) {
    hidden.value = key || '';
    updateTriggerLabel();
    hidden.dispatchEvent(new Event('input', { bubbles: true }));
    hidden.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pick(d) {
    setValue(dateKeyLocal(d));
    close();
  }

  function renderPanel() {
    if (view === 'years') renderYearsView();
    else if (view === 'months') renderMonthsView();
    else renderDaysView();
  }

  function goToYears() {
    yearRangeStart = alignDecade(viewMonth.getFullYear());
    view = 'years';
    renderPanel();
  }

  function renderYearsView() {
    const currentYear = viewMonth.getFullYear();
    const selYear = selectedDate()?.getFullYear();
    const todayYear = new Date().getFullYear();

    panel.innerHTML = `
      <div class="dp-nav">
        <button type="button" class="dp-navbtn" data-decade="-1" aria-label="Previous 12 years">&#8249;</button>
        <span class="dp-month">${yearRangeStart}–${yearRangeStart + 11}</span>
        <button type="button" class="dp-navbtn" data-decade="1" aria-label="Next 12 years">&#8250;</button>
      </div>
      <div class="dp-grid dp-grid-alt">
        ${Array.from({ length: 12 }, (_, i) => yearRangeStart + i).map(yr => {
          const cls = ['dp-day'];
          if (yr === selYear) cls.push('is-selected');
          else if (yr === todayYear) cls.push('is-today');
          return `<button type="button" class="${cls.join(' ')}" data-year="${yr}">${yr}</button>`;
        }).join('')}
      </div>
    `;

    panel.querySelectorAll('[data-decade]').forEach(btn => {
      btn.addEventListener('click', () => {
        yearRangeStart += Number(btn.dataset.decade) * 12;
        renderPanel();
      });
    });
    panel.querySelectorAll('[data-year]').forEach(btn => {
      btn.addEventListener('click', () => {
        viewMonth = new Date(Number(btn.dataset.year), viewMonth.getMonth(), 1);
        view = 'months';
        renderPanel();
      });
    });
  }

  function renderMonthsView() {
    const year = viewMonth.getFullYear();
    const selected = selectedDate();
    const today = new Date();

    panel.innerHTML = `
      <div class="dp-nav">
        <button type="button" class="dp-navbtn" data-yearstep="-1" aria-label="Previous year">&#8249;</button>
        <button type="button" class="dp-month dp-month-btn" data-open-years>${year}</button>
        <button type="button" class="dp-navbtn" data-yearstep="1" aria-label="Next year">&#8250;</button>
      </div>
      <div class="dp-grid dp-grid-alt">
        ${MONTH_ABBR.map((label, i) => {
          const cls = ['dp-day'];
          if (selected && selected.getFullYear() === year && selected.getMonth() === i) cls.push('is-selected');
          else if (today.getFullYear() === year && today.getMonth() === i) cls.push('is-today');
          return `<button type="button" class="${cls.join(' ')}" data-month="${i}">${label}</button>`;
        }).join('')}
      </div>
    `;

    panel.querySelector('[data-open-years]').addEventListener('click', goToYears);
    panel.querySelectorAll('[data-yearstep]').forEach(btn => {
      btn.addEventListener('click', () => {
        viewMonth = new Date(viewMonth.getFullYear() + Number(btn.dataset.yearstep), viewMonth.getMonth(), 1);
        renderPanel();
      });
    });
    panel.querySelectorAll('[data-month]').forEach(btn => {
      btn.addEventListener('click', () => {
        viewMonth = new Date(viewMonth.getFullYear(), Number(btn.dataset.month), 1);
        view = 'days';
        renderPanel();
      });
    });
  }

  function renderDaysView() {
    const today = new Date();
    const sel = selectedDate();
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells = [];
    for (let i = 0; i < startOffset; i++) {
      cells.push({ date: new Date(year, month, 1 - (startOffset - i)), inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ date: new Date(year, month, day), inMonth: true });
    }
    while (cells.length < 42) {
      const last = cells[cells.length - 1].date;
      const next = new Date(last);
      next.setDate(next.getDate() + 1);
      cells.push({ date: next, inMonth: false });
    }

    const monthLabel = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const dowLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    panel.innerHTML = `
      <div class="dp-quickpicks">
        <button type="button" class="dp-chip" data-quick="0">Today</button>
        <button type="button" class="dp-chip" data-quick="1">Tomorrow</button>
        <button type="button" class="dp-chip" data-quick="7">+1 week</button>
        ${sel ? '<button type="button" class="dp-clear" data-clear>Clear</button>' : ''}
      </div>
      <div class="dp-nav">
        <button type="button" class="dp-navbtn" data-nav="-1" aria-label="Previous month">&#8249;</button>
        <button type="button" class="dp-month dp-month-btn" data-open-years title="Jump to a year">${monthLabel}</button>
        <button type="button" class="dp-navbtn" data-nav="1" aria-label="Next month">&#8250;</button>
      </div>
      <div class="dp-grid">
        ${dowLabels.map(d => `<div class="dp-dow">${d}</div>`).join('')}
        ${cells.map(({ date, inMonth }) => {
          const isToday = isSameDay(date, today);
          const isSelected = sel && isSameDay(date, sel);
          const cls = ['dp-day'];
          if (isSelected) cls.push('is-selected');
          else if (isToday) cls.push('is-today');
          if (!inMonth) cls.push('is-outside');
          return `<button type="button" class="${cls.join(' ')}" data-day="${dateKeyLocal(date)}">${date.getDate()}</button>`;
        }).join('')}
      </div>
    `;

    panel.querySelectorAll('[data-quick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = new Date();
        d.setDate(d.getDate() + Number(btn.dataset.quick));
        pick(d);
      });
    });
    const clearBtn = panel.querySelector('[data-clear]');
    if (clearBtn) clearBtn.addEventListener('click', () => { setValue(null); close(); });
    panel.querySelector('[data-open-years]').addEventListener('click', goToYears);
    panel.querySelectorAll('[data-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + Number(btn.dataset.nav), 1);
        renderPanel();
      });
    });
    panel.querySelectorAll('[data-day]').forEach(btn => {
      btn.addEventListener('click', () => pick(parseDateKey(btn.dataset.day)));
    });
  }

  function handleOutsideClick(e) {
    if (!wrapper.contains(e.target)) close();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = Array.from(panel.querySelectorAll(DATEPICKER_FOCUSABLE)).filter(el => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function openPanel() {
    if (open) return;
    open = true;
    viewMonth = selectedDate() || new Date();
    view = startView;
    if (view === 'years') yearRangeStart = alignDecade(viewMonth.getFullYear());
    previouslyFocused = document.activeElement;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    renderPanel();
    const focusable = panel.querySelector(DATEPICKER_FOCUSABLE);
    if (focusable) focusable.focus();
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
  }

  function close() {
    if (!open) return;
    open = false;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('mousedown', handleOutsideClick);
    document.removeEventListener('keydown', handleKeyDown);
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
  }

  trigger.addEventListener('click', () => (open ? close() : openPanel()));

  wrapper.refreshDisplay = updateTriggerLabel;
  wrapper.setValue = setValue;
  updateTriggerLabel();
}

document.querySelectorAll('input[type="date"]').forEach(input => {
  // Seniority can reach back decades, so start on the year grid instead of the current month.
  setupDatePicker(input, { startView: input.name === 'seniorityDate' ? 'years' : 'days' });
});

// Native form.reset() restores the hidden inputs' default values without firing input/change,
// so each date picker's visible trigger label needs an explicit nudge afterward.
[fordForm, policyForm, uniforForm, investigationForm].forEach(form => {
  form.addEventListener('reset', () => {
    setTimeout(() => {
      form.querySelectorAll('.datepicker').forEach(dp => dp.refreshDisplay && dp.refreshDisplay());
      form.querySelectorAll(DC_AUTOGROW).forEach(autoGrow);
    }, 0);
  });
});

/*
 * Document-view fields size to their content, so a value that wraps onto a second line pushes
 * the page down exactly as it pushes the PDF down — this is what keeps the two in agreement.
 */
function autoGrow(el) {
  // Collapse to 0 rather than 'auto' first — on a textarea, 'auto' resolves to the rows
  // attribute's height, so scrollHeight would never read below it and the box could only grow.
  el.style.height = '0px';
  el.style.height = el.scrollHeight + 'px';
}

const DC_AUTOGROW = '.dc-textarea, .dc-value';

document.querySelectorAll(DC_AUTOGROW).forEach(el => {
  el.addEventListener('input', () => autoGrow(el));
  autoGrow(el);
});

/* ============ Enter moves to the next field ============
 *
 * These forms were spreadsheets before they were this, so Enter means "next cell" to everyone
 * who has ever filled one in. Shift+Enter goes back, the same way it does in Excel.
 *
 * The big narrative boxes are the exception: Details of Incident, the statements, the committee
 * comments all need real paragraphs, so Enter inserts a line there and Ctrl+Enter moves on.
 * Enter never submits — that's what the Preview PDF button is for, and quietly opening a PDF
 * because someone hit Enter out of habit is exactly the surprise this is meant to remove.
 */
const FIELD_ORDER = [
  '.dc-value',
  '.dc-textarea',
  '.dc-value-input',
  '.dc-hour-cell input',
  '.dc-sp-value input',
  '.dc-step input',
  '.dc-inline-field input',
  '.datepicker-trigger',
  '.dc-radio input',
].join(',');

/* Radios are a single stop per group, as they are when tabbing */
function navigableFields(form) {
  const seenRadioGroups = new Set();
  return Array.from(form.querySelectorAll(FIELD_ORDER)).filter(el => {
    if (el.disabled || el.closest('[hidden]')) return false;
    if (el.type !== 'radio') return true;
    const checked = form.elements[el.name] && form.elements[el.name].value;
    // land on the checked one, or the first if nothing is chosen yet
    const isStop = checked ? el.value === checked : !seenRadioGroups.has(el.name);
    seenRadioGroups.add(el.name);
    return isStop;
  });
}

function moveToAdjacentField(form, from, step) {
  const fields = navigableFields(form);
  const index = fields.indexOf(from);
  if (index === -1) return false;
  const next = fields[index + step];
  if (!next) return false;                       // stop at the ends rather than wrapping
  next.focus();
  // Select on arrival so the field can be overtyped, like a spreadsheet cell — but never in a
  // paragraph box, where selecting everything means the next keystroke wipes the account.
  if (next.select && !next.classList.contains('dc-textarea')) next.select();
  return true;
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.altKey || e.metaKey) return;

  const el = e.target;
  const form = el.form || (el.closest && el.closest('form'));
  if (!form) return;
  if (!form.classList.contains('dc-page') && !form.classList.contains('dc-sheets')) return;

  // Don't steal Enter from the date panel while it's open
  if (el.closest('.datepicker-panel')) return;

  // Paragraph boxes keep Enter for what it does everywhere else; Ctrl+Enter moves on
  const isProseBox = el.classList && el.classList.contains('dc-textarea');
  if (isProseBox && !e.ctrlKey) return;

  const fields = navigableFields(form);
  const index = fields.indexOf(el);
  // Anything else that can hold focus — the Preview PDF button, which the toolbar associates
  // with this form — keeps Enter for its own purpose.
  if (index === -1 && !isProseBox) return;

  e.preventDefault();
  moveToAdjacentField(form, el, e.shiftKey ? -1 : 1);
});

/* ============ Admin mode: rename the forms for everyone ============
 *
 * The form names live in forms.config.js, a file served to every visitor, so renaming them
 * "for everyone" means writing to that file. A static page can't write to itself — but it can
 * ask GitHub to, which is what this does: read forms.config.js through the Contents API, write
 * it back as a commit, and let the site rebuild.
 *
 * There is deliberately no password. A static page has no server to check one against, so any
 * password would have to ship in the source where anyone could read it — it would look like
 * security without being any. The GitHub token is the real credential: it's pasted at the time,
 * held only in a local variable, and GitHub is what actually verifies it. The typed unlock word
 * below is just to keep the panel out of the way, not to protect it.
 */
const ADMIN = {
  unlockWord: 'rename',
  owner: 'EvanKing17',
  repo: 'local200forms',
  path: 'forms.config.js',
  branch: 'main',
};

const ADMIN_FIELDS = [
  { key: 'title', label: 'Title (document heading, printed on the PDF)' },
  { key: 'homeLabel', label: 'Name on the Forms page' },
  { key: 'homeSub', label: 'Subtitle on the Forms page' },
];

const ADMIN_FORM_NAMES = {
  ford: 'Grievance Investigation & Claim',
  policy: 'Policy Grievance',
  unifor: 'Plant Committee Fact Sheet',
  investigation: '4.01 Investigation',
};

const adminOverlay = document.getElementById('adminOverlay');
const adminAuth = document.getElementById('adminAuth');
const adminPanel = document.getElementById('adminPanel');
const adminFields = document.getElementById('adminFields');
const adminTokenInput = document.getElementById('adminToken');
const adminStatus = document.getElementById('adminStatus');

let adminToken = null;
let adminFileSha = null;   // the blob the edits are based on, so GitHub can reject a stale write

function setAdminStatus(message, kind) {
  adminStatus.textContent = message || '';
  adminStatus.className = 'admin-status' + (kind ? ' is-' + kind : '');
}

/* btoa/atob are byte-oriented; round-trip through UTF-8 so accented names survive */
function toBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function fromBase64(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))));
}

function openAdmin() {
  adminOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
  adminAuth.hidden = false;
  adminPanel.hidden = true;
  setAdminStatus('');
  adminTokenInput.value = '';
  adminTokenInput.focus();
}

function closeAdmin() {
  adminOverlay.hidden = true;
  document.body.style.overflow = '';
  // Don't leave the token sitting in the DOM or in memory once the panel is done with
  adminTokenInput.value = '';
  adminToken = null;
  adminFileSha = null;
}

/*
 * Typing the unlock word on the Forms page opens admin mode. Ignored while a field has focus,
 * so it can't fire while someone is filling in a grievance.
 */
let adminBuffer = '';
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !adminOverlay.hidden) { closeAdmin(); return; }
  if (!adminOverlay.hidden || homeView.hidden || e.ctrlKey || e.metaKey || e.altKey) return;

  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
  if (e.key.length !== 1) return;

  adminBuffer = (adminBuffer + e.key.toLowerCase()).slice(-ADMIN.unlockWord.length);
  if (adminBuffer === ADMIN.unlockWord) {
    adminBuffer = '';
    openAdmin();
  }
});

document.querySelectorAll('[data-admin-close]').forEach(btn => {
  btn.addEventListener('click', closeAdmin);
});

function githubRequest(method, body) {
  const url = `https://api.github.com/repos/${ADMIN.owner}/${ADMIN.repo}/contents/${ADMIN.path}`
    + (method === 'GET' ? `?ref=${ADMIN.branch}` : '');
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

/* Turns a GitHub API failure into something that says what to actually do about it */
function describeGithubError(response) {
  if (response.status === 401) return 'GitHub rejected that token. Check it was copied in full and hasn’t expired.';
  if (response.status === 403) return 'That token is valid but not allowed to write here — it needs Contents: Read and write on this repository.';
  if (response.status === 404) return `Couldn’t find ${ADMIN.path} on ${ADMIN.owner}/${ADMIN.repo}. A fine-grained token also returns this when it has no access to the repository.`;
  if (response.status === 409) return 'The file changed on GitHub since it was loaded. Close and reopen admin mode to pick up the newer version.';
  return `GitHub returned ${response.status}.`;
}

function renderAdminFields(config) {
  adminFields.innerHTML = '';
  Object.keys(ADMIN_FORM_NAMES).forEach(type => {
    const group = document.createElement('div');
    group.className = 'admin-group';
    const heading = document.createElement('h3');
    heading.textContent = ADMIN_FORM_NAMES[type];
    group.appendChild(heading);

    ADMIN_FIELDS.forEach(field => {
      const label = document.createElement('label');
      label.className = 'admin-field';
      const span = document.createElement('span');
      span.textContent = field.label;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = (config[type] && config[type][field.key]) || '';
      input.dataset.type = type;
      input.dataset.key = field.key;
      label.append(span, input);
      group.appendChild(label);
    });
    adminFields.appendChild(group);
  });
}

function collectAdminConfig(base) {
  const next = JSON.parse(JSON.stringify(base));
  adminFields.querySelectorAll('input').forEach(input => {
    const { type, key } = input.dataset;
    next[type] = next[type] || {};
    next[type][key] = input.value;
  });
  return next;
}

/*
 * Reads the live forms.config.js out of the repository rather than trusting the copy this page
 * loaded with — the page could have been open for hours, or someone else could have renamed
 * something since. Doubles as the check that the token actually works.
 */
let adminConfig = null;

document.getElementById('adminUnlock').addEventListener('click', async () => {
  const token = adminTokenInput.value.trim();
  if (!token) { setAdminStatus('Paste a GitHub token to continue.', 'error'); return; }

  adminToken = token;
  setAdminStatus('Checking token…');
  try {
    const response = await githubRequest('GET');
    if (!response.ok) { setAdminStatus(describeGithubError(response), 'error'); adminToken = null; return; }

    const file = await response.json();
    adminFileSha = file.sha;
    const source = fromBase64(file.content);
    const match = source.match(/window\.FORMS_CONFIG_DATA\s*=\s*(\{[\s\S]*\});?\s*$/);
    if (!match) { setAdminStatus(`Couldn’t read the config out of ${ADMIN.path}.`, 'error'); return; }

    adminConfig = JSON.parse(match[1]);
    renderAdminFields(adminConfig);
    adminAuth.hidden = true;
    adminPanel.hidden = false;
    setAdminStatus('');
  } catch (err) {
    setAdminStatus(`Couldn’t reach GitHub: ${err.message}`, 'error');
    adminToken = null;
  }
});

document.getElementById('adminPublish').addEventListener('click', async () => {
  const publishBtn = document.getElementById('adminPublish');
  const updated = collectAdminConfig(adminConfig);
  const source = '/* Form display names — homepage card label/subtitle + sheet-header/PDF title. '
    + 'Edited via admin mode; a plain <script src> (not fetch) so this loads fine over file://. */\n'
    + 'window.FORMS_CONFIG_DATA = ' + JSON.stringify(updated, null, 2) + ';\n';

  publishBtn.disabled = true;
  setAdminStatus('Publishing…');
  try {
    const response = await githubRequest('PUT', {
      message: 'Rename forms via admin mode',
      content: toBase64(source),
      sha: adminFileSha,
      branch: ADMIN.branch,
    });
    if (!response.ok) { setAdminStatus(describeGithubError(response), 'error'); return; }

    const result = await response.json();
    adminFileSha = result.content.sha;   // so a second publish in the same session isn't stale
    adminConfig = updated;

    // Show the new names here straight away; everyone else sees them once Pages rebuilds
    Object.assign(FORMS_CONFIG, updated);
    applyFormsConfig();
    setAdminStatus('Published. The site rebuilds in about a minute, then everyone sees the new names.', 'ok');
  } catch (err) {
    setAdminStatus(`Couldn’t reach GitHub: ${err.message}`, 'error');
  } finally {
    publishBtn.disabled = false;
  }
});

/* ============ Unifor sheet chrome ============ */
/* The logo is bundled as base64 (unifor-logo.js) rather than a file, so the document view and
   the PDF draw the same bytes and neither needs a network request. */
document.querySelectorAll('[data-unifor-logo]').forEach(img => {
  if (window.UNIFOR_LOGO_PNG) img.src = window.UNIFOR_LOGO_PNG;
});

/* Pages 2-5 repeat the SP number from page 1, the same way drawUniforPageHeader does */
const spInput = uniforForm.elements.spNumber;
const spMirrors = document.querySelectorAll('[data-sp-mirror]');

function syncSpNumber() {
  const text = 'SP-' + (spInput.value || '');
  spMirrors.forEach(el => { el.textContent = text; });
}

if (spInput) {
  spInput.addEventListener('input', syncSpNumber);
  uniforForm.addEventListener('reset', () => setTimeout(syncSpNumber, 0));
  syncSpNumber();
}

/* ============ Loading skeleton ============
 *
 * Sized from the real cards rather than a generic placeholder template — one bar per form, at
 * that card's measured height — so it can't drift from the content. Add a fifth form and the
 * skeleton grows on its own.
 *
 * It only covers a wait that genuinely exists. Everything in this app is static except jsPDF,
 * which is ~350KB from a CDN, and until it lands "Preview PDF" can't do anything. Once the
 * cards are real and jsPDF has arrived, the skeleton goes away. Switching between forms isn't
 * covered because nothing is loading there — the panels are already in the document, and a
 * skeleton over an instant transition would be an animation pretending to be work.
 */
const skeleton = document.getElementById('skeleton');
const cardGrid = document.querySelector('.form-cards');

function buildSkeleton() {
  if (!skeleton || !cardGrid) return;
  const cards = cardGrid.querySelectorAll('.form-card');
  if (!cards.length) return;

  skeleton.innerHTML = '';
  cards.forEach(card => {
    const bar = document.createElement('div');
    bar.className = 'skel-card';
    bar.style.height = card.getBoundingClientRect().height + 'px';
    skeleton.appendChild(bar);
  });
  skeleton.hidden = false;
  cardGrid.classList.add('is-loading');
}

function appReady() {
  if (skeleton) skeleton.hidden = true;
  if (cardGrid) cardGrid.classList.remove('is-loading');
  document.body.classList.add('is-ready');
}

if (window.jspdf) {
  appReady();
} else {
  buildSkeleton();
  const poll = setInterval(() => {
    if (!window.jspdf) return;
    clearInterval(poll);
    appReady();
  }, 60);
  // Don't strand the page behind a skeleton if the CDN is blocked — show it anyway and let
  // the PDF buttons report the failure themselves.
  setTimeout(() => { clearInterval(poll); appReady(); }, 8000);
}

/* ============ Page-break markers ============
 *
 * Shows where the printed page will actually break while the form is being filled in, so the
 * split doesn't have to be discovered by opening the preview over and over.
 *
 * The Unifor sheet is skipped: buildUniforDoc() calls addPage() at fixed points, so it already
 * renders as five real sheets and there is nothing to predict.
 *
 * For the rest, the break positions are worked out from the measured DOM using the same rule
 * the PDF uses -- a block that would cross the bottom margin moves to the next page whole,
 * rather than being sliced -- because the document view is laid out at the PDF's own scale
 * (1pt = 1.3333px). That is a mirror of the pagination logic rather than a reading of it, so
 * every update checks its own answer against the page count of the real PDF and renders
 * nothing if the two disagree. A wrong break line is worse than no break line.
 */
const PX_PER_PT = 4 / 3;
const PAGE_TOP_PX = 40 * PX_PER_PT;          // the builders' top margin
const PAGE_USABLE_PX = (PAGE_BOTTOM - 40) * PX_PER_PT;

function makeBreakMarker(pageNumber) {
  const marker = document.createElement('div');
  marker.className = 'dc-break';
  marker.setAttribute('aria-hidden', 'true');
  const tag = document.createElement('span');
  tag.className = 'dc-break-tag';
  tag.textContent = 'Page ' + pageNumber;
  marker.appendChild(tag);
  return marker;
}

function updatePageBreaks(type) {
  const entry = FORM_BUILDERS[type];
  if (!entry) return;
  const form = entry.form;
  form.querySelectorAll('.dc-break').forEach(node => node.remove());

  // Multi-sheet forms draw their own page boundaries
  if (!form.classList.contains('dc-page')) return;

  const sheetTop = form.getBoundingClientRect().top + parseFloat(getComputedStyle(form).paddingTop);
  let pageStart = sheetTop;
  let pages = 1;
  const marks = [];

  // getBoundingClientRect reports zoomed pixels, so undo the zoom before comparing to the
  // page height, which is in the document's own scale
  const zoom = documentZoom();
  Array.from(form.children).forEach(block => {
    const rect = block.getBoundingClientRect();
    if (!rect.height) return;
    if ((rect.bottom - pageStart) / zoom > PAGE_USABLE_PX && rect.top > pageStart) {
      pages += 1;
      pageStart = rect.top;
      marks.push({ block, page: pages });
    }
  });

  // The check: if this disagrees with the PDF, say nothing rather than something wrong
  let actualPages;
  try {
    actualPages = entry.build(fd(form)).getNumberOfPages();
  } catch {
    return;
  }
  if (actualPages !== pages) return;

  marks.forEach(({ block, page }) => block.parentNode.insertBefore(makeBreakMarker(page), block));
}

const refreshPageBreaks = debounce(() => {
  if (currentFormType) updatePageBreaks(currentFormType);
}, 400);

[fordForm, policyForm, uniforForm, investigationForm].forEach(form => {
  form.addEventListener('input', refreshPageBreaks);
  form.addEventListener('change', refreshPageBreaks);
});

/* ============ Installable / offline ============
 *
 * Registers the service worker that precaches the app, so it runs with no connection — which
 * matters on a plant floor, and on a work network that may filter whatever it likes. jsPDF is
 * served from this repo rather than a CDN for the same reason.
 *
 * Guarded on protocol: service workers need https (or localhost), so opening index.html
 * straight off disk simply skips this rather than throwing.
 */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(registration => {
      // A waiting worker means a newer build is cached and ready behind this one
      function offerUpdate(worker) {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
        });
      }
      if (registration.waiting && navigator.serviceWorker.controller) showUpdateBanner(registration.waiting);
      registration.addEventListener('updatefound', () => offerUpdate(registration.installing));
    }).catch(() => { /* offline support is a bonus; the app works fine without it */ });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  });
}

/*
 * An update is offered rather than applied: reloading underneath someone who is part-way
 * through a grievance would throw away what they'd typed.
 */
function showUpdateBanner(worker) {
  if (document.getElementById('updateBanner')) return;
  const banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.id = 'updateBanner';
  banner.innerHTML = '<span>A newer version is ready.</span>';

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'btn-primary';
  reload.textContent = 'Reload';
  reload.addEventListener('click', () => worker.postMessage('skip-waiting'));

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'btn-secondary';
  later.textContent = 'Later';
  later.addEventListener('click', () => banner.remove());

  banner.append(reload, later);
  document.body.appendChild(banner);
}

/* ============ Drafts ============
 *
 * Every form saves as it's typed, on this device only — nothing is transmitted, same as the
 * PDFs. Reopening a form restores what was there, so closing the tab, losing the phone to a
 * backgrounded-app kill, or the battery dying part-way through a grievance costs nothing.
 *
 * Restoring is silent rather than prompted: it's the rep's own work on their own device, and a
 * dialog asking permission to hand back what they just typed is friction for its own sake.
 * "Clear form" is the way out, and it discards the draft too.
 */
/*
 * `var`, not `let`: this block sits near the end of the file, but showHome() runs at module
 * level much earlier and reaches in through refreshDraftFlags(). A `let` would still be in its
 * temporal dead zone at that point and throw, taking the rest of the script's setup with it.
 * `var` hoists as undefined, which is exactly the "not worked out yet" state wanted here.
 */
var draftStorageOk;

function draftsAvailable() {
  if (draftStorageOk === undefined) {
    try {
      const probe = DRAFT_PREFIX + 'probe';
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      draftStorageOk = true;
    } catch {
      draftStorageOk = false;   // private browsing, or storage disabled
    }
  }
  return draftStorageOk;
}

function draftKey(type) {
  return DRAFT_PREFIX + type;
}

function saveDraft(type) {
  if (!draftsAvailable()) return;
  const entry = FORM_BUILDERS[type];
  if (!entry) return;
  const data = fd(entry.form);
  const hasContent = Object.values(data).some(v => v !== '');
  try {
    if (hasContent) localStorage.setItem(draftKey(type), JSON.stringify({ savedAt: Date.now(), data }));
    else localStorage.removeItem(draftKey(type));
  } catch {
    return;   // quota, most likely; the form still works, it just won't persist
  }
  if (hasContent) showSavedIndicator(type);
}

function readDraft(type) {
  if (!draftsAvailable()) return null;
  try {
    const raw = localStorage.getItem(draftKey(type));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.data ? parsed : null;
  } catch {
    return null;
  }
}

function discardDraft(type) {
  if (!draftsAvailable()) return;
  try { localStorage.removeItem(draftKey(type)); } catch { /* nothing to do */ }
  const indicator = document.querySelector(`#form-${type} .dc-saved`);
  if (indicator) indicator.classList.remove('is-visible');
}

/* A quiet "Saved" in the toolbar, so it's clear the work is being kept without a dialog */
let savedIndicatorTimers = {};

function showSavedIndicator(type) {
  const toolbar = document.querySelector(`#form-${type} .dc-toolbar`);
  if (!toolbar) return;
  let indicator = toolbar.querySelector('.dc-saved');
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.className = 'dc-saved';
    indicator.textContent = 'Saved';
    toolbar.insertBefore(indicator, toolbar.querySelector('.btn-secondary'));
  }
  indicator.classList.add('is-visible');
  clearTimeout(savedIndicatorTimers[type]);
  savedIndicatorTimers[type] = setTimeout(() => indicator.classList.remove('is-visible'), 1600);
}

const queueDraftSave = debounce(() => {
  if (currentFormType) saveDraft(currentFormType);
}, 600);

Object.keys(FORM_BUILDERS).forEach(type => {
  FORM_BUILDERS[type].form.addEventListener('input', queueDraftSave);
  FORM_BUILDERS[type].form.addEventListener('change', queueDraftSave);
});

/* Save immediately on the way out, rather than losing whatever the debounce is still holding */
window.addEventListener('pagehide', () => {
  if (currentFormType) saveDraft(currentFormType);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && currentFormType) saveDraft(currentFormType);
});

/* ============ Missing-field notice ============
 *
 * Deliberately does not block. Printing a blank form to fill in by hand is a real thing reps
 * do, so refusing to produce a PDF without a name would break a legitimate use. But filing a
 * grievance with no grievor on it is a genuine mistake, so it gets said out loud once, and the
 * preview opens regardless.
 */
const KEY_FIELD = {
  ford: { name: 'employeeName', label: 'Employee Name' },
  policy: { name: 'employeeName', label: 'Employee Name' },
  unifor: { name: 'grievorName', label: "Grievor's Name" },
  investigation: { name: 'supervisorName', label: 'Name of Supervisor' },
};

function noticeFor(type) {
  const toolbar = document.querySelector(`#form-${type} .dc-toolbar`);
  if (!toolbar) return null;
  let notice = toolbar.querySelector('.dc-notice');
  if (!notice) {
    notice = document.createElement('span');
    notice.className = 'dc-notice';
    notice.setAttribute('role', 'status');
    toolbar.insertBefore(notice, toolbar.querySelector('.btn-secondary'));
  }
  return notice;
}

let noticeTimers = {};

function checkKeyField(type) {
  const field = KEY_FIELD[type];
  const notice = noticeFor(type);
  if (!field || !notice) return;

  const entry = FORM_BUILDERS[type];
  const value = (fd(entry.form)[field.name] || '').trim();
  if (value) { notice.classList.remove('is-visible'); return; }

  notice.textContent = `${field.label} is empty`;
  notice.classList.add('is-visible');
  clearTimeout(noticeTimers[type]);
  noticeTimers[type] = setTimeout(() => notice.classList.remove('is-visible'), 5000);
}

Object.keys(FORM_BUILDERS).forEach(type => {
  FORM_BUILDERS[type].form.addEventListener('submit', () => checkKeyField(type));
});

/*
 * Test surface for tests.html. Top-level `const` declarations live in script scope rather than
 * on `window`, so anything a test needs to reach has to be handed over deliberately. Keeping
 * that to one named object makes the contract obvious, instead of tests quietly depending on
 * whichever internals happen to be function declarations.
 */

/* ============ Which forms have something in them ============
 *
 * A form that hasn't been opened yet is empty in the DOM even when a draft is sitting in
 * storage, so both have to be checked — otherwise work saved before a reload looks like it
 * isn't there.
 */
function formHasContent(type) {
  const entry = FORM_BUILDERS[type];
  if (!entry) return false;
  return formHasData(entry.form) || !!readDraft(type);
}

/* A card with work waiting behind it says so, rather than looking identical to an empty one */
function refreshDraftFlags() {
  Object.keys(FORM_BUILDERS).forEach(type => {
    const card = document.querySelector(`.form-card[data-form="${type}"]`);
    if (!card) return;
    const has = formHasContent(type);
    let flag = card.querySelector('.draft-flag');
    if (has && !flag) {
      flag = document.createElement('span');
      flag.className = 'draft-flag';
      flag.textContent = 'Draft';
      card.appendChild(flag);
    } else if (!has && flag) {
      flag.remove();
    }
  });
}

/* ============ Larger text ============
 *
 * Scales the whole sheet with `zoom` rather than enlarging the type on its own: every size in
 * the document view is a conversion of a measurement in the PDF, so growing the text alone
 * would push it out of cells built to fit it. Zooming keeps the page exactly as proportioned,
 * just bigger. The PDF is untouched either way.
 */
const TEXT_SIZE_KEY = 'local200forms:textSize';
const LARGE_ZOOM = 1.25;

function documentZoom() {
  return document.body.classList.contains('is-large-text') ? LARGE_ZOOM : 1;
}

function applyTextSize(large) {
  document.body.classList.toggle('is-large-text', large);
  const button = document.getElementById('textSizeToggle');
  if (button) {
    button.setAttribute('aria-pressed', String(large));
    const label = large ? 'Normal text' : 'Larger text';
    button.setAttribute('title', label);
    button.setAttribute('aria-label', label);
  }
  if (currentFormType) {
    FORM_BUILDERS[currentFormType].form.querySelectorAll(DC_AUTOGROW).forEach(autoGrow);
    updatePageBreaks(currentFormType);
  }
}

document.getElementById('textSizeToggle').addEventListener('click', () => {
  const large = !document.body.classList.contains('is-large-text');
  applyTextSize(large);
  try { localStorage.setItem(TEXT_SIZE_KEY, large ? 'large' : 'normal'); } catch { /* not fatal */ }
});

try {
  if (localStorage.getItem(TEXT_SIZE_KEY) === 'large') applyTextSize(true);
} catch { /* storage unavailable; stay at the default size */ }

/* ============ Sheet navigation ============
 *
 * The Fact Sheet is five sheets and roughly seven screens. Without this you scroll a long way
 * with no idea which one you're on and no way to jump, which is the single roughest part of
 * filling it in.
 */
function panelIsActive(type) {
  const panel = document.getElementById('form-' + type);
  return panel && panel.classList.contains('active');
}

function sheetLabels(form) {
  return Array.from(form.querySelectorAll('.dc-page')).map((sheet, i) => {
    const band = sheet.querySelector('.dc-band');
    const sub = band && band.querySelector('.dc-band-sub');
    const name = sub ? sub.textContent.trim() : (band ? band.textContent.trim() : '');
    return { index: i, sheet, label: name ? `${i + 1} · ${name}` : `Sheet ${i + 1}` };
  });
}

function buildSheetNav(type) {
  const form = FORM_BUILDERS[type].form;
  const sheets = sheetLabels(form);
  if (sheets.length < 2) return;

  const toolbar = document.querySelector(`#form-${type} .dc-toolbar`);
  if (!toolbar || toolbar.querySelector('.dc-sheet-nav')) return;

  const nav = document.createElement('div');
  nav.className = 'dc-sheet-nav';

  const current = document.createElement('button');
  current.type = 'button';
  current.className = 'dc-sheet-current';
  current.setAttribute('aria-expanded', 'false');
  current.textContent = `Sheet 1 of ${sheets.length}`;

  const menu = document.createElement('div');
  menu.className = 'dc-sheet-menu';
  menu.hidden = true;

  sheets.forEach(({ sheet, label }) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = label;
    item.addEventListener('click', () => {
      menu.hidden = true;
      current.setAttribute('aria-expanded', 'false');
      // Clear the sticky toolbar, or the sheet's first rows land underneath it
      const top = sheet.getBoundingClientRect().top + window.scrollY - toolbar.offsetHeight - SHEET_JUMP_GAP;
      window.scrollTo({ top, behavior: 'smooth' });
      syncCurrentSheet();
    });
    menu.appendChild(item);
  });

  current.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    current.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (e) => {
    if (!nav.contains(e.target)) { menu.hidden = true; current.setAttribute('aria-expanded', 'false'); }
  });

  nav.append(current, menu);
  toolbar.insertBefore(nav, toolbar.querySelector('.dc-back').nextSibling);

  /*
   * Whichever sheet has passed under the toolbar is the one you're on. Worked out from the
   * measured positions on scroll rather than with an IntersectionObserver: the answer is the
   * same, and this can be checked directly at any scroll position instead of depending on when
   * the browser decides to deliver a callback.
   */
  const SHEET_JUMP_GAP = 24;   // how far below the toolbar a jumped-to sheet is parked

  function syncCurrentSheet() {
    // The line has to sit below where a jump parks a sheet, or the sheet you just jumped to
    // reads as still being the previous one
    const line = toolbar.getBoundingClientRect().bottom + SHEET_JUMP_GAP + 8;
    let active = 0;
    sheets.forEach(({ sheet }, i) => {
      if (sheet.getBoundingClientRect().top <= line) active = i;
    });
    current.textContent = `Sheet ${active + 1} of ${sheets.length}`;
  }

  // Throttled on a timer rather than requestAnimationFrame, which only runs while the page is
  // producing frames — this keeps working in a background tab, and stays testable.
  let lastSync = 0;
  window.addEventListener('scroll', () => {
    const now = Date.now();
    if (now - lastSync < 80) return;
    lastSync = now;
    if (panelIsActive(type)) syncCurrentSheet();
  }, { passive: true });

  FORM_BUILDERS[type].syncSheet = syncCurrentSheet;
}

Object.keys(FORM_BUILDERS).forEach(buildSheetNav);

/* ============ Attachments and the mark-up editor ============
 *
 * Supporting documents ride along with the grievance so the whole thing goes in as one PDF.
 * The pages themselves are never redrawn — see annotate.js — so attached PDFs stay sharp and
 * searchable, and the marks go on top as vector shapes.
 */

/* Highlighter colours are the translucent ones you'd reach for on paper; everything else gets
   the solid set. Each tool keeps its own colour and thickness, so switching between them
   doesn't lose the setting you just chose. */
const INK_COLOURS = ['#C31A1A', '#002855', '#1a7f37', '#7A1FA2', '#111111'];
const HIGHLIGHT_COLOURS = ['#FFE44D', '#8CF07A', '#7FD8FF', '#FF9AD5', '#FFB061'];

const TOOL_SETTINGS = {
  pen: { color: '#C31A1A', width: 4 },
  highlight: { color: '#FFE44D', width: 4 },
  arrow: { color: '#C31A1A', width: 4 },
  rect: { color: '#C31A1A', width: 3, fill: false },
  ellipse: { color: '#C31A1A', width: 3, fill: false },
  pixelate: { color: '#111111', width: 3 },
};

const FREEHAND_TOOLS = ['pen', 'highlight'];
const DRAG_TOOLS = ['rect', 'ellipse', 'pixelate', 'arrow'];

const attachments = { ford: [], policy: [], unifor: [], investigation: [] };

/*
 * How each form lays its pictures out. One page per picture by default: a grievance is a paper
 * document that gets printed and handed over, so its pages should be paper-sized. The page turns
 * sideways for a wide picture rather than shrinking it into a strip across an empty sheet.
 */
const attachmentFit = { ford: 'letter', policy: 'letter', unifor: 'letter', investigation: 'letter' };

const editor = document.getElementById('editor');
const editorStage = document.getElementById('editorStage');
const editorPages = document.getElementById('editorPages');
const editorNameInput = document.getElementById('editorName');
const editorPageLabel = document.getElementById('editorPageLabel');
const brushCursor = document.getElementById('brushCursor');

let editorDoc = null;
let editorTool = 'pen';
let editorOnDone = null;
let pageCanvases = [];

function settings() {
  return TOOL_SETTINGS[editorTool];
}

function coloursForTool() {
  return editorTool === 'highlight' ? HIGHLIGHT_COLOURS : INK_COLOURS;
}

function buildSwatches() {
  const host = document.getElementById('editorSwatches');
  host.innerHTML = '';
  coloursForTool().forEach(colour => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.style.background = colour;
    button.setAttribute('aria-label', colour);
    button.setAttribute('aria-pressed', String(colour === settings().color));
    button.addEventListener('click', () => {
      settings().color = colour;
      host.querySelectorAll('.swatch').forEach(s => s.setAttribute('aria-pressed', String(s === button)));
      updateBrushCursor();
    });
    host.appendChild(button);
  });
}

function syncToolOptions() {
  const set = settings();
  editor.classList.toggle('is-freehand', FREEHAND_TOOLS.includes(editorTool));
  const shape = editorTool === 'rect' || editorTool === 'ellipse';
  document.getElementById('colourRow').hidden = editorTool === 'pixelate';
  document.getElementById('widthRow').hidden = editorTool === 'pixelate';
  document.getElementById('fillRow').hidden = !shape;
  document.getElementById('fillNote').hidden = !(shape && set.fill);
  document.getElementById('editorWidth').value = set.width;
  document.getElementById('widthValue').textContent = set.width;
  document.getElementById('editorFill').checked = !!set.fill;
  document.querySelectorAll('#editorTools .tool').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.tool === editorTool));
  });
  buildSwatches();
  updateBrushCursor();
}

document.querySelectorAll('#editorTools .tool').forEach(button => {
  button.addEventListener('click', () => { editorTool = button.dataset.tool; syncToolOptions(); });
});
document.getElementById('editorWidth').addEventListener('input', (e) => {
  settings().width = +e.target.value;
  document.getElementById('widthValue').textContent = e.target.value;
  updateBrushCursor();
});
document.getElementById('editorFill').addEventListener('change', (e) => {
  settings().fill = e.target.checked;
  document.getElementById('fillNote').hidden = !e.target.checked;
});

/* ---------- The cursor shows what the tool will actually lay down ----------
 * A crosshair tells you nothing about how wide a highlighter stroke is going to be, which is
 * the thing you want to know before you drag across a line of text.
 */
let cursorOver = null;

function brushDiameter(canvas, page) {
  const set = settings();
  const scale = canvas.getBoundingClientRect().width / canvas.width;
  const base = window.Annotator.strokeWidthFor(page, set) * (canvas.width / page.width) * scale;
  return Math.max(4, editorTool === 'highlight' ? base * 4 : base);
}

function updateBrushCursor() {
  if (!cursorOver || !FREEHAND_TOOLS.includes(editorTool)) { brushCursor.hidden = true; return; }
  const size = brushDiameter(cursorOver.canvas, cursorOver.page);
  brushCursor.style.width = size + 'px';
  brushCursor.style.height = size + 'px';
  brushCursor.style.borderRadius = editorTool === 'highlight' ? '2px' : '50%';
  brushCursor.style.background = settings().color;
  brushCursor.style.opacity = editorTool === 'highlight' ? '0.45' : '0.85';
}

function moveBrushCursor(e) {
  if (!FREEHAND_TOOLS.includes(editorTool)) { brushCursor.hidden = true; return; }
  const stage = editorStage.getBoundingClientRect();
  brushCursor.hidden = false;
  brushCursor.style.left = (e.clientX - stage.left) + 'px';
  brushCursor.style.top = (e.clientY - stage.top) + 'px';
}

/* ---------- Laying the pages out ----------
 * Every page is on screen at once and scrolls, rather than one at a time behind arrows: it's
 * how any document reader behaves, and it makes it obvious how much there is.
 */
function layoutPages() {
  editorPages.innerHTML = '';
  pageCanvases = [];
  if (!editorDoc) return;

  editorDoc.pages.forEach((page, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'editor-page';

    const canvas = document.createElement('canvas');
    canvas.width = page.view.width;
    canvas.height = page.view.height;
    canvas.className = 'editor-canvas';
    canvas.dataset.page = String(i);

    const number = document.createElement('span');
    number.className = 'editor-page-number';
    number.textContent = 'Page ' + (i + 1);

    wrap.append(canvas, number);
    editorPages.appendChild(wrap);
    pageCanvases.push(canvas);
    window.Annotator.renderPage(canvas, page);
    attachDrawing(canvas, page, i);
  });

  editorPageLabel.textContent = editorDoc.pages.length +
    (editorDoc.pages.length === 1 ? ' page' : ' pages');
}

function openEditor(doc, onDone) {
  editorDoc = doc;
  editorOnDone = onDone || null;
  editorNameInput.value = doc.name.replace(/\.[^.]+$/, '');
  editor.hidden = false;
  document.body.style.overflow = 'hidden';
  syncToolOptions();
  layoutPages();
  editorStage.scrollTop = 0;
  markHistory = [];
  undone = [];
  syncHistoryButtons();
}

function markCount() {
  return editorDoc ? editorDoc.pages.reduce((n, p) => n + p.annotations.length, 0) : 0;
}

/* Backing out throws the marks away, so it asks first — Done keeps them and doesn't */
function closeEditor(discarding) {
  if (discarding && markCount()) {
    const marks = markCount();
    const what = marks === 1 ? 'one mark' : marks + ' marks';
    if (!confirm('Go back without keeping this mark-up? ' + what + ' will be lost.')) return;
    editorDoc.pages.forEach(page => { page.annotations.length = 0; });
  }
  editor.hidden = true;
  brushCursor.hidden = true;
  document.body.style.overflow = '';
  const finished = editorDoc;
  const done = editorOnDone;
  if (finished) finished.name = (editorNameInput.value.trim() || finished.name) + '.pdf';
  editorDoc = null;
  editorOnDone = null;
  pageCanvases = [];
  if (done) done(finished);
}

document.getElementById('editorBack').addEventListener('click', () => closeEditor(true));
document.getElementById('editorDone').addEventListener('click', () => closeEditor(false));

/* ---------- Undo and redo ----------
 * A single record of what was done, in the order it happened, rather than looking for the last
 * page that has anything on it — that undid whatever was furthest down the document instead of
 * whatever was drawn most recently, which is why the order felt arbitrary.
 */
let markHistory = [];
let undone = [];

function recordStroke(pageIndex, annotation) {
  markHistory.push({ pageIndex, annotation });
  undone = [];                     // a new mark ends the branch that could have been redone
  syncHistoryButtons();
}

function forgetStroke(annotation) {
  const at = markHistory.findIndex(h => h.annotation === annotation);
  if (at > -1) markHistory.splice(at, 1);
  syncHistoryButtons();
}

function syncHistoryButtons() {
  document.getElementById('editorUndo').disabled = markHistory.length === 0;
  document.getElementById('editorRedo').disabled = undone.length === 0;
}

function repaint(pageIndex) {
  const page = editorDoc.pages[pageIndex];
  if (page && pageCanvases[pageIndex]) window.Annotator.renderPage(pageCanvases[pageIndex], page);
}

document.getElementById('editorUndo').addEventListener('click', () => {
  if (!editorDoc || !markHistory.length) return;
  const step = markHistory.pop();
  const page = editorDoc.pages[step.pageIndex];
  const at = page.annotations.indexOf(step.annotation);
  if (at > -1) page.annotations.splice(at, 1);
  undone.push(step);
  repaint(step.pageIndex);
  syncHistoryButtons();
});

document.getElementById('editorRedo').addEventListener('click', () => {
  if (!editorDoc || !undone.length) return;
  const step = undone.pop();
  editorDoc.pages[step.pageIndex].annotations.push(step.annotation);
  markHistory.push(step);
  repaint(step.pageIndex);
  syncHistoryButtons();
});

/* ---------- Marking up ---------- */
let stroke = null;

function attachDrawing(canvas, page, index) {
  function pointOn(e) {
    const r = canvas.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    ];
  }

  canvas.addEventListener('pointerenter', () => { cursorOver = { canvas, page }; updateBrushCursor(); });
  canvas.addEventListener('pointerleave', () => { if (!stroke) { cursorOver = null; brushCursor.hidden = true; } });
  canvas.addEventListener('pointermove', moveBrushCursor);

  canvas.addEventListener('pointerdown', (e) => {
    if (!editorDoc) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    cursorOver = { canvas, page };
    const [x, y] = pointOn(e);
    const set = settings();

    if (editorTool === 'arrow') {
      stroke = { type: 'arrow', color: set.color, width: set.width, x1: x, y1: y, x2: x, y2: y };
    } else if (DRAG_TOOLS.includes(editorTool)) {
      stroke = { type: editorTool, color: set.color, width: set.width, fill: !!set.fill,
                 x, y, w: 0, h: 0, ox: x, oy: y };
    } else {
      stroke = { type: editorTool, color: set.color, width: set.width, points: [[x, y]] };
    }
    stroke.pageIndex = index;
    page.annotations.push(stroke);
    recordStroke(index, stroke);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!stroke || stroke.pageIndex !== index) return;
    const [x, y] = pointOn(e);
    if (stroke.points) {
      stroke.points.push([x, y]);
    } else if (stroke.type === 'arrow') {
      stroke.x2 = x;
      stroke.y2 = y;
    } else {
      stroke.x = Math.min(stroke.ox, x);
      stroke.y = Math.min(stroke.oy, y);
      stroke.w = Math.abs(x - stroke.ox);
      stroke.h = Math.abs(y - stroke.oy);
    }
    window.Annotator.renderPage(canvas, page);
  });

  function end() {
    if (!stroke || stroke.pageIndex !== index) return;
    // A tap that drew nothing shouldn't leave an invisible mark behind
    let empty;
    if (stroke.points) empty = stroke.points.length < 2;
    else if (stroke.type === 'arrow') empty = Math.hypot(stroke.x2 - stroke.x1, stroke.y2 - stroke.y1) < 0.01;
    else empty = stroke.w < 0.005 || stroke.h < 0.005;
    if (empty) { page.annotations.pop(); forgetStroke(stroke); }
    stroke = null;
    window.Annotator.renderPage(canvas, page);
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}

/* ---------- Attachment list on a form ---------- */
function attachmentsFor(type) {
  return attachments[type] || (attachments[type] = []);
}

function totalAttachedPages(type) {
  return attachmentsFor(type).reduce((n, doc) => n + doc.pages.length, 0);
}

function renderAttachmentList(type) {
  const host = document.querySelector('#form-' + type + ' .dc-attachments');
  if (!host) return;
  const docs = attachmentsFor(type);
  host.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'dc-attach-head';
  const pages = totalAttachedPages(type);
  heading.textContent = docs.length
    ? 'Supporting documents — ' + pages + (pages === 1 ? ' page' : ' pages')
    : 'Supporting documents';
  host.appendChild(heading);

  // Same control, same words as the builder — but only once a picture has been added, since a
  // stack of PDFs keeps its own pages whatever is chosen here
  if (docs.some(d => d.kind !== 'pdf')) {
    host.appendChild(layoutPicker(attachmentFit[type], value => { attachmentFit[type] = value; }));
  }

  docs.forEach((doc, i) => {
    const row = document.createElement('div');
    row.className = 'dc-attach-row';

    const thumb = document.createElement('canvas');
    thumb.className = 'dc-attach-thumb';
    thumb.width = 44;
    thumb.height = Math.max(20, Math.round(44 * doc.pages[0].view.height / doc.pages[0].view.width));
    window.Annotator.renderPage(thumb, doc.pages[0]);

    const label = document.createElement('span');
    label.className = 'dc-attach-name';
    label.textContent = doc.name + ' · ' + doc.pages.length + (doc.pages.length === 1 ? ' page' : ' pages');

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'dc-attach-action';
    edit.textContent = 'Mark up';
    edit.addEventListener('click', () => openEditor(doc, () => renderAttachmentList(type)));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'dc-attach-action is-danger';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => { docs.splice(i, 1); renderAttachmentList(type); });

    row.append(thumb, label, edit, remove);
    host.appendChild(row);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'dc-attach-add';
  add.textContent = docs.length ? 'Add another document' : 'Add a PDF or photo';
  add.addEventListener('click', () => pickAttachment(type));
  host.appendChild(add);
}

function pickAttachment(type) {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'application/pdf,image/*';
  picker.multiple = true;
  picker.addEventListener('change', async () => {
    for (const file of Array.from(picker.files || [])) await addAttachment(type, file);
  });
  picker.click();
}

async function addAttachment(type, file) {
  const host = document.querySelector('#form-' + type + ' .dc-attachments');
  if (host) host.classList.add('is-busy');
  try {
    const doc = await window.Annotator.readFile(file);
    attachmentsFor(type).push(doc);
    renderAttachmentList(type);
  } catch (err) {
    if (host) {
      const problem = document.createElement('p');
      problem.className = 'dc-attach-error';
      problem.textContent = 'Couldn’t read ' + file.name + ': ' + err.message;
      host.appendChild(problem);
    }
  } finally {
    if (host) host.classList.remove('is-busy');
  }
}

/* ---------- Producing the finished PDF ----------
 * Without attachments the jsPDF document goes straight to the viewer, which keeps its own
 * Download. With attachments, pdf-lib stitches the originals on afterwards and the result is
 * handed over as bytes, so nothing about those pages is redrawn.
 */
async function openWithAttachments(doc, type, filename) {
  const docs = attachmentsFor(type);
  if (!docs.length) { openPdfViewer(doc, filename); return; }

  const button = document.querySelector('#form-' + type + ' .dc-toolbar button[type=submit]');
  const wording = button ? button.textContent : null;
  if (button) { button.disabled = true; button.textContent = 'Building…'; }
  try {
    const bytes = await window.Annotator.appendTo(doc.output('arraybuffer'), docs, attachmentFit[type]);
    showPdf(new Blob([bytes], { type: 'application/pdf' }), filename, null);
  } catch (err) {
    showPdf(doc.output('blob'), filename, doc);
    console.error('Attachments could not be added:', err);
  } finally {
    if (button) { button.disabled = false; button.textContent = wording; }
  }
}

/*
 * A document this app didn't make, opened on its own: marked up and saved back out under
 * whatever name was typed in the editor. The original pages are carried through untouched.
 */
async function openForMarkup(file) {
  uploadError.hidden = true;
  try {
    const item = await window.Annotator.readFile(file);
    markUp(item);
  } catch (err) {
    showUploadError('Couldn’t open that file: ' + err.message);
  }
}

/*
 * Marks up a document and previews the result. Backing out of the preview returns to the
 * editor with the marks still in place, rather than throwing the work away and landing on the
 * form list.
 */
function markUp(item) {
  openEditor(item, async (finished) => {
    if (!finished) return;
    try {
      const bytes = await window.Annotator.standalone(finished);
      showPdf(new Blob([bytes], { type: 'application/pdf' }), finished.name, null,
              () => markUp(finished));
    } catch (err) {
      showUploadError('Couldn’t save that document: ' + err.message);
    }
  });
}

// A getter, not a copy: the list is replaced outright when the builder is cleared, and a plain
// reference would go on pointing at the old array
Object.defineProperty(window, 'builderItems', { get: () => builderItems });
window.attachmentFit = attachmentFit;
Object.defineProperty(window, 'builderFit', { get: () => builderFit });

window.__app = { FORM_BUILDERS, KEY_FIELD, DRAFT_PREFIX,
                 get attachments() { return attachments; },
                 TOOL_SETTINGS, INK_COLOURS, HIGHLIGHT_COLOURS };

/* ============ Filling a form from JSON ============
 *
 * Another application can hand a grievance over as a .json file, dropped on the page or chosen
 * through the same upload link as a PDF. It rides on that route on purpose: it isn't something
 * a rep does day to day, and it doesn't deserve a button of its own.
 *
 * The file says which kind of grievance it is and supplies whatever values it has. Nothing is
 * written straight into a form — what would be filled is shown first, because the form may
 * already have a draft in it.
 */
const IMPORT_FORM_FIELDS = {
  ford: ['employeeName', 'globalId', 'department', 'processCoach', 'article',
         'dateIncident', 'dateFiled', 'details',
         'hoursStraight', 'hoursShift1', 'hoursTimeHalf', 'hoursShift3', 'hoursDouble', 'hoursTriple'],
  policy: ['employeeName', 'globalId', 'department', 'processCoach', 'article',
           'dateIncident', 'dateFiled', 'details'],
};

/*
 * The two lists above are the handover contract with the other application, so they are written
 * out by hand and stay put. The Fact Sheet and the 4.01 aren't part of that contract — they are
 * only ever read back from a .grv this app wrote itself — so their fields are taken from the
 * form as it stands. Nothing to keep in step with the markup, and nothing to forget.
 */
function importableFields(type) {
  if (IMPORT_FORM_FIELDS[type]) return IMPORT_FORM_FIELDS[type];
  const names = [];
  FORM_BUILDERS[type].form.querySelectorAll('[name]').forEach(el => {
    if (!names.includes(el.name)) names.push(el.name);
  });
  return names;
}

/*
 * Asked of the field itself rather than its name — seniorityDate is a date and doesn't start
 * with "date", and a name-shaped guess would eventually be wrong the other way too.
 */
function isDateField(type, field) {
  const el = FORM_BUILDERS[type] && FORM_BUILDERS[type].form.querySelector('[name="' + field + '"]');
  if (!el) return false;
  // By the time this runs the date inputs have been replaced by the app's own picker, which
  // keeps the value on a hidden input — so both shapes count
  return el.type === 'date' || (el.type === 'hidden' && !!el.closest('.datepicker'));
}

/* The label printed beside the field, so the confirmation step doesn't read out variable names */
function importLabel(type, field) {
  if (IMPORT_LABELS[field]) return IMPORT_LABELS[field];
  const el = FORM_BUILDERS[type] && FORM_BUILDERS[type].form.querySelector('[name="' + field + '"]');
  const label = el && el.closest('label');
  const caption = label && label.querySelector('.dc-field-label');
  return (caption && caption.textContent.trim()) || field;
}

/* The sending app won't know our field names, so a spread of plausible ones is accepted */
const IMPORT_ALIASES = {
  employeeName: ['employeename', 'name', 'employee', 'grievor', 'grievorname', 'member', 'membername'],
  globalId: ['globalid', 'gid', 'employeeid', 'employeenumber', 'badge', 'badgenumber', 'id'],
  department: ['department', 'dept', 'deptname', 'departmentname'],
  processCoach: ['processcoach', 'coach', 'supervisor', 'leader', 'teamleader'],
  article: ['article', 'articleviolation', 'articles', 'violation', 'violations', 'articlesviolated'],
  dateIncident: ['dateincident', 'incidentdate', 'dateofincident', 'occurred', 'occurrencedate',
                 'incident', 'dateofoccurrence'],
  dateFiled: ['datefiled', 'fileddate', 'dateoffiling', 'filed', 'submitted', 'submitteddate'],
  details: ['details', 'detailsofincident', 'description', 'narrative', 'summary', 'statement', 'facts'],
  hoursStraight: ['hoursstraight', 'straighttime', 'straight', 'hoursatstraighttime'],
  hoursTimeHalf: ['hourstimehalf', 'timeandonehalf', 'timehalf', 'hoursattimeandonehalf', 'overtime'],
  hoursDouble: ['hoursdouble', 'doubletime', 'hoursatdoubletime'],
  hoursTriple: ['hourstriple', 'tripletime', 'hoursattripletime'],
  hoursShift1: ['hoursshift1', 'shift1', 'shift1premium', 'shiftonepremium', 'hoursof1shiftprem'],
  hoursShift3: ['hoursshift3', 'shift3', 'shift3premium', 'shiftthreepremium', 'hoursof3shiftprem'],
};

const IMPORT_LABELS = {
  employeeName: 'Employee Name', globalId: 'Global ID', department: 'Department',
  processCoach: 'Process Coach', article: 'Article Violation', dateIncident: 'Date of Incident',
  dateFiled: 'Date Filed', details: 'Details of Incident',
  hoursStraight: 'Hours at straight time', hoursShift1: 'Hours of #1 Shift Prem',
  hoursTimeHalf: 'Hours at time & one half', hoursShift3: 'Hours of #3 Shift Prem',
  hoursDouble: 'Hours at double time', hoursTriple: 'Hours at triple time',
};

const IMPORT_FORM_NAMES = {
  ford: 'Grievance Investigation & Claim', policy: 'Policy Grievance',
  unifor: 'Fact Sheet', investigation: 'Investigation Form',
};

function normaliseKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/*
 * "monetary" and "policy" are what the sending app is asked for; the rest are courtesies. The
 * last two only turn up in a .grv this app saved, which writes the form's own name.
 */
function importFormType(raw) {
  const word = normaliseKey(raw || '');
  if (['monetary', 'money', 'ford', 'claim', 'grievance', 'monetarygrievance'].includes(word)) return 'ford';
  if (['policy', 'policygrievance'].includes(word)) return 'policy';
  if (['unifor', 'factsheet', 'fact'].includes(word)) return 'unifor';
  if (['investigation', 'investigationform', '401', 'step401'].includes(word)) return 'investigation';
  return null;
}

/* Accepts yyyy-mm-dd, yyyy/mm/dd, mm/dd/yyyy and an ISO timestamp; anything else is left out */
function importDate(value) {
  const text = String(value).trim();
  let m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  return null;
}

/*
 * Reads a handover file into { type, values, ignored }. Values may sit under `fields`, `data`
 * or `values`, or simply at the top level — the shape the other app finds natural is fine.
 */
function readGrievanceJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('that file isn’t valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('the file should contain a single grievance');
  }

  const type = importFormType(parsed.form || parsed.type || parsed.formType || parsed.grievanceType);
  if (!type) {
    throw new Error('it doesn’t say whether this is a "monetary" or a "policy" grievance');
  }

  const source = parsed.fields || parsed.data || parsed.values || parsed;
  const lookup = {};
  Object.keys(source).forEach(key => { lookup[normaliseKey(key)] = source[key]; });

  const fields = importableFields(type);
  const namesFor = field => {
    const own = normaliseKey(field);
    const aliases = IMPORT_ALIASES[field] || [];
    return aliases.includes(own) ? aliases : [own].concat(aliases);
  };

  const values = {};
  const ignored = [];
  fields.forEach(field => {
    const alias = namesFor(field).find(name => lookup[name] !== undefined && lookup[name] !== null && lookup[name] !== '');
    if (!alias) return;
    let value = lookup[alias];
    if (isDateField(type, field)) {
      const iso = importDate(value);
      if (!iso) { ignored.push(importLabel(type, field) + ' (couldn’t read the date)'); return; }
      value = iso;
    }
    values[field] = String(value);
  });

  // Anything sent that this form has no home for, so it can be said out loud rather than lost
  const claimed = new Set();
  fields.forEach(f => namesFor(f).forEach(a => claimed.add(a)));
  Object.keys(lookup).forEach(key => {
    if (!claimed.has(key) && !['form', 'type', 'formtype', 'grievancetype', 'fields', 'data', 'values'].includes(key)) {
      ignored.push(String(key));
    }
  });

  return { type, values, ignored };
}

/* ---------- The confirmation step ---------- */
const importOverlay = document.getElementById('importOverlay');
let pendingImport = null;

function showImport(result, filename) {
  pendingImport = result;
  const entries = Object.keys(result.values);
  document.getElementById('importSummary').textContent =
    filename + ' holds a ' + IMPORT_FORM_NAMES[result.type] + ' with ' +
    entries.length + (entries.length === 1 ? ' value.' : ' values.');

  const list = document.getElementById('importList');
  list.innerHTML = '';
  entries.forEach(field => {
    const row = document.createElement('div');
    row.className = 'import-row';
    const label = document.createElement('span');
    label.className = 'import-label';
    label.textContent = importLabel(result.type, field);
    const value = document.createElement('span');
    value.className = 'import-value';
    const text = result.values[field];
    value.textContent = text.length > 90 ? text.slice(0, 90) + '…' : text;
    row.append(label, value);
    list.appendChild(row);
  });

  const leftOut = document.getElementById('importIgnored');
  if (result.ignored.length) {
    leftOut.hidden = false;
    leftOut.textContent = 'Not used: ' + result.ignored.join(', ') + '.';
  } else {
    leftOut.hidden = true;
  }

  // The form may already have work in it, and filling replaces the lot
  const warning = document.getElementById('importWarning');
  warning.hidden = !formHasContent(result.type);
  if (!warning.hidden) {
    warning.textContent = 'The ' + IMPORT_FORM_NAMES[result.type] +
      ' form already has something in it. Filling it in from this file replaces what is there.';
  }

  document.getElementById('importConfirm').disabled = entries.length === 0;
  importOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('importConfirm').focus();
}

function closeImport() {
  importOverlay.hidden = true;
  document.body.style.overflow = '';
  pendingImport = null;
}

document.querySelectorAll('[data-import-close]').forEach(button => {
  button.addEventListener('click', closeImport);
});

document.getElementById('importConfirm').addEventListener('click', () => {
  if (!pendingImport) return;
  const { type, values } = pendingImport;
  closeImport();
  showForm(type, values);
  saveDraft(type);
});

async function handleJsonImport(file) {
  try {
    const result = readGrievanceJson(await file.text());
    showImport(result, file.name);
  } catch (err) {
    showUploadError('Couldn’t use ' + file.name + ': ' + err.message + '.');
  }
}

/*
 * Kick off the ways a grievance can arrive from outside. Down here on purpose: these reach the
 * import dialog and the form registry, which are declared further up but only initialised as
 * this file runs, so calling them where they're defined would be too early.
 */
consumeGrvLink();
collectSharedFile();
