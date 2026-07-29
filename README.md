# Grievance Forms

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
- **Re-open a finished PDF.** Upload a PDF this app made and it fills the form
  back in — it recognises its own files from data embedded invisibly in them.
  A scan, or a form from anywhere else, is rejected.
- **Ctrl+P prints the form itself**, without the toolbar or the app around it.

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
| `sw.js` | offline caching |
| `tests.html` | checks — serve the folder and open it |

The screen and the PDF are kept in agreement deliberately: the document view is
laid out at the PDF's own scale, where **1pt = 1.3333px**. The named constants
in `script.js` (`CELL_X`, `CELL_TOP`, `CELL_LINE`, …) have matching CSS
variables. Change one and you must change both.

**When `style.css` or `script.js` changes, bump `?v=` in `index.html` and
`VERSION` in `sw.js` together.** Both GitHub Pages and the service worker cache
those files, so a stale number keeps serving the previous build.

Run `tests.html` before pushing. It drives the real app and checks that every
form still builds at the right page count, with its data surviving a round-trip
through the PDF. It has to be served over http, not opened from disk:

```bash
python -m http.server 8765
```
