# Planned work

Working notes, not documentation. `README.md` describes what the app already does.

Current build: **v69**, pushed and deployed.

Decisions below were taken with Evan on 2026-09-08. Everything in sections 1
and 2 is to be finished and polished today. Order: the confirmation modal and
the table of contents first, the rest in any order.

---

## 1. Clear form needs a confirmation modal — first

The per-form Clear buttons (`fordClear`, `policyClear`, `uniforClear`,
`investigationClear`, and the generic path in `FORM_BUILDERS`) wipe the whole
form on one click with no prompt. Only "Clear all forms" on the home screen
asks, and that is a native `confirm()`.

Replace both with an in-app modal that makes the destructive nature obvious:

- Title and body state plainly that everything typed in this form will be
  erased and the saved draft discarded.
- Three buttons: a red **Clear form** (destructive), a **Save first** in a
  safe colour that runs the existing `.grv` save for that form and then
  closes the modal without clearing, and a neutral **Cancel**.
- Cancel is the default / Escape action. Clear must not be the focused button
  when the modal opens.
- "Clear all forms" uses the same modal with the count in the wording.
- Skip the modal entirely when the form is empty (`formHasContent` is false).
- DOM only, never prints — same `@media print` rule as the flags.

---

## 2. Table of contents for forms

A navigation panel down the left margin, like Acrobat's bookmarks.

Decided:

- **Every form** gets it, including short ones.
- **Open by default.**
- Lists every section band (`.dc-band`) in the open form as a jump target,
  **including bands with no editable field** (Department Response, Employee
  Relations, Payroll), so a rep can jump to the parts HR fills in.
- Entries show the band title only. No filled / unfilled indicator.
- Sticks in the left margin while the sheet scrolls.
- Highlights the section you're currently in.
- Hides below roughly 1100px of window width — there's no margin to put it in.
- Must not print. Add it to the `@media print` block.

Also decided:

- **The Fact Sheet's sheet nav folds into the panel.** The toolbar's five-page
  indicator and jump menu (`buildSheetNav`) goes away; the panel shows each
  page as a heading with its section bands indented beneath. One list instead
  of two controls navigating different things.

Implementation note:

- `syncCurrentSheet` already works out "which thing have we scrolled past" by
  measuring positions against the sticky toolbar. Reuse that approach rather
  than an IntersectionObserver, for the reason in that function's comment: it
  can be checked at any scroll position instead of waiting on a callback.

---

## 3. Small fixes, any order

- **Word round trip, Yes/No fields.** Radio questions export as
  `HEADING  (Yes / No)` and read back whichever word survives. Dictating into
  Word may produce "Yes." with a full stop, which would not match. Strip
  trailing punctuation when matching choices and do it now. Decided: try to
  parse it; if no choice matches, leave the radio unset so the field shows as
  not filled rather than guessing. Worst case the rep sees a flag and picks it.

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
