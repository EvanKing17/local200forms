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
const pdfViewerFrame = document.getElementById('pdfViewerFrame');
const pdfViewerName = document.getElementById('pdfViewerName');
let viewerDoc = null;
let viewerBlob = null;
let viewerFilename = '';
let viewerUrl = null;

function openPdfViewer(doc, filename) {
  showPdf(doc.output('blob'), filename, doc);
}

/* Shows any PDF. `doc` is optional — present when we built it, absent for an uploaded file. */
function showPdf(blob, filename, doc) {
  viewerDoc = doc || null;
  viewerBlob = blob;
  viewerFilename = filename;
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = URL.createObjectURL(blob);

  pdfViewerName.textContent = filename;
  // Toolbar left on — that's what gives the viewer its own print, zoom and page controls.
  // zoom=100 rather than view=FitH: FitH fits the page to whatever width the frame happens to
  // be, so the window ends up deciding the magnification. 100% is a Letter page at its actual
  // size. Viewers that ignore zoom fall back to fitting the frame, which is capped in CSS.
  pdfViewerFrame.src = viewerUrl + '#navpanes=0&zoom=100';
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
  viewerBlob = null;
}

document.getElementById('pdfViewerClose').addEventListener('click', closePdfViewer);

document.getElementById('pdfViewerDownload').addEventListener('click', () => {
  if (viewerDoc) { download(viewerDoc, viewerFilename); return; }
  if (!viewerBlob) return;
  // An uploaded file has no jsPDF document behind it, so save the blob directly
  const link = document.createElement('a');
  link.href = viewerUrl;
  link.download = viewerFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
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

    doc.setFont('helvetica', 'normal');
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
  doc.setFont('helvetica', 'normal');
  fitSingleLine(doc, val, w * 0.3, 9.5, 6.5);
  doc.setTextColor(...DC.ink);
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
  openPdfViewer(doc, buildFilename(data.employeeName, 'Grievance Claim', data.dateIncident));
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
  openPdfViewer(doc, buildFilename(data.employeeName, 'Policy Grievance', data.dateIncident));
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
  openPdfViewer(doc, buildFilename(data.grievorName, 'Fact Sheet', data.uniforDateIncident));
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
    { label: 'Name of Witnesses', value: data.witnessNames, width: w4 * 2 },
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
  openPdfViewer(doc, buildFilename(data.supervisorName, 'Investigation Form', data.dateInfraction));
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
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'upload-error-action';
    open.textContent = 'Open it anyway';
    open.addEventListener('click', () => {
      uploadError.hidden = true;
      showPdf(file, file.name, null);
    });
    uploadError.appendChild(open);
  }
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

  /*
   * Recognition is by the metadata embedded on the way out, not by reading the page. OCR was
   * considered and doesn't fit: it would add megabytes to a bundle that has to work offline,
   * it can't read the handwriting that fills most of a returned grievance, and even with
   * perfect text it still wouldn't know which words belong in which field.
   */
  const bytes = new Uint8Array(await file.arrayBuffer());
  const payload = readEmbeddedFormData(bytes);
  if (!payload) {
    showUploadError('This PDF wasn’t made here, so its fields can’t be filled in automatically.', file);
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

  Array.from(form.children).forEach(block => {
    const rect = block.getBoundingClientRect();
    if (!rect.height) return;
    if (rect.bottom - pageStart > PAGE_USABLE_PX && rect.top > pageStart) {
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
const DRAFT_PREFIX = 'local200forms:draft:';

/* A function, not a const, so it can't be read before it's initialised — this block sits at the
   end of the file but the form lifecycle above it calls in. */
let draftStorageOk = null;

function draftsAvailable() {
  if (draftStorageOk === null) {
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
    toolbar.insertBefore(indicator, toolbar.firstChild);
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
    toolbar.insertBefore(notice, toolbar.firstChild);
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
window.__app = { FORM_BUILDERS, KEY_FIELD, DRAFT_PREFIX };
