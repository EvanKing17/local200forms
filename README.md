# Grievance Forms

A static, no-backend form-to-PDF tool for two forms:

1. **Grievance Investigation & Claim Form** (Section A intake)
2. **Local 200 Grievance Committee Fact Sheet**

Everything runs in the browser. There is no server, no database, and no
`localStorage`/`sessionStorage` — the moment you close or reload the tab,
the data is gone. Clicking "Generate PDF" builds the PDF client-side (via
jsPDF, loaded from a CDN) and triggers a normal browser download. Nothing
is ever sent anywhere.

## Hosting on GitHub Pages (free)

1. Create a new **public** GitHub repo, e.g. `grievance-forms`.
2. Upload these three files to the repo root: `index.html`, `style.css`, `script.js`.
   (Easiest: drag-and-drop them on the "Add file → Upload files" page in
   the GitHub web UI — no git command line needed.)
3. Go to **Settings → Pages**.
4. Under "Build and deployment", set **Source** to `Deploy from a branch`,
   branch `main`, folder `/ (root)`. Save.
5. Wait ~1 minute, then your app is live at:
   `https://<your-username>.github.io/grievance-forms/`

That URL is a standard `github.io` domain — it's a high-reputation,
widely-whitelisted domain, so category-based corporate web filters almost
never block it. (A strict allow-list environment is the one exception no
free host can get around.)

## Updating the forms later

Both forms are plain HTML `<input>`/`<textarea>` fields in `index.html`,
and the matching PDF layout logic lives in `script.js` (one function per
form: `fordForm` submit handler, `uniforForm` submit handler). To add a
field:

1. Add the input to the relevant `<form>` in `index.html` with a `name="..."`.
2. Add a matching `fieldBox(...)` or `textBox(...)` call in the corresponding
   PDF-generation function in `script.js`, referencing `data.<name>`.

No build step, no dependencies to install — just edit and re-upload (or
`git push` if you set it up with git).
