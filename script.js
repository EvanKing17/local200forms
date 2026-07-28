/* ============ Tab switching ============ */
const pickerBtns = document.querySelectorAll('.picker-btn');
const panels = document.querySelectorAll('.form-panel');

pickerBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    pickerBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    panels.forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    document.getElementById('form-' + btn.dataset.form).classList.add('active');
    updateActivePreview();
  });
});

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

function download(doc, filename) {
  doc.save(filename);
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

/* One continuous bordered row split into cells by thin divider lines (Ford-style field grid) */
function boxedGrid(doc, x, y, w, h, cells) {
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.75);
  doc.rect(x, y, w, h);
  let cx = x;
  cells.forEach((c, i) => {
    const cw = c.width;
    if (i > 0) doc.line(cx, y, cx, y + h);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(80, 80, 80);
    const labelLines = doc.splitTextToSize(c.label.toUpperCase(), cw - 8).slice(0, 2);
    doc.text(labelLines, cx + 5, y + 9);
    const valueY = y + 9 + (labelLines.length - 1) * 7.5 + 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(0, 0, 0);
    const lines = doc.splitTextToSize(c.value || '', cw - 10);
    doc.text(lines.slice(0, Math.max(1, Math.floor((y + h - valueY) / 11))), cx + 5, valueY);
    cx += cw;
  });
  return y + h;
}

/* Plain label above a blank bordered box (Details of Incident, Comments, etc.) */
function labelBox(doc, x, y, w, h, label, value) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(label, x, y);
  const boxY = y + 6;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.75);
  doc.rect(x, boxY, w, h);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  const lines = doc.splitTextToSize(value || '', w - 10);
  doc.text(lines.slice(0, Math.max(1, Math.floor((h - 10) / 12))), x + 5, boxY + 14);
  return boxY + h;
}

/* Label + inline value on a baseline underline (Ford hours grid) */
function underlineField(doc, x, y, w, label, value) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(label, x, y);
  const labelW = doc.getTextWidth(label) + 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const lines = doc.splitTextToSize(value || '', Math.max(10, w - labelW));
  doc.text(lines[0] || '', x + labelW, y);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.line(x + labelW, y + 3, x + w, y + 3);
}

/* An empty square checkbox followed by its label */
function checkboxText(doc, x, y, label) {
  const size = 9;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.75);
  doc.rect(x, y - size + 2, size, size);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  doc.text(label, x + size + 5, y + 1.5);
}

/* Draws an X through a checkbox drawn by checkboxText at the same x, y */
function markCheckbox(doc, x, y) {
  const size = 9;
  const top = y - size + 2;
  doc.setLineWidth(1);
  doc.line(x + 1, top + 1, x + size - 1, top + size - 1);
  doc.line(x + 1, top + size - 1, x + size - 1, top + 1);
}

/* Unifor-style shaded field: bold label to the left, filled (borderless) value box */
function shadedField(doc, x, y, w, h, label, value, labelW) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(label, x, y + h / 2 + 3);
  const bx = x + labelW, bw = w - labelW;
  doc.setFillColor(226, 226, 236);
  doc.rect(bx, y, bw, h, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  const lines = doc.splitTextToSize(value || '', bw - 8);
  doc.text(lines[0] || '', bx + 4, y + h / 2 + 3);
}

/* Unifor-style shaded question box: bold label above, filled (borderless) box below */
function shadedBigBox(doc, x, y, w, h, label, value) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  doc.text(label, x, y);
  const boxY = y + 6;
  doc.setFillColor(226, 226, 236);
  doc.rect(x, boxY, w, h, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  const lines = doc.splitTextToSize(value || '', w - 10);
  doc.text(lines.slice(0, Math.max(1, Math.floor((h - 8) / 12))), x + 5, boxY + 14);
  return boxY + h;
}

/* ============ FORD FORM ============ */
function buildFordDoc(data) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const marginX = 40;
  const W = 532;
  let y = 40;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text('Grievance Investigation & Claim Form', 306, y, { align: 'center' });
  y += 18;

  y = sectionBar(doc, marginX, y, W, 'Section A:', ' Employee Details & Grievance Summary');
  y += 4;

  const w4 = W / 4;
  y = boxedGrid(doc, marginX, y, W, 34, [
    { label: 'Employee Name', value: data.employeeName, width: w4 },
    { label: 'Global ID', value: data.globalId, width: w4 },
    { label: 'Department', value: data.department, width: w4 },
    { label: 'Process Coach', value: data.processCoach, width: w4 },
  ]);
  y += 6;

  const artW = W * 0.52, dateW = (W - artW) / 2;
  const articleVal = data.article
    ? `Article ${data.article} and all other relevant articles of the agreement`
    : 'and all other relevant articles of the agreement';
  y = boxedGrid(doc, marginX, y, W, 34, [
    { label: 'Article Violation', value: articleVal, width: artW },
    { label: 'Date of Incident', value: fmtDate(data.dateIncident), width: dateW },
    { label: 'Date Filed', value: fmtDate(data.dateFiled), width: dateW },
  ]);
  y += 6;

  y = labelBox(doc, marginX, y + 8, W, 120, 'Details of Incident:', data.details);
  y += 12;

  const hoursColW = W / 2 - 10;
  underlineField(doc, marginX, y, hoursColW, 'Hours at straight time:', data.hoursStraight);
  underlineField(doc, marginX + hoursColW + 20, y, hoursColW, 'Hours of #1 Shift Prem:', data.hoursShift1);
  y += 22;
  underlineField(doc, marginX, y, hoursColW, 'Hours at time & one half:', data.hoursTimeHalf);
  underlineField(doc, marginX + hoursColW + 20, y, hoursColW, 'Hours of #3 Shift Prem:', data.hoursShift3);
  y += 22;
  underlineField(doc, marginX, y, hoursColW, 'Hours at double time:', data.hoursDouble);
  y += 22;

  // ---- Section B: Department Response (reserved, left blank for department) ----
  y = sectionBar(doc, marginX, y, W, 'Section B:', ' Department Response');
  y += 4;

  const approveH = 34;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.75);
  doc.rect(marginX, y, W, approveH);
  doc.line(marginX + W * 0.42, y, marginX + W * 0.58, y + approveH);
  checkboxText(doc, marginX + 16, y + approveH / 2, 'Grievance Approved');
  checkboxText(doc, marginX + W * 0.62, y + approveH / 2, 'Grievance Denied');
  y += approveH + 6;

  y = boxedGrid(doc, marginX, y, W, 40, [
    { label: 'Department Representative (print name)', value: '', width: W / 3 },
    { label: 'Signature', value: '', width: W / 3 },
    { label: 'Department Charge No', value: '', width: W / 3 },
  ]);
  y += 6;
  y = labelBox(doc, marginX, y + 8, W, 26, 'Comments:', '');
  y += 12;

  // ---- Section C: Employee Relations Response (reserved) ----
  y = sectionBar(doc, marginX, y, W, 'Section C:', ' Employee Relations Response');
  y += 4;
  y = boxedGrid(doc, marginX, y, W, 40, [
    { label: 'Employee Relations Representative (print name)', value: '', width: W * 0.34 },
    { label: 'Signature', value: '', width: W * 0.34 },
    { label: 'Grievance Stage', value: '', width: W * 0.16 },
    { label: 'Number', value: '', width: W * 0.16 },
  ]);
  y += 6;
  y = labelBox(doc, marginX, y + 8, W, 26, 'Comments:', '');
  y += 12;

  // ---- Section D: Payroll & Accounting Department (reserved) ----
  y = sectionBar(doc, marginX, y, W, 'Section D:', ' Payroll & Accounting Department');
  y += 4;
  y = boxedGrid(doc, marginX, y, W, 34, [
    { label: 'Rate', value: '', width: w4 },
    { label: 'Hours', value: '', width: w4 },
    { label: 'Amount', value: '', width: w4 },
    { label: 'Pay Period', value: '', width: w4 },
  ]);
  y += 6;
  labelBox(doc, marginX, y + 8, W, 26, 'Comments:', '');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(140, 140, 140);
  doc.text('Generated locally — no data stored or transmitted.', marginX, 780);

  return doc;
}

const fordForm = document.getElementById('fordForm');

fordForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = fd(e.target);
  const doc = buildFordDoc(data);
  const fname = (data.employeeName || 'grievance').trim().replace(/\s+/g, '_');
  download(doc, `Grievance_Claim_${fname || 'form'}.pdf`);
});

document.getElementById('fordClear').addEventListener('click', () => {
  fordForm.reset();
  updateActivePreview();
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
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(0, 0, 0);
  doc.text('Local 200 Grievance Committee', 306, y, { align: 'center' });
  y += 18;
  doc.text('Fact Sheet', 306, y, { align: 'center' });
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text('For Local Union Use Only', 306, y, { align: 'center' });
  y += 12;
  doc.text('This form to accompany First Stage Grievance appealed to Bargaining Committee', 306, y, { align: 'center' });
  y += 26;

  const fh = 20;
  shadedField(doc, marginX, y, 240, fh, "Grievor's Name:", data.grievorName, 82);
  shadedField(doc, marginX + 250, y, 140, fh, 'GID #:', data.gid, 40);
  shadedField(doc, marginX + 400, y, 132, fh, 'Dept:', data.dept, 35);
  y += 30;

  shadedField(doc, marginX, y, 240, fh, 'Seniority Date:', fmtDate(data.seniorityDate), 88);
  shadedField(doc, marginX + 250, y, 140, fh, 'Classification:', data.classification, 78);
  shadedField(doc, marginX + 400, y, 132, fh, 'Rate: $', data.rate, 40);
  y += 30;

  shadedField(doc, marginX + 40, y, 260, fh, 'Time in Classification:', data.timeInClass, 118);
  shadedField(doc, marginX + 320, y, 212, fh, 'COLA: $', data.cola, 45);
  y += 32;

  shadedField(doc, marginX, y, W / 2 - 10, fh, "Employee's Supervisor:", data.supervisor, 110);
  shadedField(doc, marginX + W / 2 + 10, y, W / 2 - 10, fh, 'General Supervisor:', data.generalSupervisor, 105);
  y += 30;

  shadedField(doc, marginX, y, W / 2 - 10, fh, 'Superintendent:', data.superintendent, 80);
  shadedField(doc, marginX + W / 2 + 10, y, W / 2 - 10, fh, 'Date of Incident:', fmtDate(data.uniforDateIncident), 90);
  y += 32;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  doc.text('Discipline on Record?', marginX, y + 14);
  checkboxText(doc, marginX + 130, y + 14, 'Yes');
  checkboxText(doc, marginX + 178, y + 14, 'No');
  if (data.discipline === 'Yes') markCheckbox(doc, marginX + 130, y + 14);
  else markCheckbox(doc, marginX + 178, y + 14);
  shadedField(doc, marginX + W / 2 + 10, y, W / 2 - 10, fh, 'Date Grievance Filed:', fmtDate(data.uniforDateFiled), 120);
  y += 34;

  y = shadedBigBox(doc, marginX, y, W, 50, 'Who is involved in this grievance?', data.whoInvolved);
  y += 10;

  shadedField(doc, marginX, y, W / 2 - 10, fh, 'When did it happen?', data.whenHappened, 110);
  shadedField(doc, marginX + W / 2 + 10, y, W / 2 - 10, fh, 'Where did it happen?', data.whereHappened, 115);
  y += 32;

  y = shadedBigBox(doc, marginX, y, W, 80, 'Why is this a grievance?', data.whyGrievance);
  y += 10;

  shadedBigBox(doc, marginX, y, W, 64, 'What do we want?', data.whatWeWant);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text('Unifor Local 200', marginX, 770);
  doc.text('PRIVATE', 306, 770, { align: 'center' });
  doc.text('pg. 1 / 5', 572, 770, { align: 'right' });

  return doc;
}

const uniforForm = document.getElementById('uniforForm');

uniforForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = fd(e.target);
  const doc = buildUniforDoc(data);
  const fname = (data.grievorName || 'factsheet').trim().replace(/\s+/g, '_');
  download(doc, `Local200_FactSheet_${fname || 'form'}.pdf`);
});

document.getElementById('uniforClear').addEventListener('click', () => {
  uniforForm.reset();
  updateActivePreview();
});

/* ============ Live preview ============ */
const previewFrame = document.getElementById('pdfPreview');
let previewUrl = null;

const FORM_BUILDERS = {
  ford: { form: fordForm, build: buildFordDoc },
  unifor: { form: uniforForm, build: buildUniforDoc },
};

function renderPreview() {
  const activeBtn = document.querySelector('.picker-btn.active');
  const entry = FORM_BUILDERS[activeBtn.dataset.form];
  const doc = entry.build(fd(entry.form));
  const blobUrl = URL.createObjectURL(doc.output('blob'));

  previewFrame.src = blobUrl + '#toolbar=0&navpanes=0';

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = blobUrl;
}

const updateActivePreview = debounce(renderPreview, 350);

fordForm.addEventListener('input', updateActivePreview);
fordForm.addEventListener('change', updateActivePreview);
uniforForm.addEventListener('input', updateActivePreview);
uniforForm.addEventListener('change', updateActivePreview);

renderPreview();
