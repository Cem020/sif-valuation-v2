# Shell Impact Fund — CLA Fair Value Workbench · v5

Interactive probability-weighted expected present value model for the SIF CLA portfolio, refreshed for Q1 2026 data.

Translated from `SIF_CLA_Fair_Value_Model_v5.xlsx`. Reconciles to the Excel `Valuation Engine` to the cent.

---

## Updating the live Vercel site

Since this project is already connected to your GitHub repo and Vercel, you have two options to push this v5 update:

### Option A — Drag-and-drop replace on GitHub (easiest, no terminal)

1. Go to your GitHub repo
2. Replace the existing `src/App.jsx` with the v5 version:
   - Click on `src/App.jsx` → trash icon → commit deletion
   - Then click **Add file → Upload files** → drag the new `App.jsx` into the `src/` folder
3. Also replace `index.html` at the root (it now loads the Cormorant Garamond serif font)
4. Vercel auto-rebuilds and your live URL updates within ~60 seconds

### Option B — Replace all files at once

Easier if you're comfortable: just upload the full unzipped folder contents over the top of the existing files on GitHub. Existing files are overwritten.

---

## What changed vs v3

- **5 companies refreshed:** Homii (kept), **Fynch** (replaces Fotoniq), Newton (kept), **Rator** (replaces Effium), **Prets** (replaces Klimashift)
- **Portfolio FV dropped:** €741k → €439k base case, reflecting harsher Q1 2026 reporting
- **New transfer-adjusted view:** €307k after 30% illiquidity discount — the recommended single-point handover number
- **Redesigned dashboard:** editorial finance aesthetic, Cormorant Garamond serif display, parchment palette, dark masthead with headline number, takeaway cards

---

## Local development

```bash
npm install
npm run dev          # local at http://localhost:5173
```

---

## Project layout

```
sif-dashboard/
├── index.html              # loads Cormorant Garamond + Source Sans
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── src/
    ├── main.jsx
    ├── index.css
    └── App.jsx             # dashboard (engine + components + design)
```

---

## Reconciliation

| Company | Dashboard FV | Excel FV |
|---|---:|---:|
| Homii | €203,766 | €203,766 |
| Fynch | €69,841 | €69,841 |
| Newton | €44,168 | €44,168 |
| Rator | €68,345 | €68,345 |
| Prets | €52,951 | €52,951 |
| **Base** | **€439,071** | **€439,071** |
| **Transfer-adjusted** | **€307,350** | **€307,350** |
