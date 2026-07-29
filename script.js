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

/* ============ Mobile preview toggle ============ */
const workspace = document.getElementById('workspace');
const previewToggle = document.getElementById('previewToggle');

previewToggle.addEventListener('click', () => {
  const open = workspace.classList.toggle('preview-open');
  previewToggle.textContent = open ? 'Edit' : 'Preview';
  previewToggle.setAttribute('aria-expanded', String(open));
});

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
const pdfViewerFrame = document.getElementById('pdfViewerFrame');
const pdfViewerName = document.getElementById('pdfViewerName');
let viewerDoc = null;
let viewerFilename = '';
let viewerUrl = null;

function openPdfViewer(doc, filename) {
  viewerDoc = doc;
  viewerFilename = filename;
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = URL.createObjectURL(doc.output('blob'));

  pdfViewerName.textContent = filename;
  // Toolbar left on — that's what gives the viewer its own print, zoom and page controls.
  pdfViewerFrame.src = viewerUrl + '#navpanes=0&view=FitH';
  pdfViewer.hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('pdfViewerClose').focus();
}

function closePdfViewer() {
  pdfViewer.hidden = true;
  // Drop the src before revoking, or the viewer can blank out mid-teardown
  pdfViewerFrame.removeAttribute('src');
  document.body.style.overflow = '';
  if (viewerUrl) {
    URL.revokeObjectURL(viewerUrl);
    viewerUrl = null;
  }
  viewerDoc = null;
}

document.getElementById('pdfViewerClose').addEventListener('click', closePdfViewer);

document.getElementById('pdfViewerDownload').addEventListener('click', () => {
  if (viewerDoc) download(viewerDoc, viewerFilename);
});

document.getElementById('pdfViewerPrint').addEventListener('click', () => {
  // Printing an embedded PDF is inconsistent across browsers, so fall back to opening the
  // file in its own tab where the viewer's own print button is always available.
  try {
    pdfViewerFrame.contentWindow.print();
  } catch {
    window.open(viewerUrl, '_blank', 'noopener');
  }
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

function buildFilename(name, formTypeLabel) {
  const today = new Date();
  const dateStr = `${MONTH_NAMES_FULL[today.getMonth()]} ${today.getDate()} ${today.getFullYear()}`;
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

/* Centered bold form title at the top of the page, wrapping (rather than overflowing) if it's long */
function drawFormHeading(doc, text, y = 40) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  const lines = doc.splitTextToSize(text, 480);
  lines.forEach((line, i) => doc.text(line, 306, y + i * 18, { align: 'center' }));
  return y + lines.length * 18;
}

const UNIFOR_LOGO_ASPECT = 1342 / 532;

/* The official Unifor logo (see unifor-logo.js), right-aligned so rightEdgeX is its right edge */
function drawUniforLogo(doc, rightEdgeX, topY, width = 110) {
  if (!window.UNIFOR_LOGO_PNG) return;
  const h = width / UNIFOR_LOGO_ASPECT;
  doc.addImage(window.UNIFOR_LOGO_PNG, 'PNG', rightEdgeX - width, topY, width, h);
}

/* SP number + logo, repeated at the top of every Unifor Fact Sheet page. Returns the y to start content at. */
function drawUniforPageHeader(doc, marginX, W, data) {
  const y = 44;
  doc.setFillColor(226, 226, 236);
  doc.rect(marginX, y, 90, 18, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(`SP-${data.spNumber || ''}`, marginX + 6, y + 12);
  drawUniforLogo(doc, marginX + W, y - 4);
  return y + 40;
}

/* "Unifor Local 200 / PRIVATE / pg. X / 5" footer, repeated at the bottom of every page */
function drawUniforFooter(doc, marginX, W, pageNum, totalPages = 5) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
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
  doc.setTextColor(0, 0, 0);
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
 * Left-aligned per the style guide (the older centered heading is drawFormHeading).
 */
function drawDocHeader(doc, x, y, w, title, subtitle) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...DC.ink);
  const titleLines = doc.splitTextToSize(title, w);
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
  const bw = doc.getTextWidth(boldLabel);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...DC.bandSub);
  doc.text(restLabel, x + 8 + bw, y + 12);
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
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(valueFontSize);
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
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(valueFontSize);
    doc.setTextColor(...DC.ink);
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
  doc.setFontSize(fontSize);
  const allLines = doc.splitTextToSize(value || '', w - CELL_X * 2);
  let idx = 0, currentY = y, first = true;
  do {
    // If even the minimum box height won't fit before the page edge, start fresh on a new page
    // rather than drawing an oversized box that gets physically clipped by the margin.
    if (currentY + 6 + minH > PAGE_BOTTOM) {
      doc.addPage();
      currentY = 40;
    }
    const text = first ? label : label.replace(/:\s*$/, '') + ' (continued):';
    setLabelStyle(doc);
    doc.text(text.replace(/:\s*$/, '').toUpperCase(), x, currentY);
    clearLabelStyle(doc);
    const boxY = currentY + 6;
    const availH = PAGE_BOTTOM - boxY;
    const maxLines = Math.max(1, Math.floor((availH - 10) / lineHeight));
    const remaining = allLines.length - idx;
    const linesThisBox = Math.max(1, Math.min(remaining, maxLines));
    // Clamped to availH as a hard floor: the box can never be drawn past the page edge.
    const boxH = Math.min(availH, Math.max(minH, linesThisBox * lineHeight + 10));
    doc.setDrawColor(...DC.border);
    doc.setLineWidth(0.75);
    doc.roundedRect(x, boxY, w, boxH, DC_RADIUS, DC_RADIUS);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(...DC.inkSoft);
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

const HOUR_CELL_H = 36;

/*
 * An hours cell in the guide's labelled-field style: its own bordered box with the label
 * above the value, rather than a label sitting outside a separate value box.
 */
function hourCell(doc, x, y, w, label, value) {
  doc.setDrawColor(...DC.border);
  doc.setLineWidth(0.75);
  doc.roundedRect(x, y, w, HOUR_CELL_H, DC_RADIUS, DC_RADIUS);

  setLabelStyle(doc);
  doc.text(doc.splitTextToSize(label.toUpperCase(), w - CELL_X * 2)[0], x + CELL_X, y + 10.5);
  clearLabelStyle(doc);

  const val = (value || '').toString();
  doc.setFont('helvetica', 'normal');
  fitSingleLine(doc, val, w - CELL_X * 2, 9.5, 6.5);
  doc.setTextColor(...DC.ink);
  doc.text(val, x + CELL_X, y + 26);
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
  openPdfViewer(doc, buildFilename(data.employeeName, 'Grievance Claim'));
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
  openPdfViewer(doc, buildFilename(data.employeeName, 'Policy Grievance'));
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

  y = drawFormHeading(doc, FORMS_CONFIG.unifor.title, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text('For Local Union Use Only', 306, y, { align: 'center' });
  y += 12;
  doc.text('This form to accompany First Stage Grievance appealed to Bargaining Committee', 306, y, { align: 'center' });
  y += 26;

  y = boxedGrid(doc, marginX, y, W, [
    { label: "Grievor's Name", value: data.grievorName, width: W * 0.45 },
    { label: 'GID #', value: data.gid, width: W * 0.25 },
    { label: 'Dept', value: data.dept, width: W * 0.30 },
  ]);
  y += 6;

  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Seniority Date', value: fmtDateFit(doc, data.seniorityDate, W / 2 - CELL_X * 2), width: W / 2 },
    { label: 'Classification', value: data.classification, width: W / 2 },
  ]);
  y += 4;

  // Rate and COLA are always looked at together, so keep them adjacent
  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Time in Classification', value: data.timeInClass, width: W * 0.4 },
    { label: 'Rate $', value: formatCurrency(data.rate), width: W * 0.3 },
    { label: 'COLA $', value: formatCurrency(data.cola), width: W * 0.3 },
  ]);
  y += 4;

  y = boxedGrid(doc, marginX, y, W, [
    { label: "Employee's Supervisor", value: data.supervisor, width: W / 2 },
    { label: 'General Supervisor', value: data.generalSupervisor, width: W / 2 },
  ]);
  y += 6;

  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Superintendent', value: data.superintendent, width: W / 2 },
    { label: 'Date of Incident', value: fmtDateFit(doc, data.uniforDateIncident, W / 2 - CELL_X * 2), width: W / 2 },
  ]);
  y += 6;

  // Discipline checkboxes + Date Grievance Filed — content here is always short and fixed, so a
  // plain fixed-height row (unlike boxedGrid) is safe, as long as it isn't started too close to
  // the page edge itself.
  const disciplineH = 34;
  y = ensureSpace(doc, y, disciplineH);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.75);
  doc.rect(marginX, y, W / 2, disciplineH);
  doc.rect(marginX + W / 2, y, W / 2, disciplineH);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(80, 80, 80);
  doc.text('DISCIPLINE ON RECORD?', marginX + 5, y + 9);
  doc.text('DATE GRIEVANCE FILED', marginX + W / 2 + 5, y + 9);
  checkboxText(doc, marginX + 10, y + 24, 'Yes');
  checkboxText(doc, marginX + 60, y + 24, 'No');
  if (data.discipline === 'Yes') markCheckbox(doc, marginX + 10, y + 24);
  else markCheckbox(doc, marginX + 60, y + 24);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  doc.text(fmtDate(data.uniforDateFiled), marginX + W / 2 + 5, y + 24);
  y += disciplineH + 6;

  // flowTextBox paginates itself if the value is long, so no pre-emptive page-break needed here
  y = flowTextBox(doc, marginX, y + 6, W, 'Who is involved in this grievance?', data.whoInvolved, 44);
  y += 8;

  y = boxedGrid(doc, marginX, y, W, [
    { label: 'When did it happen?', value: data.whenHappened, width: W / 2 },
    { label: 'Where did it happen?', value: data.whereHappened, width: W / 2 },
  ]);
  y += 4;

  y = flowTextBox(doc, marginX, y + 6, W, 'Why is this a grievance?', data.whyGrievance, 70);
  y += 8;

  y = flowTextBox(doc, marginX, y + 6, W, 'What do we want?', data.whatWeWant, 56);

  drawUniforFooter(doc, marginX, W, 1);

  // ---- Page 2: Supervisor's Statement / Your Observation / Additional Information ----
  doc.addPage();
  y = drawUniforPageHeader(doc, marginX, W, data);
  y += 10;
  y = flowTextBox(doc, marginX, y, W, "Supervisor's Statement", data.supervisorStatement, 170);
  y += 14;
  y = flowTextBox(doc, marginX, y, W, 'Your Observation', data.yourObservation, 170);
  y += 14;
  y = flowTextBox(doc, marginX, y, W, 'Additional Information', data.additionalInfo, 170);
  drawUniforFooter(doc, marginX, W, 2);

  // ---- Page 3: Investigation questions ----
  doc.addPage();
  y = drawUniforPageHeader(doc, marginX, W, data);
  y += 10;

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
  doc.setTextColor(0, 0, 0);
  doc.text('If so, when?', marginX, y);
  doc.setFont('helvetica', 'normal');
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
  y += 10;

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
  doc.setTextColor(0, 0, 0);
  doc.text("Grievor's Signature:", marginX, y);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.75);
  doc.line(marginX + 110, y + 2, marginX + 400, y + 2);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
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
  y += 10;
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
  openPdfViewer(doc, buildFilename(data.grievorName, 'Fact Sheet'));
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

  // Step box, top-right
  const stepW = 60, stepH = 20;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  doc.text('Step:', marginX + W - stepW - 34, y + 14);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.75);
  doc.rect(marginX + W - stepW, y, stepW, stepH);
  doc.setFont('helvetica', 'normal');
  doc.text(data.step || '', marginX + W - stepW + 6, y + 14);

  y = drawFormHeading(doc, FORMS_CONFIG.investigation.title, y + 26);
  y += 14;

  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Name of Supervisor', value: data.supervisorName, width: W / 2 },
    { label: 'Area', value: data.area, width: W / 2 },
  ]);
  y += 4;
  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Date of Infraction', value: fmtDateFit(doc, data.dateInfraction, W / 2 - CELL_X * 2), width: W / 2 },
    { label: 'Dept #', value: data.deptNum, width: W / 2 },
  ]);
  y += 4;
  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Name of Witnesses', value: data.witnessNames, width: W / 2 },
    { label: 'Time', value: data.time, width: W / 2 },
  ]);
  y += 4;
  y = boxedGrid(doc, marginX, y, W, [{ label: 'Unifor Representative', value: data.uniforRep, width: W }]);
  y += 4;
  y = boxedGrid(doc, marginX, y, W, [{ label: 'HR Representative', value: data.hrRep, width: W }]);
  y += 10;

  y = flowTextBox(doc, marginX, y, W, 'Investigation of Incident:', data.investigation, 170);
  y += 12;
  y = flowTextBox(doc, marginX, y, W, "Supervisor's Remarks:", data.supervisorRemarks, 130);
  y += 12;
  flowTextBox(doc, marginX, y, W, 'Resolution:', data.resolution, 110);

  embedFormData(doc, 'investigation', data);
  return doc;
}

const investigationForm = document.getElementById('investigationForm');

investigationForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = fd(e.target);
  const doc = buildInvestigationDoc(data);
  openPdfViewer(doc, buildFilename(data.supervisorName, 'Investigation Form'));
});

document.getElementById('investigationClear').addEventListener('click', () => {
  clearForm(investigationForm);
});

/* ============ Live preview ============ */
const previewFrame = document.getElementById('pdfPreview');
let previewUrl = null;

const FORM_BUILDERS = {
  ford: { form: fordForm, build: buildFordDoc, label: 'Grievance Claim' },
  policy: { form: policyForm, build: buildPolicyDoc, label: 'Policy Grievance' },
  unifor: { form: uniforForm, build: buildUniforDoc, label: 'Fact Sheet' },
  investigation: { form: investigationForm, build: buildInvestigationDoc, label: 'Investigation Form' },
};

let currentFormType = null;

function renderPreview() {
  if (!currentFormType || currentFormType === 'ford') return;
  const entry = FORM_BUILDERS[currentFormType];
  const doc = entry.build(fd(entry.form));
  const blobUrl = URL.createObjectURL(doc.output('blob'));

  // Fade out instead of an abrupt white reload flash while the new PDF loads in.
  // Leave the toolbar on (zoom, page nav, print/download) — navpanes=0 hides the thumbnail
  // sidebar, and view=FitH scales the page to fit the preview pane's width on load.
  previewFrame.classList.add('is-refreshing');
  previewFrame.onload = () => previewFrame.classList.remove('is-refreshing');
  previewFrame.src = blobUrl + '#navpanes=0&view=FitH';

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = blobUrl;
}

const updateActivePreview = debounce(renderPreview, 800);

/* Live-refresh toggle: while off, edits no longer auto-render — a manual refresh button appears instead */
const liveRefreshToggle = document.getElementById('liveRefreshToggle');
const manualRefreshBtn = document.getElementById('manualRefreshBtn');

function maybeUpdatePreview() {
  if (liveRefreshToggle.checked) updateActivePreview();
}

liveRefreshToggle.addEventListener('change', () => {
  manualRefreshBtn.hidden = liveRefreshToggle.checked;
  if (liveRefreshToggle.checked) renderPreview();
});

manualRefreshBtn.addEventListener('click', renderPreview);

fordForm.addEventListener('input', maybeUpdatePreview);
fordForm.addEventListener('change', maybeUpdatePreview);
policyForm.addEventListener('input', maybeUpdatePreview);
policyForm.addEventListener('change', maybeUpdatePreview);
uniforForm.addEventListener('input', maybeUpdatePreview);
uniforForm.addEventListener('change', maybeUpdatePreview);
investigationForm.addEventListener('input', maybeUpdatePreview);
investigationForm.addEventListener('change', maybeUpdatePreview);

renderPreview();

/* ============ Unsaved-changes guard ============ */
function formHasData(form) {
  return Array.from(form.elements).some(el => {
    if (!el.name) return false;
    if (el.type === 'radio' || el.type === 'checkbox') return false;
    return (el.value || '').toString().trim() !== '';
  });
}

window.addEventListener('beforeunload', (e) => {
  if (formHasData(fordForm) || formHasData(policyForm) || formHasData(uniforForm) || formHasData(investigationForm)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ============ Home / fill-form view routing ============ */
const homeView = document.getElementById('homeView');

function showHome() {
  currentFormType = null;
  homeView.hidden = false;
  workspace.hidden = true;
  previewToggle.style.display = 'none';
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
  renderPreview();
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
  workspace.hidden = false;
  workspace.classList.toggle('ford-fullwidth', type === 'ford');
  previewToggle.style.display = type === 'ford' ? 'none' : '';
  panels.forEach(p => p.classList.remove('active'));
  document.getElementById('form-' + type).classList.add('active');
  const entry = FORM_BUILDERS[type];
  if (data) populateForm(entry.form, data);
  else entry.form.reset();
  document.querySelectorAll('.datepicker').forEach(dp => dp.refreshDisplay && dp.refreshDisplay());
  // scrollHeight reads 0 while the panel is hidden, so size the textareas now that it's visible
  entry.form.querySelectorAll(DC_AUTOGROW).forEach(autoGrow);
  if (type !== 'ford') renderPreview();
}

document.querySelectorAll('.form-card').forEach(card => {
  card.addEventListener('click', () => showForm(card.dataset.form));
});

document.getElementById('backToForms').addEventListener('click', () => {
  if (formHasData(FORM_BUILDERS[currentFormType].form) &&
      !confirm('Leave this form? Anything you’ve entered will be lost unless you’ve already saved a PDF.')) {
    return;
  }
  showHome();
});

/* ============ Upload & recognize a previously generated PDF ============ */
const uploadInput = document.getElementById('uploadInput');
const uploadError = document.getElementById('uploadError');

function showUploadError(message) {
  uploadError.textContent = message;
  uploadError.hidden = false;
}

uploadInput.addEventListener('change', async () => {
  const file = uploadInput.files[0];
  uploadInput.value = ''; // allow re-selecting the same file later
  if (!file) return;

  uploadError.hidden = true;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    showUploadError('Please choose a PDF file.');
    return;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const payload = readEmbeddedFormData(bytes);
  if (!payload) {
    showUploadError('This doesn’t look like a form generated by this app — only PDFs created here can be recognized and auto-filled.');
    return;
  }
  if (!FORM_BUILDERS[payload.formType]) {
    showUploadError('Unrecognized form type.');
    return;
  }
  showForm(payload.formType, payload.data);
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
  const placeholder = 'Select date';

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
      renderPreview();
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

/*
 * Single-line grid cells are textareas so their text wraps like the PDF's does, but they stand in
 * for what were <input>s — Enter should submit the form, not insert a line the PDF won't show.
 */
document.querySelectorAll('.dc-value').forEach(el => {
  el.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    el.form?.requestSubmit();
  });
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
