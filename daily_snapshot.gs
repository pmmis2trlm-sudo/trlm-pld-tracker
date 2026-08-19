/**
 * TRLM · Lakhpati Didi Integration Tracker — Daily Snapshot
 * -----------------------------------------------------------------------
 * Paste this into Extensions > Apps Script inside the SAME Google Sheet
 * as the block-level tracker, then run setupDailyTrigger() once (it will
 * ask you to authorise). From then on it appends one row a day to a
 * "Daily_Log" tab, which the dashboard's daily-progress chart reads.
 *
 * SETUP
 *  1. Change TRACKER_SHEET_NAME below to your tracker tab's exact name
 *     (the label on the tab at the bottom of the sheet).
 *  2. Apps Script editor > Run > setupDailyTrigger (once).
 *  3. Grant the permissions it asks for.
 *  4. Back in the dashboard's js/app.js, set DAILY_LOG_GID to the gid of
 *     the new "Daily_Log" tab (open the tab, copy the number after
 *     "#gid=" in the URL).
 * -----------------------------------------------------------------------
 */

const TRACKER_SHEET_NAME = 'Sheet1';     // <-- set to your tracker tab's name
const DAILY_LOG_SHEET_NAME = 'Daily_Log';

// Column positions on the tracker tab (1-indexed, matching A..N)
const COL = {
  DISTRICT: 1, BLOCK: 2,
  RET_C: 3, RET_D: 4, RET_E: 5, RET_TOTAL: 6,
  FRESH_TARGET: 7, TOTAL_TARGET: 8,
  ACTIVE: 9, IDENTIFIED_NEW: 10, PENDING_IDENT: 11,
  APPROVED: 12, PENDING_APPROVAL: 13, NOT_SURVEYED: 14,
};

function setupDailyTrigger() {
  // Remove any existing snapshotDaily triggers first, so re-running this is safe.
  ScriptApp.getProjectTriggers().forEach((t) => {
    if (t.getHandlerFunction() === 'snapshotDaily') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('snapshotDaily')
    .timeBased()
    .everyDays(1)
    .atHour(8) // 08:00, script timezone (set Project Settings > Time zone to Asia/Kolkata)
    .create();
  ensureDailyLogSheet_();
  snapshotDaily(); // log today's figures immediately too
  Logger.log('Daily trigger installed. It will run once every day at ~08:00.');
}

function snapshotDaily() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tracker = ss.getSheetByName(TRACKER_SHEET_NAME);
  if (!tracker) throw new Error('TRACKER_SHEET_NAME "' + TRACKER_SHEET_NAME + '" not found — check the tab name.');

  const data = tracker.getDataRange().getValues();
  let sums = { active: 0, identifiedNew: 0, pendingIdent: 0, approved: 0, pendingApproval: 0 };

  data.forEach((row) => {
    const district = row[COL.DISTRICT - 1];
    const block = row[COL.BLOCK - 1];
    const c = row[COL.RET_C - 1];
    if (!district || !block || typeof c !== 'number') return; // skip headers / subtotal / total rows
    sums.active += Number(row[COL.ACTIVE - 1]) || 0;
    sums.identifiedNew += Number(row[COL.IDENTIFIED_NEW - 1]) || 0;
    sums.pendingIdent += Number(row[COL.PENDING_IDENT - 1]) || 0;
    sums.approved += Number(row[COL.APPROVED - 1]) || 0;
    sums.pendingApproval += Number(row[COL.PENDING_APPROVAL - 1]) || 0;
  });

  const log = ensureDailyLogSheet_();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd');

  const values = log.getDataRange().getValues();
  const alreadyLoggedToday = values.some((r) => {
    const d = r[0];
    if (!(d instanceof Date)) return false;
    return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd') === today;
  });
  if (alreadyLoggedToday) {
    Logger.log('Already logged today — skipping.');
    return;
  }

  log.appendRow([new Date(), sums.active, sums.identifiedNew, sums.pendingIdent, sums.approved, sums.pendingApproval]);
}

function ensureDailyLogSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(DAILY_LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DAILY_LOG_SHEET_NAME);
    sheet.appendRow(['Date', 'Active PLDs', 'Identified New (BPM)', 'Pending Identification', 'Approved (DPM)', 'Pending Approval']);
    sheet.getRange('A1:F1').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Optional: run manually any time to backfill/refresh today's row. */
function runNow() { snapshotDaily(); }
