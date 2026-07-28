# Grievance Forms

**Live: https://evanking17.github.io/local200forms/**

A static, no-backend tool for filling out and generating PDFs for three forms:

- Grievance Investigation & Claim Form
- Policy Grievance Form
- Local 200 Grievance Committee Fact Sheet

Everything runs in the browser via jsPDF (loaded from a CDN) — no server, no
database, nothing saved or sent anywhere. Pick a form from the homepage, fill
it in, and download the PDF. You can also upload a PDF this app previously
generated to pick up where you left off — it recognizes its own files via
metadata embedded in the PDF, invisible in the document itself.

## Editing

- `index.html` / `style.css` / `script.js` — the app. One PDF-builder function
  per form in `script.js` (`buildFordDoc`, `buildPolicyDoc`, `buildUniforDoc`)
  backs both "Generate PDF" and the live preview, so there's only one place
  to change a form's layout.
- `forms.config.js` — form titles and homepage labels. Edit through
  `admin.html` (a local-only page, not linked from the app) or by hand, then
  commit.

No build step — just edit and push. GitHub Pages redeploys automatically.
