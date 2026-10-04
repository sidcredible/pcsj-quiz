/**
 * The Google Sheets side of "PCSJ Quiz Log".
 *
 * One Sheet, four tabs, never a sheet per quiz. Rows are only ever added or
 * updated in place — nothing here deletes a row, because a corrected quiz file
 * keeps its question ids and old responses must stay linked (section 8, rule 5).
 *
 * The Sheet is also the only durable store in the system: the app keeps no
 * database, so self-scoring an attempt hours later reads that attempt's rows
 * back from here.
 */

import { google, type sheets_v4 } from "googleapis";
import { googleAuth } from "../google/auth";
import {
  TABS,
  dataRange,
  headerRange,
  rowRange,
  type TabSpec,
} from "./columns";
import type { CellValue, SheetRow } from "./rows";

let client: sheets_v4.Sheets | undefined;

function sheetsClient(): sheets_v4.Sheets {
  if (!client) {
    client = google.sheets({ version: "v4", auth: googleAuth() });
  }
  return client;
}

/** Tabs that exist in the Sheet, by title. */
async function existingTabs(sheetId: string): Promise<Set<string>> {
  const response = await sheetsClient().spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets(properties(title))",
  });
  const titles = (response.data.sheets ?? [])
    .map((sheet) => sheet.properties?.title)
    .filter((title): title is string => Boolean(title));
  return new Set(titles);
}

let tabsEnsured = false;

/**
 * Creates any missing tab and writes its header row, so a brand-new blank
 * Sheet becomes a working log without anyone laying it out by hand.
 */
export async function ensureTabs(sheetId: string): Promise<void> {
  if (tabsEnsured) return;

  const sheets = sheetsClient();
  const present = await existingTabs(sheetId);
  const missing = TABS.filter((tab) => !present.has(tab.title));

  if (missing.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: missing.map((tab) => ({
          addSheet: { properties: { title: tab.title } },
        })),
      },
    });
  }

  // Header rows are written for every tab, not just the new ones: an existing
  // tab may predate a column being added here.
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: TABS.map((tab) => ({
        range: headerRange(tab),
        values: [[...tab.columns]],
      })),
    },
  });

  tabsEnsured = true;
}

/** Test seam, and a way to force a re-check after a Sheet is swapped. */
export function resetTabCache(): void {
  tabsEnsured = false;
}

/**
 * Maps each row's key to its 1-based Sheet row number, reading only the key
 * column so a Responses tab with 300,000 rows costs one narrow request.
 */
export async function keyRowNumbers(
  sheetId: string,
  tab: TabSpec,
): Promise<Map<string, number>> {
  const response = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${tab.title}!A2:A`,
    majorDimension: "COLUMNS",
  });
  const keys = response.data.values?.[0] ?? [];
  const map = new Map<string, number>();
  keys.forEach((key, index) => {
    const value = typeof key === "string" ? key : String(key ?? "");
    // Row 1 is the header, so data starts at row 2. A later duplicate wins,
    // which matches "update the row you would find".
    if (value) map.set(value, index + 2);
  });
  return map;
}

export async function appendRows(
  sheetId: string,
  tab: TabSpec,
  rows: readonly SheetRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await sheetsClient().spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: dataRange(tab),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows as CellValue[][] },
  });
}

/**
 * Writes rows by key: an existing key updates that row in place, a new key is
 * appended. Updates go in one batch, appends in one call, so importing a
 * 50-question quiz costs two requests rather than fifty.
 */
export async function upsertRows(
  sheetId: string,
  tab: TabSpec,
  rows: readonly SheetRow[],
): Promise<{ updated: number; appended: number }> {
  if (rows.length === 0) return { updated: 0, appended: 0 };

  const existing = await keyRowNumbers(sheetId, tab);
  const updates: sheets_v4.Schema$ValueRange[] = [];
  const appends: SheetRow[] = [];

  for (const row of rows) {
    const key = String(row[0] ?? "");
    const rowNumber = key ? existing.get(key) : undefined;
    if (rowNumber === undefined) {
      appends.push(row);
    } else {
      updates.push({
        range: rowRange(tab, rowNumber),
        values: [row as CellValue[]],
      });
    }
  }

  if (updates.length > 0) {
    await sheetsClient().spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
  }
  await appendRows(sheetId, tab, appends);

  return { updated: updates.length, appended: appends.length };
}

/** Every data row of a tab, as records keyed by column name. */
export async function readTab(
  sheetId: string,
  tab: TabSpec,
): Promise<Record<string, string>[]> {
  const response = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: dataRange(tab),
  });
  const rows = response.data.values ?? [];
  return rows
    .filter((row) => row.length > 0 && String(row[0] ?? "") !== "")
    .map((row) => {
      const record: Record<string, string> = {};
      tab.columns.forEach((column, index) => {
        const value = row[index];
        record[column] = value === undefined || value === null ? "" : String(value);
      });
      return record;
    });
}

/** Rows of a tab whose column equals a value, with their Sheet row numbers. */
export async function findRows(
  sheetId: string,
  tab: TabSpec,
  column: string,
  value: string,
): Promise<{ rowNumber: number; record: Record<string, string> }[]> {
  const response = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: dataRange(tab),
  });
  const rows = response.data.values ?? [];
  const columnIndex = tab.columns.indexOf(column);
  if (columnIndex < 0) return [];

  const found: { rowNumber: number; record: Record<string, string> }[] = [];
  rows.forEach((row, index) => {
    if (String(row[columnIndex] ?? "") !== value) return;
    const record: Record<string, string> = {};
    tab.columns.forEach((name, i) => {
      const cell = row[i];
      record[name] = cell === undefined || cell === null ? "" : String(cell);
    });
    found.push({ rowNumber: index + 2, record });
  });
  return found;
}

/** Replaces whole rows at known row numbers, in one batch. */
export async function updateRowsAt(
  sheetId: string,
  tab: TabSpec,
  updates: readonly { rowNumber: number; row: SheetRow }[],
): Promise<void> {
  if (updates.length === 0) return;
  await sheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: updates.map((update) => ({
        range: rowRange(tab, update.rowNumber),
        values: [update.row as CellValue[]],
      })),
    },
  });
}
