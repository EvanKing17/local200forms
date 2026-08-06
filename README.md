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

Four ways in, all landing on the same confirmation step:

- **Paste it.** On the Forms page, Ctrl+V with the JSON on the clipboard. There
  is no button for this and no sign it exists — see below.

- **Drop it on the page**, or pick it with the upload link.
- **Share it to the app.** Once Union Forms is installed, it appears in
  Android's share sheet. Share either the file or the JSON as text — both work.
- **Open a link.** The other app can build one and the app fills itself in;
  see below.
- **Open a `.grv`.** On a desktop with the app installed, double-clicking a
  `.grv` opens it in Union Forms.

`.grv` is the same JSON under a private extension. It is deliberately *not*
`.json` — registering that would make this app the default for every JSON file
on the machine.

### A grievance in a link

The other app can hand one over as a plain link, with the JSON base64'd into
the fragment:

```
https://evanking17.github.io/local200forms/#grv=<base64 of the JSON>
```

On Android an installed copy claims links inside its own scope, so this opens
the app itself. Without it installed the same link opens the site and still
works. Either way it lands on the usual confirmation step.

**The `#` matters.** A fragment is never sent in the HTTP request, so the
grievance never reaches GitHub's servers. The same payload in a `?query` would
land in their request logs. Nothing about this app should put a member's
grievance on someone else's disk.

Plain percent-encoded JSON works too if base64 is inconvenient, and base64url
with the padding trimmed is accepted. Building one, in whatever language:

```js
const url = 'https://evanking17.github.io/local200forms/#grv=' +
            btoa(unescape(encodeURIComponent(JSON.stringify(grievance))));
```

### The paste shortcut

Copy a grievance as JSON in the other app, then press **Ctrl+V** on the Forms
page. It reads the clipboard and offers to fill the form, same as a dropped
file.

There is deliberately no button. This is one rep's shortcut, and a control on
screen is a thing every other rep has to wonder about. So it stays quiet unless
the clipboard genuinely holds a grievance: a stray Ctrl+V with a phone number
or half an email on it does nothing at all — no error, no flicker, no hint the
feature is there. It only speaks up when the text really is JSON but can't be
used, because by then someone is deliberately pasting and silence would be
worse than an explanation.

It is a shortcut, not a secret. Anyone reading the source will find it; it is
hidden to keep the page uncluttered, not to keep anyone out. Nothing behind it
is privileged — it fills in a form, which anyone can do by typing.

Keyboard only, so it needs a keyboard — but that includes a tablet with one
attached, which is where it gets used. On a tablet with no keyboard, share the
file to the app or open a `.grv` instead.

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

## Building a PDF out of images

**New PDF from images** on the Forms page, for sending a batch of screenshots as
one document instead of a dozen attachments.

Press <kbd>Ctrl</kbd>+<kbd>V</kbd> to paste a screenshot straight in, drop files
anywhere on the page, or pick them. Images and PDFs both go in; a PDF
contributes its own pages unchanged, still vector and still searchable. Pages
come out in the order shown, and each one can be moved or removed.

**Mark up** assembles everything into one document and opens it in the same
editor a PDF from the Forms page gets: all the pages, scrolling, marked up as
one thing rather than picture by picture.

Done brings you back here with the mark-up kept, so remembering a missing
screenshot doesn't cost the work — add it and mark up again. The marked pages
become a single document in the list at that point, so put them in the order
you want before marking up. Back leaves without keeping anything.

Dropping images on the Forms page opens this directly — they have nowhere to go
on a form, and this is what they're for.

### Page layout

The same control appears in the builder and under a form's supporting
documents, with the same three choices and the same words. It only shows up
once a picture has been added, since a stack of PDFs keeps its own pages
whatever is chosen.

- **Match each picture (any size)** — no paper size at all: each page comes out
  exactly as big as the picture on it. A full-screen grab makes a page the size
  of your screen. Best for reading on a screen, and the builder's default.
- **Letter paper, one per page** — normal paper, one picture centred on it,
  turned sideways when the picture is wider than it is tall. A form's default,
  since a grievance gets printed and handed over.
- **Letter paper, two per page** — two pictures stacked on one sheet, for the
  ones that go together. A PDF between two pictures breaks the pair rather than
  reaching past it, and an odd one out takes the top half rather than being
  stretched.

The page numbers on each card follow the choice, so on two-per-page the first
two both read Page 1, top and bottom.

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
