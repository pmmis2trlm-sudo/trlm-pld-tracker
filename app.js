/* ==========================================================================
   Integration Tracker of Potential Lakhpati Didis on LokOS · FY 2026-29
   ==========================================================================
   HOW TO CONNECT YOUR GOOGLE SHEET
   ---------------------------------------------------------------------
   1. In Google Sheets: File > Share > "Anyone with the link" > Viewer.
   2. Open the tab that holds the block-level tracker. Its URL ends in
      "...#gid=NNNNNN" — copy that number into TRACKER_GID below.
   3. (Optional but recommended) Create a "Daily_Log" tab — see README.md
      — and paste its gid into DAILY_LOG_GID for the daily-progress chart.
   4. Save this file, commit, push. GitHub Pages needs no build step.
   ========================================================================== */
const CONFIG = {
  SHEET_ID: '1jUiOjFXAQmcKG0dn3R_AhyNDm7yVSJ7XX4B_rRVD4PI',
  TRACKER_GID: '1431422550',           // <-- change to your tracker tab's gid
  DAILY_LOG_GID: '',          // <-- fill in once the Daily_Log tab exists (see README)
  TARGET_DATE: '2026-09-10T18:00:00+05:30',   // identification-drive deadline
  REFRESH_MINUTES: 5,
  DRIVE_START_DATE: '2026-08-19',             // used only if Daily_Log has no earlier rows
};

const gvizUrl = (gid) =>
  `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;

/* -------------------------------------------------------------------------
   Small helpers
   ------------------------------------------------------------------------- */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-IN') : '—');
const pct = (a, b) => (b > 0 ? Math.max(0, Math.min(100, (a / b) * 100)) : 0);
const titleCase = (s) =>
  (s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const DISTRICT_ALIAS = { SIPAHIJALA: 'SEPAHIJALA', UNOKOTI: 'UNAKOTI' };
const normKey = (s) => {
  const k = (s || '').trim().toUpperCase();
  return DISTRICT_ALIAS[k] || k;
};

/* -------------------------------------------------------------------------
   State
   ------------------------------------------------------------------------- */
const STATE = {
  rows: [],                 // block-level rows
  byDistrict: new Map(),    // district key -> aggregate
  selected: new Set(),      // "DISTRICT||BLOCK" keys currently selected
  allKeys: [],
  dailyLog: [],             // [{date, active, identifiedNew, pending, approved, pendingApproval}]
  lastFetch: null,
  map: null,
  geoLayer: null,
  charts: {},
  sort: { col: 'district', dir: 'asc' },
};

/* ==========================================================================
   1. DATA FETCH + PARSE
   ========================================================================== */
function parseCsv(text) {
  return Papa.parse(text.trim(), { skipEmptyLines: false }).data;
}

async function fetchCsv(gid) {
  const res = await fetch(gvizUrl(gid), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Sheet fetch failed (HTTP ${res.status})`);
  return res.text();
}

// Robustly pull block-level rows out of the tracker sheet regardless of the
// exact header row count: a "real" row has a non-empty block name (col B)
// and a numeric value in col C.
function extractTrackerRows(grid) {
  const out = [];
  for (const r of grid) {
    if (!r || r.length < 14) continue;
    const district = (r[0] || '').toString().trim();
    const block = (r[1] || '').toString().trim();
    const c2 = parseFloat(r[2]);
    if (!district || !block || Number.isNaN(c2)) continue; // header / subtotal / blank row
    const num = (i) => {
      const v = parseFloat(r[i]);
      return Number.isFinite(v) ? v : 0;
    };
    out.push({
      district: titleCase(district),
      districtKey: normKey(district),
      block: titleCase(block),
      blockKey: block.trim().toUpperCase(),
      key: `${normKey(district)}||${block.trim().toUpperCase()}`,
      retC: num(2), retD: num(3), retE: num(4), retTotal: num(5),
      freshTarget: num(6), totalTarget: num(7),
      active: num(8), identifiedNew: num(9), pendingIdent: num(10),
      approved: num(11), pendingApproval: num(12), notSurveyed: num(13),
    });
  }
  return out;
}

function extractDailyLog(grid) {
  const rows = [];
  for (const r of grid) {
    if (!r || !r[0]) continue;
    const d = new Date(r[0]);
    if (Number.isNaN(d.getTime())) continue; // header row
    const num = (i) => { const v = parseFloat(r[i]); return Number.isFinite(v) ? v : 0; };
    rows.push({
      date: d,
      active: num(1), identifiedNew: num(2), pending: num(3),
      approved: num(4), pendingApproval: num(5),
    });
  }
  rows.sort((a, b) => a.date - b.date);
  return rows;
}

async function loadAll() {
  setStatus('loading', 'Fetching the latest figures from Google Sheets…');
  try {
    const trackerCsv = await fetchCsv(CONFIG.TRACKER_GID);
    STATE.rows = extractTrackerRows(parseCsv(trackerCsv));
    if (!STATE.rows.length) throw new Error('No block rows found — check TRACKER_GID in js/app.js');

    if (CONFIG.DAILY_LOG_GID) {
      try {
        const logCsv = await fetchCsv(CONFIG.DAILY_LOG_GID);
        STATE.dailyLog = extractDailyLog(parseCsv(logCsv));
      } catch (e) {
        STATE.dailyLog = [];
        console.warn('Daily log fetch failed:', e);
      }
    } else {
      STATE.dailyLog = [];
    }

    if (!STATE.allKeys.length) {
      STATE.allKeys = STATE.rows.map((r) => r.key);
      STATE.selected = new Set(STATE.allKeys);
    }

    STATE.lastFetch = new Date();
    buildDistrictAggregates();
    renderAll();
    setStatus('ok', `Live — last updated ${STATE.lastFetch.toLocaleTimeString('en-IN')}`);
  } catch (err) {
    console.error(err);
    setStatus('error', `Could not load the sheet — ${err.message}`);
  }
}

/* ==========================================================================
   2. AGGREGATION
   ========================================================================== */
const NUMERIC_FIELDS = ['retC', 'retD', 'retE', 'retTotal', 'freshTarget', 'totalTarget',
  'active', 'identifiedNew', 'pendingIdent', 'approved', 'pendingApproval', 'notSurveyed'];

function sumRows(rows) {
  const out = {}; NUMERIC_FIELDS.forEach((f) => (out[f] = 0));
  rows.forEach((r) => NUMERIC_FIELDS.forEach((f) => (out[f] += r[f])));
  return out;
}

function buildDistrictAggregates() {
  const map = new Map();
  STATE.rows.forEach((r) => {
    if (!map.has(r.districtKey)) map.set(r.districtKey, { district: r.district, districtKey: r.districtKey, blocks: [] });
    map.get(r.districtKey).blocks.push(r);
  });
  map.forEach((v) => Object.assign(v, sumRows(v.blocks)));
  STATE.byDistrict = map;
}

function selectedRows() {
  return STATE.rows.filter((r) => STATE.selected.has(r.key));
}

/* ==========================================================================
   3. FILTER UI
   ========================================================================== */
function buildFilterPanel() {
  const panel = $('#districtFilterPanel');
  const districts = Array.from(STATE.byDistrict.values()).sort((a, b) => a.district.localeCompare(b.district));

  panel.innerHTML = `
    <div class="fp-actions">
      <button data-act="all">Select all</button>
      <button data-act="none">Clear all</button>
    </div>
    <input class="fp-search" type="text" placeholder="Search district or block…" />
    <div class="fp-list"></div>
  `;
  const list = $('.fp-list', panel);

  districts.forEach((d) => {
    const grp = document.createElement('div');
    grp.className = 'fp-district-group';
    grp.dataset.district = d.districtKey;
    grp.innerHTML = `
      <label class="fp-option">
        <input type="checkbox" class="district-check" data-district="${d.districtKey}" checked />
        ${d.district} <span class="n">${d.blocks.length}</span>
      </label>
      <div class="fp-blocks"></div>
    `;
    const blocksWrap = $('.fp-blocks', grp);
    d.blocks.sort((a, b) => a.block.localeCompare(b.block)).forEach((b) => {
      const lab = document.createElement('label');
      lab.className = 'fp-option';
      lab.innerHTML = `<input type="checkbox" class="block-check" data-key="${b.key}" checked /> ${b.block}`;
      blocksWrap.appendChild(lab);
    });
    list.appendChild(grp);
  });

  panel.addEventListener('click', (e) => {
    if (e.target.dataset.act === 'all') { setAllFilter(true); }
    if (e.target.dataset.act === 'none') { setAllFilter(false); }
  });
  panel.addEventListener('change', (e) => {
    if (e.target.classList.contains('district-check')) {
      const dk = e.target.dataset.district;
      const on = e.target.checked;
      $$(`.block-check`, panel).forEach((cb) => {
        if (STATE.byDistrict.get(dk).blocks.some((b) => b.key === cb.dataset.key)) {
          cb.checked = on;
        }
      });
      syncSelectionFromPanel();
    } else if (e.target.classList.contains('block-check')) {
      syncSelectionFromPanel();
    }
  });

  $('.fp-search', panel).addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $$('.fp-district-group', panel).forEach((grp) => {
      const dName = grp.querySelector('.district-check').closest('label').textContent.toLowerCase();
      const blockLabels = $$('.fp-blocks .fp-option', grp);
      let anyBlockMatch = false;
      blockLabels.forEach((lab) => {
        const match = lab.textContent.toLowerCase().includes(q);
        lab.style.display = match || !q ? '' : 'none';
        if (match) anyBlockMatch = true;
      });
      grp.style.display = (!q || dName.includes(q) || anyBlockMatch) ? '' : 'none';
    });
  });
}

function setAllFilter(on) {
  $$('#districtFilterPanel input[type=checkbox]').forEach((cb) => (cb.checked = on));
  syncSelectionFromPanel();
}

function syncSelectionFromPanel() {
  const checked = $$('#districtFilterPanel .block-check:checked').map((cb) => cb.dataset.key);
  STATE.selected = new Set(checked);
  updateFilterButtonLabel();
  renderAll();
}

function updateFilterButtonLabel() {
  const total = STATE.allKeys.length;
  const sel = STATE.selected.size;
  $('#filterCount').textContent = sel === total ? 'All' : `${sel}/${total}`;
  const chip = $('#selectionChip');
  if (sel === total) {
    chip.style.display = 'none';
  } else {
    chip.style.display = '';
    const districtsInvolved = new Set(selectedRows().map((r) => r.district));
    chip.textContent = districtsInvolved.size === 1
      ? `Filtered · ${[...districtsInvolved][0]}`
      : `Filtered · ${sel} blocks across ${districtsInvolved.size} districts`;
  }
}

function selectOnlyDistrict(districtKey) {
  const grp = $(`.fp-district-group[data-district="${districtKey}"]`);
  setAllFilter(false);
  if (grp) {
    $$('input[type=checkbox]', grp).forEach((cb) => (cb.checked = true));
  }
  syncSelectionFromPanel();
}

/* ==========================================================================
   4. RENDER: KPI + DIAL
   ========================================================================== */
function renderKpis() {
  const rows = selectedRows();
  const s = sumRows(rows);

  setDial(pct(s.active, s.totalTarget), s.active, s.totalTarget);

  const cards = [
    { label: 'Total LD target · FY 2028-29', value: s.totalTarget, tone: 'ink',
      sub: `${fmt(s.retTotal)} retained + ${fmt(s.freshTarget)} fresh` },
    { label: 'To be retained (existing LDs)', value: s.retTotal, tone: 'blue',
      sub: `FY23-24 ${fmt(s.retC)} · FY24-25 ${fmt(s.retD)} · FY25-26 ${fmt(s.retE)}`, bar: pct(s.retTotal, s.totalTarget) },
    { label: 'Fresh PLD identification target', value: s.freshTarget, tone: 'gold',
      sub: `${pct(s.freshTarget, s.totalTarget).toFixed(0)}% of the FY28-29 target`, bar: pct(s.freshTarget, s.totalTarget) },
    { label: 'Active PLDs now (as of 19.08.26)', value: s.active, tone: 'leaf',
      sub: `<span class="up">${pct(s.active, s.totalTarget).toFixed(1)}%</span> of total target achieved`, bar: pct(s.active, s.totalTarget) },
    { label: 'Identified new PLDs — BPM level', value: s.identifiedNew, tone: 'gold',
      sub: s.identifiedNew ? 'Awaiting DPM approval' : 'Not yet entered by BPMs this cycle', bar: pct(s.identifiedNew, s.freshTarget) },
    { label: 'Pending identification — Block level', value: s.pendingIdent, tone: 'sun',
      sub: `<span class="down">Gap to close</span> before 10 Sep 2026`, bar: 100 - pct(s.pendingIdent, s.totalTarget) },
    { label: 'Approved — DPM level', value: s.approved, tone: 'leaf',
      sub: `${pct(s.approved, s.active).toFixed(0)}% of active PLDs approved`, bar: pct(s.approved, s.active) },
    { label: 'Not surveyed in last FY', value: s.notSurveyed, tone: s.notSurveyed > 0 ? 'ink' : 'leaf',
      sub: s.notSurveyed > 0 ? 'Includes PLDs inactive after survey' : 'No backlog in this selection' },
  ];

  $('#kpiGrid').innerHTML = cards.map((c) => `
    <div class="kpi-card" data-tone="${c.tone}">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value">${fmt(c.value)}</div>
      <div class="kpi-sub">${c.sub}</div>
      ${c.bar != null ? `<div class="kpi-bar"><span style="width:${Math.max(0, Math.min(100, c.bar))}%"></span></div>` : ''}
    </div>
  `).join('');
}

function setDial(percentage, active, target) {
  const p = Math.max(0, Math.min(100, percentage));
  const circumference = 2 * Math.PI * 88;
  const offset = circumference * (1 - p / 100);
  $('#dialArc').setAttribute('stroke-dasharray', `${circumference} ${circumference}`);
  $('#dialArc').setAttribute('stroke-dashoffset', offset);
  $('#dialPct').textContent = `${p.toFixed(1)}%`;
  $('#dialCaption').innerHTML = `<b>${fmt(active)}</b> active of <b>${fmt(target)}</b> total LD target`;
}

/* ==========================================================================
   5. MAP
   ========================================================================== */
function colorForPct(p) {
  // sun (low) -> gold (mid) -> leaf (high)
  const stops = [
    { p: 0, c: [200, 61, 22] },
    { p: 50, c: [232, 172, 51] },
    { p: 100, c: [0, 121, 58] },
  ];
  let a = stops[0], b = stops[1];
  if (p > 50) { a = stops[1]; b = stops[2]; }
  const t = a.p === b.p ? 0 : (p - a.p) / (b.p - a.p);
  const mix = a.c.map((v, i) => Math.round(v + (b.c[i] - v) * t));
  return `rgb(${mix.join(',')})`;
}

async function initMap() {
  STATE.map = L.map('trMap', { scrollWheelZoom: false, attributionControl: true })
    .setView([23.83, 91.75], 8);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap, &copy; CARTO',
    maxZoom: 12,
  }).addTo(STATE.map);

  const geo = await fetch('assets/tripura_districts.geojson').then((r) => r.json());

  STATE.geoLayer = L.geoJSON(geo, {
    style: (feature) => styleForFeature(feature),
    onEachFeature: (feature, layer) => {
      layer.on('mouseover', () => layer.setStyle({ weight: 3, color: '#0b3868' }));
      layer.on('mouseout', () => STATE.geoLayer.resetStyle(layer));
      layer.on('click', () => {
        selectOnlyDistrict(feature.properties.key);
        showDistrictPopup(layer, feature.properties.key);
      });
      layer.bindTooltip(feature.properties.district, { sticky: true, direction: 'top' });
    },
  }).addTo(STATE.map);

  STATE.map.fitBounds(STATE.geoLayer.getBounds(), { padding: [10, 10] });
}

function styleForFeature(feature) {
  const d = STATE.byDistrict.get(feature.properties.key);
  const p = d ? pct(d.active, d.totalTarget) : 0;
  return {
    color: '#ffffff', weight: 1.4,
    fillColor: colorForPct(p), fillOpacity: 0.78,
  };
}

function refreshMapStyle() {
  if (!STATE.geoLayer) return;
  STATE.geoLayer.eachLayer((layer) => STATE.geoLayer.resetStyle(layer));
  STATE.geoLayer.setStyle((feature) => styleForFeature(feature));
}

function showDistrictPopup(layer, districtKey) {
  const d = STATE.byDistrict.get(districtKey);
  if (!d) return;
  const p = pct(d.active, d.totalTarget);
  const blockRows = [...d.blocks].sort((a, b) => b.pendingIdent - a.pendingIdent).map((b) => `
    <tr><td>${b.block}</td><td>${fmt(b.active)} active</td><td>${fmt(b.pendingIdent)} pending</td></tr>
  `).join('');
  layer.bindPopup(`
    <div class="popup-title">${d.district}</div>
    <div class="popup-row"><span>Total target FY28-29</span><b>${fmt(d.totalTarget)}</b></div>
    <div class="popup-row"><span>Active PLDs now</span><b>${fmt(d.active)}</b></div>
    <div class="popup-row"><span>Pending identification</span><b>${fmt(d.pendingIdent)}</b></div>
    <div class="popup-row"><span>Approved (DPM)</span><b>${fmt(d.approved)}</b></div>
    <div class="popup-row"><span>Progress vs target</span><b>${p.toFixed(1)}%</b></div>
    <div class="popup-blocks">${d.blocks.length} blocks
      <table>${blockRows}</table>
    </div>
  `).openPopup();
}

/* ==========================================================================
   6. CHARTS
   ========================================================================== */
const CHART_FONT = { family: 'Inter, sans-serif', size: 11 };

function renderDistrictBarChart() {
  const rows = selectedRows();
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.district)) map.set(r.district, sumRows([]));
    const agg = map.get(r.district);
    NUMERIC_FIELDS.forEach((f) => (agg[f] += r[f]));
  });
  const entries = Array.from(map.entries()).sort((a, b) => b[1].pendingIdent - a[1].pendingIdent);

  const ctx = $('#districtBarChart').getContext('2d');
  const data = {
    labels: entries.map((e) => e[0]),
    datasets: [
      { label: 'Active PLDs now', data: entries.map((e) => e[1].active), backgroundColor: '#00993f', stack: 's' },
      { label: 'Pending identification', data: entries.map((e) => e[1].pendingIdent), backgroundColor: '#e84d21', stack: 's' },
    ],
  };
  if (STATE.charts.districtBar) STATE.charts.districtBar.destroy();
  STATE.charts.districtBar = new Chart(ctx, {
    type: 'bar',
    data,
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { stacked: true, ticks: { font: CHART_FONT } },
        y: { stacked: true, ticks: { font: CHART_FONT, callback: (v) => (v >= 1000 ? v / 1000 + 'k' : v) } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { font: CHART_FONT, boxWidth: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw)}` } },
      },
    },
  });
}

function renderRetentionChart() {
  const rows = selectedRows();
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.district)) map.set(r.district, { retC: 0, retD: 0, retE: 0 });
    const a = map.get(r.district);
    a.retC += r.retC; a.retD += r.retD; a.retE += r.retE;
  });
  const entries = Array.from(map.entries()).sort((a, b) => (b[1].retC + b[1].retD + b[1].retE) - (a[1].retC + a[1].retD + a[1].retE));

  const ctx = $('#retentionChart').getContext('2d');
  const data = {
    labels: entries.map((e) => e[0]),
    datasets: [
      { label: 'FY 2023-24 cohort', data: entries.map((e) => e[1].retC), backgroundColor: '#0f4a8c', stack: 's' },
      { label: 'FY 2024-25 cohort', data: entries.map((e) => e[1].retD), backgroundColor: '#e8ac33', stack: 's' },
      { label: 'FY 2025-26 cohort', data: entries.map((e) => e[1].retE), backgroundColor: '#7a4a2b', stack: 's' },
    ],
  };
  if (STATE.charts.retention) STATE.charts.retention.destroy();
  STATE.charts.retention = new Chart(ctx, {
    type: 'bar',
    data,
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { stacked: true, ticks: { font: CHART_FONT, callback: (v) => (v >= 1000 ? v / 1000 + 'k' : v) } },
        y: { stacked: true, ticks: { font: CHART_FONT } },
      },
      plugins: {
        legend: { position: 'bottom', labels: { font: CHART_FONT, boxWidth: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.raw)}` } },
      },
    },
  });
}

function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

function renderDailyProgressChart() {
  const wrap = $('#dailyProgressWrap');
  const log = STATE.dailyLog;

  if (!CONFIG.DAILY_LOG_GID || log.length < 2) {
    wrap.innerHTML = `<div class="log-missing">
      <b>Daily tracking isn't connected yet.</b> Add a <code>Daily_Log</code> tab to the sheet
      (Date · Active PLDs · Identified New · Pending Identification · Approved · Pending Approval)
      and either log one row a day, or install the auto-snapshot Apps Script in
      <code>google-apps-script/daily_snapshot.gs</code>. Then paste that tab's <code>gid</code> into
      <code>DAILY_LOG_GID</code> in <code>js/app.js</code>. See README.md for the full walkthrough.
    </div>`;
    $('#paceRow').innerHTML = '';
    return;
  }
  wrap.innerHTML = `<div class="progress-chart-wrap"><canvas id="dailyProgressChart"></canvas></div>`;

  const target = new Date(CONFIG.TARGET_DATE);
  const labels = log.map((r) => r.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
  const activeSeries = log.map((r) => r.active);

  const ctx = $('#dailyProgressChart').getContext('2d');
  if (STATE.charts.daily) STATE.charts.daily.destroy();
  STATE.charts.daily = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Active PLDs (state)', data: activeSeries, borderColor: '#0f4a8c', backgroundColor: 'rgba(15,74,140,.12)', fill: true, tension: .3, pointRadius: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { ticks: { font: CHART_FONT, callback: (v) => (v >= 1000 ? v / 1000 + 'k' : v) } }, x: { ticks: { font: CHART_FONT, maxRotation: 0, autoSkip: true } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `Active PLDs: ${fmt(c.raw)}` } } },
    },
  });

  // pace + projection
  const first = log[0], last = log[log.length - 1];
  const spanDays = Math.max(1, daysBetween(first.date, last.date));
  const dailyPace = (last.active - first.active) / spanDays;
  const now = new Date();
  const daysLeft = daysBetween(now, target);
  const stateTarget = sumRows(STATE.rows).totalTarget;
  const remaining = Math.max(0, stateTarget - last.active);
  const daysToFinish = dailyPace > 0 ? Math.ceil(remaining / dailyPace) : Infinity;
  const projected = Number.isFinite(daysToFinish) ? new Date(now.getTime() + daysToFinish * 86400000) : null;
  const onTrack = projected ? projected <= target : false;

  $('#paceRow').innerHTML = `
    <div class="pace-box"><div class="pl">Daily pace</div><div class="pv">${dailyPace >= 0 ? '+' : ''}${fmt(dailyPace)}/day</div></div>
    <div class="pace-box"><div class="pl">Days to deadline</div><div class="pv">${daysLeft >= 0 ? daysLeft : 0}</div></div>
    <div class="pace-box"><div class="pl">Projected completion</div><div class="pv ${onTrack ? 'tone-leaf' : 'tone-sun'}">${projected ? projected.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</div></div>
    <div class="pace-box"><div class="pl">Status</div><div class="pv ${onTrack ? 'tone-leaf' : 'tone-sun'}">${onTrack ? 'On track' : 'Behind schedule'}</div></div>
  `;
}

/* ==========================================================================
   7. TABLE
   ========================================================================== */
const TABLE_COLS = [
  { key: 'district', label: 'District' },
  { key: 'block', label: 'Block' },
  { key: 'retC', label: "Ret. FY23-24" },
  { key: 'retD', label: "Ret. FY24-25" },
  { key: 'retE', label: "Ret. FY25-26" },
  { key: 'retTotal', label: 'Total retain' },
  { key: 'freshTarget', label: 'Fresh target' },
  { key: 'totalTarget', label: 'Total target' },
  { key: 'active', label: 'Active now' },
  { key: 'identifiedNew', label: 'Identified new' },
  { key: 'pendingIdent', label: 'Pending ident.' },
  { key: 'approved', label: 'Approved' },
  { key: 'pendingApproval', label: 'Pending appr.' },
  { key: 'notSurveyed', label: 'Not surveyed' },
];

function renderTableHead() {
  $('#tableHead').innerHTML = `<tr>${TABLE_COLS.map((c) => `
    <th data-key="${c.key}">${c.label}<span class="arrow">${STATE.sort.col === c.key ? (STATE.sort.dir === 'asc' ? '▲' : '▼') : ''}</span></th>
  `).join('')}</tr>`;
}

function buildTableRows() {
  const q = ($('#tableSearch').value || '').trim().toLowerCase();
  let rows = selectedRows().filter((r) =>
    !q || r.district.toLowerCase().includes(q) || r.block.toLowerCase().includes(q));

  rows = [...rows].sort((a, b) => {
    const { col, dir } = STATE.sort;
    const va = a[col], vb = b[col];
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return dir === 'asc' ? cmp : -cmp;
  });
  return rows;
}

function renderTable() {
  renderTableHead();
  const rows = buildTableRows();
  const body = rows.map((r) => `
    <tr>
      <td>${r.district}</td><td>${r.block}</td>
      <td>${fmt(r.retC)}</td><td>${fmt(r.retD)}</td><td>${fmt(r.retE)}</td><td>${fmt(r.retTotal)}</td>
      <td>${fmt(r.freshTarget)}</td><td>${fmt(r.totalTarget)}</td>
      <td>${fmt(r.active)}</td><td>${fmt(r.identifiedNew)}</td>
      <td class="${r.pendingIdent > 0 ? 'cell-flag' : 'cell-good'}">${fmt(r.pendingIdent)}</td>
      <td>${fmt(r.approved)}</td><td>${fmt(r.pendingApproval)}</td>
      <td class="${r.notSurveyed < 0 ? 'cell-flag' : ''}">${fmt(r.notSurveyed)}</td>
    </tr>
  `).join('');

  const totals = sumRows(rows);
  const totalRow = `
    <tr class="row-target">
      <td>Selection total</td><td>${rows.length} block${rows.length === 1 ? '' : 's'}</td>
      <td>${fmt(totals.retC)}</td><td>${fmt(totals.retD)}</td><td>${fmt(totals.retE)}</td><td>${fmt(totals.retTotal)}</td>
      <td>${fmt(totals.freshTarget)}</td><td>${fmt(totals.totalTarget)}</td>
      <td>${fmt(totals.active)}</td><td>${fmt(totals.identifiedNew)}</td><td>${fmt(totals.pendingIdent)}</td>
      <td>${fmt(totals.approved)}</td><td>${fmt(totals.pendingApproval)}</td><td>${fmt(totals.notSurveyed)}</td>
    </tr>`;

  $('#tableBody').innerHTML = body + totalRow;
  $('#tableCount').textContent = `${rows.length} of ${STATE.rows.length} blocks`;
}

function exportCsv() {
  const rows = buildTableRows();
  const header = TABLE_COLS.map((c) => c.label).join(',');
  const lines = rows.map((r) => TABLE_COLS.map((c) => r[c.key]).join(','));
  const blob = new Blob([header + '\n' + lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `PLD-tracker-export-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

/* ==========================================================================
   8. STATUS BANNER / COUNTDOWN
   ========================================================================== */
function setStatus(kind, text) {
  const dot = $('#statusDot');
  dot.className = 'status-dot' + (kind === 'error' ? ' is-error' : kind === 'loading' ? ' is-loading' : '');
  $('#statusText').innerHTML = text;
}

function tickCountdown() {
  const target = new Date(CONFIG.TARGET_DATE);
  const now = new Date();
  let diff = Math.max(0, target - now);
  const d = Math.floor(diff / 86400000); diff -= d * 86400000;
  const h = Math.floor(diff / 3600000); diff -= h * 3600000;
  const m = Math.floor(diff / 60000); diff -= m * 60000;
  const s = Math.floor(diff / 1000);
  $('#cdDays').textContent = String(d).padStart(2, '0');
  $('#cdHours').textContent = String(h).padStart(2, '0');
  $('#cdMins').textContent = String(m).padStart(2, '0');
  $('#cdSecs').textContent = String(s).padStart(2, '0');
}

/* ==========================================================================
   9. WIRE-UP
   ========================================================================== */
function renderAll() {
  renderKpis();
  renderDistrictBarChart();
  renderRetentionChart();
  renderDailyProgressChart();
  renderTable();
  refreshMapStyle();
}

function initUi() {
  $('#refreshBtn').addEventListener('click', async () => {
    $('#refreshBtn').classList.add('is-loading');
    await loadAll();
    $('#refreshBtn').classList.remove('is-loading');
  });

  $('#districtFilterBtn').addEventListener('click', () => {
    $('#districtFilterPanel').classList.toggle('is-open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.filter-group')) $('#districtFilterPanel').classList.remove('is-open');
  });

  $('#resetFilters').addEventListener('click', () => setAllFilter(true));

  $('#tableSearch').addEventListener('input', renderTable);
  $('#exportCsvBtn').addEventListener('click', exportCsv);
  $('#tableHead').addEventListener('click', (e) => {
    const th = e.target.closest('th');
    if (!th) return;
    const key = th.dataset.key;
    if (STATE.sort.col === key) STATE.sort.dir = STATE.sort.dir === 'asc' ? 'desc' : 'asc';
    else { STATE.sort.col = key; STATE.sort.dir = 'asc'; }
    renderTable();
  });

  setInterval(tickCountdown, 1000);
  tickCountdown();
}

(async function boot() {
  initUi();
  await loadAll();
  buildFilterPanel();
  await initMap();
  refreshMapStyle();
  setInterval(loadAll, CONFIG.REFRESH_MINUTES * 60000);
})();
