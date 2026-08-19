# Integration Tracker of Potential Lakhpati Didis on LokOS · FY 2026–29

A live, browser-only dashboard for TRLM's new-PLD identification and Lakhpati Didi
retention drive. It reads directly from your Google Sheet every time it's opened —
edit the sheet, refresh the page (or wait ~5 minutes for auto-refresh), and the
dashboard updates. No backend, no build step, no API keys.

**What's inside**
- State + district + block level KPIs, recomputed live from your columns
- A filterable District/Block picker that drives every chart, the map and the table
- A Tripura district map (real Census boundaries) coloured by progress, click-through to block detail
- District-wise and cohort-wise charts
- A sortable, searchable, CSV-exportable block register
- A daily-progress chart with pace and projected-completion vs the 10 Sep 2026 target
- A countdown to the identification deadline
- TRLM-logo colour theme and a light illustrated background (see note on the "AI photos" ask, below)

---

## 1. Before you deploy — share the sheet

The dashboard fetches your sheet client-side, so it needs to be publicly *viewable*
(this does **not** let anyone edit it):

`File > Share > General access > Anyone with the link > Viewer`

## 2. Point the dashboard at your sheet

Open `js/app.js` and edit the `CONFIG` block at the top:

```js
const CONFIG = {
  SHEET_ID: '1jUiOjFXAQmcKG0dn3R_AhyNDm7yVSJ7XX4B_rRVD4PI', // from your sheet's URL
  TRACKER_GID: '0',        // the gid of the tab holding the 58-block table
  DAILY_LOG_GID: '',       // fill in after step 4 below
  TARGET_DATE: '2026-09-10T18:00:00+05:30',
  REFRESH_MINUTES: 5,
};
```

To find a tab's `gid`: open that tab in Sheets and look at the URL — the number
after `#gid=` is what you need. `SHEET_ID` is the long string between `/d/` and
`/edit` in the sheet's URL.

The dashboard expects the tracker tab's columns in this order (matching your
current sheet, columns A–N):

`District | Block | Retain FY23-24 | Retain FY24-25 | Retain FY25-26 | Total retain | Fresh PLD target | Total target FY28-29 | Active PLDs now | Identified new (BPM) | Pending identification (Block) | Approved (DPM) | Pending approval (District) | Not surveyed`

It ignores header rows and the "…Target" / "State Total" subtotal rows automatically
(it recognises a real data row as one where both District and Block are filled in),
so you can keep your existing subtotal rows — the dashboard recalculates its own
totals for whatever District/Block selection is active.

## 3. Add your logo & map assets (already done for you)

`assets/trlm-logo.png` and `assets/tripura_districts.geojson` are already in this
folder — nothing to do here unless you want to swap the logo file.

## 4. Turn on daily progress tracking (recommended)

Your sheet has a single point-in-time snapshot (`Already available Active PLDs
(19.08.26)`), not a history — so there's nothing to chart a trend from until you
start logging one row a day. Two ways to do that:

**Option A — automatic (recommended).** In the Google Sheet: `Extensions > Apps
Script`, paste in `google-apps-script/daily_snapshot.gs`, update
`TRACKER_SHEET_NAME` at the top to your tab's exact name, then run
`setupDailyTrigger` once and approve the permissions it asks for. It will create a
`Daily_Log` tab and append one row to it every morning automatically, summing
Active PLDs, Identified New, Pending Identification, Approved and Pending Approval
across all blocks.

**Option B — manual.** Create a tab named `Daily_Log` yourself with headers `Date |
Active PLDs | Identified New (BPM) | Pending Identification | Approved (DPM) |
Pending Approval`, and add one row a day with the state-wide totals.

Either way, once the tab exists, copy its `gid` into `DAILY_LOG_GID` in
`js/app.js`. Until you do this, the dashboard shows a note in place of the daily
chart instead of guessing — that's expected.

## 5. Publish on GitHub Pages

1. Create a new GitHub repository and push everything in this folder to it
   (`index.html` should sit at the repo root).
2. Repo → `Settings > Pages` → Source: `Deploy from a branch` → Branch: `main`,
   folder `/ (root)` → Save.
3. Your dashboard will be live at `https://<your-username>.github.io/<repo-name>/`
   within a minute or two.
4. Any time you edit the Google Sheet, the published dashboard reflects it on the
   next page load / auto-refresh — you never need to redeploy for a data change.
   You only redeploy if you change the code itself (colours, columns, target date…).

## 6. Notes on scope, honestly

- **Map geography.** Tripura's 58 current RD blocks don't have a single reliable
  public polygon dataset — the best open sub-district boundaries available (Census
  2011 tehsils) only cover 40 of them under older names. Rather than fake block
  boundaries, the map uses **real, accurate district boundaries** (8 districts) as
  a choropleth, and block-level detail is one click away in the popup/table instead
  of drawn on the map. If your GIS cell has an official 58-block shapefile, send it
  over and the map can be upgraded to true block polygons.
- **"AI-animated cartoon photos" background.** This tool can't generate raster/photo
  images, so instead of that I drew a set of simple original line-art motifs (a
  handloom, poultry rearing, basket weaving, an SHG meeting circle, tailoring, a
  kitchen garden) as a very light tiled background (`assets/livelihood-motifs.svg`,
  ~5% opacity) so it stays subtle and doesn't fight with the data. If you'd like
  photographic or fully illustrated character art instead, that's easy to swap in
  as a background-image once you have files — the CSS hook is `.motif-field` in
  `css/style.css`.
- **Column formulas** are read as given from your sheet (K, H, M, N are whatever
  values your existing formulas compute) — the dashboard doesn't re-derive them,
  it only re-*aggregates* them for whatever selection is active.

## File map

```
index.html                       — the dashboard page
css/style.css                    — theme, layout, components
js/app.js                        — CONFIG, data fetch/parse, filters, charts, map, table
assets/trlm-logo.png             — TRLM logo
assets/tripura_districts.geojson — real district boundaries (Census, simplified)
assets/rays.svg, livelihood-motifs.svg — background decoration
google-apps-script/daily_snapshot.gs — optional auto daily-log script
```
