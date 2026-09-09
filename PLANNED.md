# Planned work

Working notes, not documentation. `README.md` describes what the app already does.

Current build: **v71**, committed, not yet pushed. v70 is what is deployed and what Evan is
testing.

---

## Done today (2026-09-08)

- **v70 — Clear form asks first.** A dialog with a red Clear, a Save first that writes the
  .grv, and Cancel as the default and Escape action. Clear all forms uses it with the count and
  no Save first (one file per form, so one button could not honestly cover several). An empty
  form clears without asking. Save first closes the dialog on its own about 1.5s after saving.
- **v70 — Contents panel.** Every form lists its section bands down the left, the company's
  blank ones included, current one marked; the Fact Sheet's five sheets are headings in it and
  the toolbar sheet menu is gone. Shows at 1160px and up (1420px in large text: below that the
  Print button would slide under the text-size control); never prints.
- **v70 — Yes/No round trip.** No logic change needed: the matcher already strips punctuation
  and case, so "Yes." reads back. Two tests lock it in; "Yes please" is flagged, not guessed.
- **v71 — Office-style chrome, from the Claude Design handoff (3a + 1b).** The form list is a
  navy rail (odd jobs, Larger text, build number) beside one numbered list of forms. A form
  opens under a navy title bar (Forms, document name, Draft saved, Larger text) and a ribbon of
  labelled commands in Word / Document / Other groups with Print as the big button. The floating
  text-size button now shows only on the builder and the DROT audit, which have no chrome. The
  contents rail starts below the chrome, measured from its real height.

Not verified by Claude: Evan asked for no test runs or in-app checks. The full suite has not
been run since v69 (v70's agents reported 188/188 in their own runs). The review pass over v70
was cut short by a usage limit and has not been re-run over v71.

---

## 4. Dropped or parked by decision

- **Monetary form on one page — dropped.** Sections B, C and D (Department
  Response, Employee Relations, Payroll) are the company's boxes and will never
  be filled in the app. The app exists to make the union's life easier; HR and
  payroll do their own thing. Not worth trimming their boxes to save a page.
  Measurements from 2026-09-05 kept below in case it ever comes back.
- **Reading `.docx` files directly — dropped.** Clipboard paste works fine for
  the person who uses it.
- **Share target on Android — parked, low priority.** Saving the `.grv` file
  covers the need for now. If it ever gets picked up: reinstall the PWA on the
  tablet after any manifest change, share targets register at install time.
- **DROT letters — resolved.** The Essex `34002I` / `34002O` pair was checked
  during DROT audits and is correct.

### Monetary form measurements (for the record)

| | height | ends at |
|---|---|---|
| Header + title | 26pt | 80 |
| Section A (the rep's fields) | 316pt | 396 |
| Section B — Department Response | 219pt | 615 |
| Section C — Employee Relations | 197pt | 812 |
| Section D — Payroll & Accounting | 189pt | 1001 |

`PAGE_BOTTOM` is 760, so it runs 241pt over. Trims to B, C and D without
dropping a box reach 131pt; it only fits by dropping Section D's Comments box
(130pt), and a long "Details of Incident" pushes to page 2 regardless.

---

## 5. Testing

Evan owns the test suite for now; it has to match what his coworkers actually
need. Direct in-app verification of new work is fine. Notes for whoever runs
it:

- ~175 checks, around 50 seconds, because several render real PDFs. If that
  becomes a nuisance, add a `?only=` filter to `tests.html` rather than
  deleting coverage.
- Last complete run was 173/174 at v67. The one failure was an expectation of
  "1 of 42" where "2 of 42" is correct (`Submitted By` arrives pre-filled and
  legitimately round-trips). Fixed since, no confirmed clean run yet.

---

## 6. Standing rules

- **Bump `?v=` in `index.html` and `VERSION` in `sw.js` together.** A mismatch
  serves a stale build from cache and looks exactly like a change not working.
- **Flags never print.** They are DOM only; the PDF is drawn by jsPDF from
  field values and never reads the page. `@media print` hides them, and a check
  fails if that rule goes missing.
- The build number in the bottom right of the form list is read off the `?v=`
  on `script.js`, so it cannot disagree with what the browser actually loaded.
