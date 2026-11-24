# AI Red Team Application

Application flow for July AI's AI Red Teaming contributor role, styled to match
[gojuly.ai](https://www.gojuly.ai/).

- **`index.html`**: a plain job post laid out like an Ashby listing: title,
  details sidebar, and **Overview / Application** tabs. The Application tab
  (`index.html#application`) holds the form, one question per step, with the same
  7 questions as the [original Typeform](https://form.typeform.com/to/sxEbJwG6).
- **`apply.html`**: redirects old links to `index.html#application`.
- **`apps-script/Code.gs`**: the backend. A Google Apps Script web app that
  saves each resume to a Drive folder and adds a row to a Google Sheet.

Plain HTML, CSS and JS. No build step.

## Run locally

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Until `config.js` has a submission URL, the form runs in **preview mode**: it
shows a yellow notice, logs the answers to the browser console, and saves
nothing.

## Connect submissions (about 5 minutes)

1. Create a Google Sheet for applications and a Drive folder for resumes.
2. Go to [script.google.com](https://script.google.com), create a new project
   and paste in `apps-script/Code.gs`.
3. At the top of the script, set `SHEET_ID` (from the sheet URL, between `/d/` and
   `/edit`) and `RESUME_FOLDER_ID` (the last part of the folder URL).
4. Click **Deploy → New deployment**, choose type **Web app**, set
   **Execute as: Me** and **Who has access: Anyone**, then click **Deploy** and
   approve the permissions.
5. Copy the web app URL (it ends in `/exec`) into `submitEndpoint` in
   `config.js`.

After changing `Code.gs`, use **Deploy → Manage deployments → Edit → New
version**, so the URL stays the same.

Opening the `/exec` URL in a browser should return
`{"ok":true,"service":"july-red-team-application"}`.

## Notes

- The form saves progress in the applicant's browser, but not the resume
  file, so a returning applicant picks up no later than the resume step.
- Resumes are limited to PDF, DOC or DOCX, up to 10 MB. The limit is checked
  in the browser and again in the script.
- A hidden honeypot field drops simple bots.
- Styles are copied from `julyai7/julyai7.github.io`
  (`web/tailwind.config.js`, `web/src/index.css`). `media/marble.jpg` and
  `favicon.svg` come from that repo too.
