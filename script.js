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

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y) return iso;
  return `${m}/${d}/${y}`;
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

/*
 * "NAME - MMDDYYYY FORMTYPE.pdf" — a real Save As dialog isn't something a page can force open
 * (that's the user's own "always ask where to save files" browser setting); this just supplies
 * the suggested filename for whatever save behavior the browser is configured to use.
 */
const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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

/* Dark header bar: bold black-on-white "Section X:" style label matching the printed originals */
function sectionBar(doc, x, y, w, boldLabel, restLabel) {
  const h = 18;
  doc.setFillColor(20, 20, 20);
  doc.rect(x, y, w, h, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(255, 255, 255);
  doc.text(boldLabel, x + 8, y + 12);
  const bw = doc.getTextWidth(boldLabel);
  doc.setFont('helvetica', 'normal');
  doc.text(restLabel, x + 8 + bw, y + 12);
  return y + h;
}

/*
 * One continuous bordered row split into cells by thin divider lines.
 * Height grows automatically to fit whatever the label/value need — nothing is ever truncated.
 */
function prepareGridCells(doc, cells) {
  const labelFontSize = 6.5, valueFontSize = 9.5;
  return cells.map(c => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(labelFontSize);
    const labelLines = doc.splitTextToSize(c.label.toUpperCase(), c.width - 8).slice(0, 2);
    doc.setFontSize(valueFontSize);
    const valueLines = doc.splitTextToSize(c.value || '', c.width - 10);
    return { ...c, labelLines, valueLines };
  });
}

function gridHeightFromPrepared(prepared, minH) {
  const lineHeight = 11;
  const maxLabelLines = Math.max(1, ...prepared.map(p => p.labelLines.length));
  const maxValueLines = Math.max(1, ...prepared.map(p => p.valueLines.length));
  const labelBlockH = 9 + (maxLabelLines - 1) * 7.5;
  return { h: Math.max(minH, labelBlockH + 6 + maxValueLines * lineHeight + 6), labelBlockH };
}

/* Measures the height boxedGrid(doc, x, y, w, cells, minH) would draw, without drawing it */
function measureBoxedGrid(doc, cells, minH = 34) {
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
  const extraH = extra ? extra.height + 5 : 0;
  const totalH = 18 + 4 + extraH + gridH + 4 + 6 + commentsMinH;
  y = ensureSpace(doc, y, totalH);

  y = sectionBar(doc, marginX, y, W, boldLabel, restLabel);
  y += 4;
  if (extra) {
    extra.draw(doc, marginX, y, W);
    y += extra.height + 5;
  }
  y = boxedGrid(doc, marginX, y, W, gridCells, gridMinH);
  y += 4;
  y = flowTextBox(doc, marginX, y + 6, W, 'Comments:', '', commentsMinH);
  y += 8;
  return y;
}

function boxedGrid(doc, x, y, w, cells, minH = 34) {
  const labelFontSize = 6.5, valueFontSize = 9.5;
  const prepared = prepareGridCells(doc, cells);
  const { h, labelBlockH } = gridHeightFromPrepared(prepared, minH);

  // A grid row is drawn as one piece (splitting a row's cells across a page break would look
  // broken), so if it doesn't fit here, move the whole thing to a fresh page instead of clipping.
  if (y + h > PAGE_BOTTOM) {
    doc.addPage();
    y = 40;
  }

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.75);
  doc.rect(x, y, w, h);
  let cx = x;
  prepared.forEach((c, i) => {
    if (i > 0) doc.line(cx, y, cx, y + h);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(labelFontSize);
    doc.setTextColor(80, 80, 80);
    doc.text(c.labelLines, cx + 5, y + 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(valueFontSize);
    doc.setTextColor(0, 0, 0);
    doc.text(c.valueLines, cx + 5, y + labelBlockH + 12);
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
  const allLines = doc.splitTextToSize(value || '', w - 10);
  let idx = 0, currentY = y, first = true;
  do {
    // If even the minimum box height won't fit before the page edge, start fresh on a new page
    // rather than drawing an oversized box that gets physically clipped by the margin.
    if (currentY + 6 + minH > PAGE_BOTTOM) {
      doc.addPage();
      currentY = 40;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.text(first ? label : label.replace(/:\s*$/, '') + ' (continued):', x, currentY);
    const boxY = currentY + 6;
    const availH = PAGE_BOTTOM - boxY;
    const maxLines = Math.max(1, Math.floor((availH - 10) / lineHeight));
    const remaining = allLines.length - idx;
    const linesThisBox = Math.max(1, Math.min(remaining, maxLines));
    // Clamped to availH as a hard floor: the box can never be drawn past the page edge.
    const boxH = Math.min(availH, Math.max(minH, linesThisBox * lineHeight + 10));
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.75);
    doc.rect(x, boxY, w, boxH);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(0, 0, 0);
    doc.text(allLines.slice(idx, idx + linesThisBox), x + 5, boxY + 14);
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

/*
 * An hours field: bold label, then a small bordered box right-aligned within the column.
 * The value is centered and the box grows (font shrinks first) rather than clipping.
 */
function hourField(doc, x, y, w, label, value) {
  const boxW = 70;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(label, x, y + 13);

  const boxX = x + w - boxW;
  const val = (value || '').toString();
  doc.setFont('helvetica', 'normal');
  fitSingleLine(doc, val, boxW - 8, 9.5, 6.5);
  const lines = doc.getTextWidth(val) > boxW - 8 ? doc.splitTextToSize(val, boxW - 8) : [val];
  const boxH = Math.max(18, lines.length * 11 + 6);

  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.75);
  doc.rect(boxX, y, boxW, boxH);
  doc.setTextColor(0, 0, 0);
  const startY = y + (boxH - (lines.length - 1) * 11) / 2 + 3.5;
  lines.forEach((ln, i) => doc.text(ln, boxX + boxW / 2, startY + i * 11, { align: 'center' }));
  return y + boxH;
}

/* A square checkbox (y is its vertical center) followed by its label — sized generously so a
   digital-signing tool's checkmark/X actually has room to land inside it */
function checkboxText(doc, x, y, label) {
  const size = 15;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(1);
  doc.rect(x, y - size / 2, size, size);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  doc.text(label, x + size + 6, y + 3.5);
}

/* Draws an X through a checkbox drawn by checkboxText at the same x, y */
function markCheckbox(doc, x, y) {
  const size = 15;
  const top = y - size / 2;
  doc.setLineWidth(1.3);
  doc.line(x + 2, top + 2, x + size - 2, top + size - 2);
  doc.line(x + 2, top + size - 2, x + size - 2, top + 2);
}

/* ============ FORD FORM ============ */
function buildFordDoc(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const marginX = 40;
  const W = 532;
  let y = drawFormHeading(doc, FORMS_CONFIG.ford.title);

  y = sectionBar(doc, marginX, y, W, 'Section A:', ' Employee Details & Grievance Summary');
  y += 4;

  const w4 = W / 4;
  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Employee Name', value: data.employeeName, width: w4 },
    { label: 'Global ID', value: data.globalId, width: w4 },
    { label: 'Department', value: data.department, width: w4 },
    { label: 'Process Coach', value: data.processCoach, width: w4 },
  ]);
  y += 4;

  // Article Violation spans two grid columns, Date of Incident/Filed each take one, so the
  // dividers in this row land exactly on the dividers from the row above.
  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Article Violation', value: data.article, width: w4 * 2 },
    { label: 'Date of Incident', value: fmtDate(data.dateIncident), width: w4 },
    { label: 'Date Filed', value: fmtDate(data.dateFiled), width: w4 },
  ]);
  y += 4;

  // flowTextBox paginates itself if the value is long, so no pre-emptive page-break needed here
  y = flowTextBox(doc, marginX, y + 6, W, 'Details of Incident:', data.details, 70);
  y += 8;

  y = ensureSpace(doc, y, 70);
  const hoursColW = W / 2 - 10;
  let hy = y;
  hourField(doc, marginX, hy, hoursColW, 'Hours at straight time:', data.hoursStraight);
  hourField(doc, marginX + hoursColW + 20, hy, hoursColW, 'Hours of #1 Shift Prem:', data.hoursShift1);
  hy += 22;
  hourField(doc, marginX, hy, hoursColW, 'Hours at time & one half:', data.hoursTimeHalf);
  hourField(doc, marginX + hoursColW + 20, hy, hoursColW, 'Hours of #3 Shift Prem:', data.hoursShift3);
  hy += 22;
  hourField(doc, marginX, hy, hoursColW, 'Hours at double time:', data.hoursDouble);
  hourField(doc, marginX + hoursColW + 20, hy, hoursColW, 'Hours at triple time:', data.hoursTriple);
  y = hy + 22;

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
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.75);
      doc.rect(x, y, w, approveH);
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
  download(doc, buildFilename(data.employeeName, 'Grievance Claim'));
});

document.getElementById('fordClear').addEventListener('click', () => {
  fordForm.reset();
});

/* ============ POLICY GRIEVANCE FORM ============ */
/* A trimmed variant of the Ford form for policy grievances: same Section A layout, but with the
   hours grid and the money-related Section D (Payroll & Accounting) removed entirely. */
function buildPolicyDoc(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const marginX = 40;
  const W = 532;
  let y = drawFormHeading(doc, FORMS_CONFIG.policy.title);

  y = sectionBar(doc, marginX, y, W, 'Section A:', ' Employee Details & Grievance Summary');
  y += 4;

  const w4 = W / 4;
  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Employee Name', value: data.employeeName, width: w4 },
    { label: 'Global ID', value: data.globalId, width: w4 },
    { label: 'Department', value: data.department, width: w4 },
    { label: 'Process Coach', value: data.processCoach, width: w4 },
  ]);
  y += 4;

  y = boxedGrid(doc, marginX, y, W, [
    { label: 'Article Violation', value: data.article, width: w4 * 2 },
    { label: 'Date of Incident', value: fmtDate(data.dateIncident), width: w4 },
    { label: 'Date Filed', value: fmtDate(data.dateFiled), width: w4 },
  ]);
  y += 4;

  y = flowTextBox(doc, marginX, y + 6, W, 'Details of Incident:', data.details, 70);
  y += 8;

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
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.75);
      doc.rect(x, y, w, approveH);
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
  download(doc, buildFilename(data.employeeName, 'Policy Grievance'));
});

document.getElementById('policyClear').addEventListener('click', () => {
  policyForm.reset();
});

/* ============ UNIFOR FORM ============ */
function buildUniforDoc(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const marginX = 40;
  const W = 532;
  let y = 44;

  // SP number, shaded (no border) to match the fill-in fields below
  doc.setFillColor(226, 226, 236);
  doc.rect(marginX, y, 90, 18, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(`SP-${data.spNumber || ''}`, marginX + 6, y + 12);

  // Unifor mark (approximate — swap in the real logo asset via addImage if you have it)
  const logoX = marginX + W - 130;
  doc.setFillColor(196, 30, 30);
  doc.roundedRect(logoX, y - 6, 26, 26, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text('U', logoX + 13, y + 12, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(20, 40, 90);
  doc.text('UNIFOR', logoX + 32, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(90, 90, 90);
  doc.text('the Union | le syndicat', logoX + 32, y + 17);

  y += 40;
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
    { label: 'Seniority Date', value: fmtDate(data.seniorityDate), width: W / 2 },
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
    { label: 'Date of Incident', value: fmtDate(data.uniforDateIncident), width: W / 2 },
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

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text('Unifor Local 200', marginX, 770);
  doc.text('PRIVATE', 306, 770, { align: 'center' });
  doc.text('pg. 1 / 5', 572, 770, { align: 'right' });

  embedFormData(doc, 'unifor', data);
  return doc;
}

const uniforForm = document.getElementById('uniforForm');

uniforForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = fd(e.target);
  const doc = buildUniforDoc(data);
  download(doc, buildFilename(data.grievorName, 'Fact Sheet'));
});

document.getElementById('uniforClear').addEventListener('click', () => {
  uniforForm.reset();
});

/* ============ Live preview ============ */
const previewFrame = document.getElementById('pdfPreview');
let previewUrl = null;

const FORM_BUILDERS = {
  ford: { form: fordForm, build: buildFordDoc, label: 'Grievance Claim' },
  policy: { form: policyForm, build: buildPolicyDoc, label: 'Policy Grievance' },
  unifor: { form: uniforForm, build: buildUniforDoc, label: 'Fact Sheet' },
};

let currentFormType = null;

function renderPreview() {
  if (!currentFormType) return;
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
  if (formHasData(fordForm) || formHasData(policyForm) || formHasData(uniforForm)) {
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
  refreshHomePreviews();
}

/* Renders each homepage card's small preview thumbnail from that form's current field values */
const homePreviewUrls = {};

function refreshHomePreviews() {
  Object.entries(FORM_BUILDERS).forEach(([type, entry]) => {
    const iframe = document.querySelector(`.form-card[data-form="${type}"] .form-card-preview iframe`);
    if (!iframe) return;
    const doc = entry.build(fd(entry.form));
    const blobUrl = URL.createObjectURL(doc.output('blob'));
    iframe.src = blobUrl + '#toolbar=0&navpanes=0&view=FitH';
    if (homePreviewUrls[type]) URL.revokeObjectURL(homePreviewUrls[type]);
    homePreviewUrls[type] = blobUrl;
  });
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
  previewToggle.style.display = '';
  panels.forEach(p => p.classList.remove('active'));
  document.getElementById('form-' + type).classList.add('active');
  const entry = FORM_BUILDERS[type];
  if (data) populateForm(entry.form, data);
  else entry.form.reset();
  document.querySelectorAll('.datepicker').forEach(dp => dp.refreshDisplay && dp.refreshDisplay());
  renderPreview();
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
      span.textContent = sel.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
[fordForm, policyForm, uniforForm].forEach(form => {
  form.addEventListener('reset', () => {
    setTimeout(() => {
      form.querySelectorAll('.datepicker').forEach(dp => dp.refreshDisplay && dp.refreshDisplay());
      renderPreview();
    }, 0);
  });
});
