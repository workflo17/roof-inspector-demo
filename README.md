# Roof inspector demo

A phone-first demo of a roof inspection app, built for Kenneth Edwards's Craigslist post "I need an app built for roof inspections" (Rough and Ready, CA). He is starting a roof inspection company and wants something like the app he used before. This demo shows what a first version could do, on made-up data.

Status 2026-10-11: built and tested locally. Not published. Kenneth has not seen it. He asked Don to follow up at the end of the week of 2026-10-12 (Friday 2026-10-16) after he writes up his own walkthrough of an inspection.

## What it does

- **Roof plan.** A top-down roof with four slopes, a chimney, vents and gutters. Tap one to inspect it. Each area is tinted and labeled with a word (Good, Watch, Fix, Not yet), never colour alone.
- **Checklists that fit the roof.** Asphalt shingle and metal panel templates. Three-way rating per item, plus "everything else is fine" to clear the rest of an area in one tap.
- **Findings with photos.** Take a photo (the phone camera, or a file on a laptop), circle the damage with a finger, add notes. A "Sample photo" button makes a drawn photo so the demo works on a computer.
- **Hail test square.** A counter per slope for hits inside a 10 ft by 10 ft square. It records the count and never decides an outcome, because carrier thresholds vary.
- **Report.** Property and roof details, overall condition, summary by area, recommended actions in two groups (repair or replace, monitor), every photo with a caption, a limits note and a signature line. "Print or save as PDF" uses the browser's print.
- **Works with no signal.** After the first load the app caches itself, and inspections and photos are stored on the phone (IndexedDB).

Sync is simulated: there is no server, so the Synced badge only shows how it would behave.

## What research said it needs

See [RESEARCH.md](RESEARCH.md): offline first, organized by slope, photos tied to items with markup, a simple rating scale, a handoff-ready report. It also lists what the real build would add and the questions to ask Kenneth.

## Run it

Plain HTML, CSS and JavaScript, no build step and no dependencies. Any static server works:

```
python -m http.server 5290
```

Open http://localhost:5290. Service workers and install need https or localhost, so a phone on the same Wi-Fi cannot install it from a plain http address. Publish it (GitHub Pages) to try it on a phone.

## Check it

```
node tools/e2e.mjs http://127.0.0.1:5290/
```

Needs Node 22 or newer and Chrome (path is set at the top of `tools/cdp.mjs`). It starts a throwaway headless Chrome and runs 41 checks: service worker and cache, an offline reload with the HTTP cache switched off, the full flow (rate, add finding, photo, markup, report), no sideways scroll at 390px in light and dark across six screens, report to PDF, and no console errors. Screenshots go to `qa/`.

- `tools/probe.mjs "<route>" "<js expression>"` runs one expression in the app at phone size. Under Git Bash set `MSYS_NO_PATHCONV=1`, or a route like `#/i/@` is rewritten into a drive path.
- `tools/sw-check.html` is an older single-purpose service worker check, kept for reference.
- `tools/pdf_info.py qa/report.pdf` prints page count, images and text per page.

## Before publishing a change

`sw.js` is cache-first. Bump `CACHE` in `sw.js` whenever any cached file changes, or phones that already opened the demo keep the old version.

## Layout

| Path | What |
| --- | --- |
| `index.html`, `app.css`, `app.js` | The app |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline cache and install |
| `RESEARCH.md` | What the app needs, with sources |
| `tools/`, `qa/` | Checks and their screenshots |
