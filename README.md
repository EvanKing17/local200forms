# Union Forms

**https://evanking17.github.io/local200forms/**

Fill in Unifor Local 200 grievance forms on screen and get a print-ready PDF.

| Form | |
|---|---|
| Grievance Investigation & Claim | monetary grievance |
| Policy Grievance | policy only, no monetary section |
| Plant Committee Fact Sheet | five pages, first stage appeal |
| 4.01 Investigation | supervisor / salaried investigation |

## How it works

You fill in each form as the document it will print as — same layout, same
proportions, same page breaks. There is no separate preview to compare against,
because the page on screen *is* the page that comes out.

- **Nothing is sent anywhere.** No server, no database, no account. PDFs are
  built in the browser and drafts are saved on your own device.
- **Works offline.** Install it (below) and it runs with no signal at all.
- **Drafts save as you type**, so a closed tab or a dead battery costs nothing.
  "Clear form" is how you throw one away.
- **Attach supporting documents.** Add PDFs or photos to a form and they're
  appended after it, so the grievance and its evidence go in as one file.
- **Mark them up** — draw, highlight, arrows, boxes and ovals, and blur. Each
  tool keeps its own colour and thickness; the highlighter has its own palette.
- **Re-open a finished PDF.** Drop one anywhere on the page, or use the link
  under the form list. A PDF this app made fills the form back in — it
  recognises its own files from data embedded invisibly in them. Anything else
  opens in the mark-up editor and can be saved back out.
- **Enter moves to the next field**, and Shift+Enter back — these were spreadsheets
  before they were this, and the muscle memory is real. In the big narrative
  boxes Enter makes a new paragraph, and Ctrl+Enter moves on.
- **Ctrl+P prints the form itself**, without the toolbar or the app around it.
- **Larger text** scales the whole sheet for reading, and is remembered. The PDF
  is unaffected.
- The Fact Sheet's five sheets have a **sheet indicator and jump menu**, and a
  form with work waiting in it is **marked on the list**.

## Filling a form from another application

Drop a `.json` file on the page, or pick it with the same upload link as a PDF.
It shows what it found and fills the form only once you say so.

```json
{
  "form": "monetary",
  "fields": {
    "employeeName": "Evan King",
    "globalId": "002173535",
    "department": "8383 - Heads",
    "processCoach": "Wes Macauley",
    "article": "Article 14.02",
    "dateIncident": "2026-07-22",
    "dateFiled": "2026-07-29",
    "details": "What happened.",
    "hoursStraight": "8",
    "hoursTimeHalf": "0",
    "hoursDouble": "4",
    "hoursTriple": "0",
    "hoursShift1": "0",
    "hoursShift3": "0"
  }
}
```

`form` is `"monetary"` (the Grievance Investigation & Claim) or `"policy"` (the
Policy Grievance, which has no hours). The hours are only read for a monetary
grievance.

It is deliberately forgiving, so the sending app doesn't have to match these
names exactly:

- Fields can sit under `fields`, `data`, `values`, or straight at the top level.
- `form`, `type`, `formType` and `grievanceType` all name the kind.
- Names are matched ignoring case, spaces and punctuation, and common
  alternatives are accepted — `name`/`grievor` for the employee, `gid`/`badge`
  for the global ID, `dept`, `supervisor`, `violation`, `incidentDate`,
  `description`, and so on.
- Dates are read as `YYYY-MM-DD`, `YYYY/MM/DD`, `MM/DD/YYYY` or an ISO
  timestamp.

Anything it can't place is listed on screen rather than dropped quietly.

### Getting the file here

Three ways in, all landing on the same confirmation step:

- **Drop it on the page**, or pick it with the upload link.
- **Share it to the app.** Once Union Forms is installed, it appears in
  Android's share sheet. Sharing a grievance file from another app opens it
  here directly. This is the easiest route on a tablet.
- **Open a `.grv`.** On a desktop with the app installed, double-clicking a
  `.grv` opens it in Union Forms.

`.grv` is the same JSON under a private extension. It is deliberately *not*
`.json` — registering that would make this app the default for every JSON file
on the machine.

## Handing a form to another device

**Save .grv** on any of the four forms writes out what is typed in it. Open
that file on another device — share it, drop it on the page, or double-click it
— and the form comes back filled in. All four forms round-trip, including the
Fact Sheet's radio answers.

It carries values only. Attached documents are not part of it.

## Install it

On a phone: open the link, then **Add to Home screen** (Chrome: ⋮ menu,
Safari: Share). On a desktop: the install icon in the address bar.

It becomes an app with its own icon and no browser chrome, and works in
airplane mode. Open it once on a connection first, so it can cache itself.

## Renaming forms

Type `rename` on the Forms page. Paste a GitHub fine-grained token with
**Contents: Read and write** on this repository, edit the names, and publish —
it commits `forms.config.js` and the site rebuilds in about a minute, so
everyone sees the change.

There is no password, on purpose: a static page has nowhere to check one, so any
password would sit in the source where anyone could read it. The token is the
real credential, it is never stored, and GitHub is what verifies it.

`admin.html` does the same job offline, producing the file for you to commit by
hand. It is the fallback if the token route ever gives trouble.

## Editing

No build step — edit and push, GitHub Pages redeploys.

| File | |
|---|---|
| `index.html` | the four forms, as markup |
| `script.js` | one `build*Doc()` per form, plus everything else |
| `style.css` | the design system, including the print rules |
| `forms.config.js` | form names (see Renaming above) |
| `annotate.js` | attachments: rasterising, mark-up, flattening |
| `sw.js` | offline caching |
| `tests.html` | checks — serve the folder and open it |

The screen and the PDF are kept in agreement deliberately: the document view is
laid out at the PDF's own scale, where **1pt = 1.3333px**. The named constants
in `script.js` (`CELL_X`, `CELL_TOP`, `CELL_LINE`, …) have matching CSS
variables. Change one and you must change both.

**When `style.css` or `script.js` changes, bump `?v=` in `index.html` and
`VERSION` in `sw.js` together.** Both GitHub Pages and the service worker cache
those files, so a stale number keeps serving the previous build.

**Attached pages are never redrawn.** pdf.js renders each one to a canvas so
there is something to look at and draw on, but the output is assembled by
pdf-lib from the untouched originals with the marks added as vector shapes on
top — so attached PDFs stay sharp at any zoom and stay searchable.

The consequence to know: **a filled box covers text, it does not remove it.**
The words are still in the file underneath and can be copied out. Treat it as
hiding, not deleting. Blur is the same. Anything that genuinely must not be
recoverable has to be removed before the file is attached.

Both libraries load only when a document is actually attached, and both are
precached, so this works offline.

Run `tests.html` before pushing. It drives the real app and checks that every
form still builds at the right page count, with its data surviving a round-trip
through the PDF. It has to be served over http, not opened from disk:

```bash
python -m http.server 8765
```
