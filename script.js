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
  });
});

/* ============ Helpers ============ */
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

/* Draw a labelled field box. Returns nothing, just draws. */
function fieldBox(doc, x, y, w, h, label, value) {
  doc.setDrawColor(160, 155, 140);
  doc.setLineWidth(0.6);
  doc.rect(x, y, w, h);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(90, 95, 82);
  doc.text(label.toUpperCase(), x + 4, y + 9);
  doc.setFontSize(10);
  doc.setTextColor(30, 32, 28);
  doc.setFont('helvetica', 'normal');
  const val = value || '';
  const lines = doc.splitTextToSize(val, w - 8);
  doc.text(lines.slice(0, Math.max(1, Math.floor((h - 12) / 11))), x + 4, y + 20);
}

/* Draw a large text box with wrapped paragraph content */
function textBox(doc, x, y, w, h, label, value) {
  doc.setDrawColor(160, 155, 140);
  doc.setLineWidth(0.6);
  doc.rect(x, y, w, h);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(90, 95, 82);
  doc.text(label.toUpperCase(), x + 4, y + 9);
  doc.setFontSize(10);
  doc.setTextColor(30, 32, 28);
  const lines = doc.splitTextToSize(value || '', w - 8);
  const maxLines = Math.floor((h - 16) / 12);
  doc.text(lines.slice(0, maxLines), x + 4, y + 22);
}

function sectionLabel(doc, x, y, text) {
  doc.setFillColor(227, 231, 219);
  doc.rect(x, y, 532, 16, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(71, 84, 62);
  doc.text(text.toUpperCase(), x + 6, y + 11);
}

/* ============ FORD FORM ============ */
document.getElementById('fordForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = fd(e.target);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const marginX = 40;
  let y = 40;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(30, 32, 28);
  doc.text('Grievance Investigation & Claim Form', 306, y, { align: 'center' });
  y += 22;

  sectionLabel(doc, marginX, y, 'Section A — Employee Details & Grievance Summary');
  y += 24;

  const w4 = (532 - 3 * 6) / 4;
  fieldBox(doc, marginX, y, w4, 34, 'Employee Name', data.employeeName);
  fieldBox(doc, marginX + (w4 + 6) * 1, y, w4, 34, 'Global ID', data.globalId);
  fieldBox(doc, marginX + (w4 + 6) * 2, y, w4, 34, 'Department', data.department);
  fieldBox(doc, marginX + (w4 + 6) * 3, y, w4, 34, 'Process Coach', data.processCoach);
  y += 42;

  const artW = 280, dateW = (532 - 280 - 12) / 2;
  const articleVal = data.article ? `Article ${data.article} and all other relevant articles of the agreement` : '';
  fieldBox(doc, marginX, y, artW, 34, 'Article Violation', articleVal);
  fieldBox(doc, marginX + artW + 6, y, dateW, 34, 'Date of Incident', fmtDate(data.dateIncident));
  fieldBox(doc, marginX + artW + 6 + dateW + 6, y, dateW, 34, 'Date Filed', fmtDate(data.dateFiled));
  y += 42;

  textBox(doc, marginX, y, 532, 150, 'Details of Incident', data.details);
  y += 158;

  const hw = (532 - 4 * 6) / 5;
  fieldBox(doc, marginX + (hw + 6) * 0, y, hw, 34, 'Straight time', data.hoursStraight);
  fieldBox(doc, marginX + (hw + 6) * 1, y, hw, 34, 'Time & 1/2', data.hoursTimeHalf);
  fieldBox(doc, marginX + (hw + 6) * 2, y, hw, 34, 'Double time', data.hoursDouble);
  fieldBox(doc, marginX + (hw + 6) * 3, y, hw, 34, '#1 Shift Prem', data.hoursShift1);
  fieldBox(doc, marginX + (hw + 6) * 4, y, hw, 34, '#3 Shift Prem', data.hoursShift3);
  y += 50;

  // Reserved sections (blank, for others to complete by hand)
  sectionLabel(doc, marginX, y, 'Section B — Department Response');
  y += 24;
  doc.setDrawColor(200, 197, 185);
  doc.rect(marginX, y, 532, 60);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120, 124, 112);
  doc.text('Grievance Approved  ☐          Grievance Denied  ☐', marginX + 8, y + 16);
  doc.text('Department Representative (print name): _______________________   Signature: _______________________   Charge No: _____________', marginX + 8, y + 34);
  doc.text('Comments:', marginX + 8, y + 50);
  y += 70;

  sectionLabel(doc, marginX, y, 'Section C — Employee Relations Response');
  y += 24;
  doc.rect(marginX, y, 532, 50);
  doc.text('ER Representative (print name): _______________________   Signature: _______________________   Stage: _______   No: _______', marginX + 8, y + 18);
  doc.text('Comments:', marginX + 8, y + 36);
  y += 60;

  sectionLabel(doc, marginX, y, 'Section D — Payroll & Accounting');
  y += 24;
  doc.rect(marginX, y, 532, 50);
  doc.text('Rate: ___________   Hours: ___________   Amount: ___________   Pay Period: ___________', marginX + 8, y + 18);
  doc.text('Comments:', marginX + 8, y + 36);

  doc.setFontSize(7.5);
  doc.setTextColor(150, 146, 132);
  doc.text('Generated locally — no data stored or transmitted.', marginX, 780);

  const fname = (data.employeeName || 'grievance').trim().replace(/\s+/g, '_');
  download(doc, `Grievance_Claim_${fname || 'form'}.pdf`);
});

document.getElementById('fordClear').addEventListener('click', () => {
  document.getElementById('fordForm').reset();
});

/* ============ UNIFOR FORM ============ */
document.getElementById('uniforForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = fd(e.target);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const marginX = 40;
  let y = 44;

  doc.setDrawColor(160, 155, 140);
  doc.rect(marginX, y, 90, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(60, 63, 56);
  doc.text(`SP-${data.spNumber || ''}`, marginX + 6, y + 12);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(166, 58, 46);
  doc.text('UNIFOR — the Union | le syndicat', 532 - 40 + marginX, y + 12, { align: 'right' });

  y += 34;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(30, 32, 28);
  doc.text('Local 200 Grievance Committee Fact Sheet', 306, y, { align: 'center' });
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110, 113, 100);
  doc.text('For Local Union Use Only — accompanies First Stage Grievance appealed to Bargaining Committee', 306, y, { align: 'center' });
  y += 22;

  const w3 = (532 - 2 * 6) / 3;
  fieldBox(doc, marginX, y, w3, 34, "Grievor's Name", data.grievorName);
  fieldBox(doc, marginX + (w3 + 6), y, w3, 34, 'GID #', data.gid);
  fieldBox(doc, marginX + (w3 + 6) * 2, y, w3, 34, 'Dept', data.dept);
  y += 42;

  fieldBox(doc, marginX, y, w3, 34, 'Seniority Date', fmtDate(data.seniorityDate));
  fieldBox(doc, marginX + (w3 + 6), y, w3, 34, 'Classification', data.classification);
  fieldBox(doc, marginX + (w3 + 6) * 2, y, w3, 34, 'Rate $', data.rate);
  y += 42;

  fieldBox(doc, marginX, y, w3, 34, 'Time in Classification', data.timeInClass);
  fieldBox(doc, marginX + (w3 + 6), y, w3, 34, 'COLA $', data.cola);
  fieldBox(doc, marginX + (w3 + 6) * 2, y, w3, 34, "Employee's Supervisor", data.supervisor);
  y += 42;

  fieldBox(doc, marginX, y, w3, 34, 'General Supervisor', data.generalSupervisor);
  fieldBox(doc, marginX + (w3 + 6), y, w3, 34, 'Superintendent', data.superintendent);
  fieldBox(doc, marginX + (w3 + 6) * 2, y, w3, 34, 'Date of Incident', fmtDate(data.uniforDateIncident));
  y += 42;

  fieldBox(doc, marginX, y, w3, 34, 'Date Grievance Filed', fmtDate(data.uniforDateFiled));
  fieldBox(doc, marginX + (w3 + 6), y, w3, 34, 'Discipline on Record?', data.discipline || 'No');
  y += 42;

  textBox(doc, marginX, y, 532, 60, 'Who is involved in this grievance?', data.whoInvolved);
  y += 68;

  const w2 = (532 - 6) / 2;
  fieldBox(doc, marginX, y, w2, 34, 'When did it happen?', data.whenHappened);
  fieldBox(doc, marginX + w2 + 6, y, w2, 34, 'Where did it happen?', data.whereHappened);
  y += 42;

  textBox(doc, marginX, y, 532, 90, 'Why is this a grievance?', data.whyGrievance);
  y += 98;

  textBox(doc, marginX, y, 532, 72, 'What do we want?', data.whatWeWant);
  y += 90;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(150, 146, 132);
  doc.text('Unifor Local 200', marginX, 770);
  doc.text('PRIVATE', 306, 770, { align: 'center' });
  doc.text('pg. 1 / 5', 572, 770, { align: 'right' });

  const fname = (data.grievorName || 'factsheet').trim().replace(/\s+/g, '_');
  download(doc, `Local200_FactSheet_${fname || 'form'}.pdf`);
});

document.getElementById('uniforClear').addEventListener('click', () => {
  document.getElementById('uniforForm').reset();
});
