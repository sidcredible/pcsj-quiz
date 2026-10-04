/**
 * Chooses where the log goes: the real Sheet, or a local JSONL file when
 * SHEETS_DRY_RUN=1.
 *
 * The dry-run sink exists so the whole candidate flow — attempt, submit,
 * score, review, self-score — can be exercised before the service account and
 * the Sheet exist. It keeps the same keyed-upsert semantics as the Sheet, so a
 * retried attempt does not double-log there either.
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { dryRunSheets } from "../config";
import type { TabSpec } from "./columns";
import type { SheetRow } from "./rows";
import * as sheetsClient from "./client";

export interface SheetSink {
  readonly kind: "sheets" | "dry-run";
  readonly description: string;
  ensureTabs(sheetId: string): Promise<void>;
  upsertRows(
    sheetId: string,
    tab: TabSpec,
    rows: readonly SheetRow[],
  ): Promise<{ updated: number; appended: number }>;
  findRows(
    sheetId: string,
    tab: TabSpec,
    column: string,
    value: string,
  ): Promise<{ rowNumber: number; record: Record<string, string> }[]>;
  updateRowsAt(
    sheetId: string,
    tab: TabSpec,
    updates: readonly { rowNumber: number; row: SheetRow }[],
  ): Promise<void>;
  /** Every data row of a tab, as records keyed by column name. */
  readTab(sheetId: string, tab: TabSpec): Promise<Record<string, string>[]>;
}

const realSink: SheetSink = {
  kind: "sheets",
  description: "Google Sheet",
  ensureTabs: sheetsClient.ensureTabs,
  upsertRows: sheetsClient.upsertRows,
  findRows: sheetsClient.findRows,
  updateRowsAt: sheetsClient.updateRowsAt,
  readTab: sheetsClient.readTab,
};

function logPath(): string {
  return resolve(process.env.SHEETS_DRY_RUN_FILE?.trim() || ".dry-run/log.json");
}

type DryRunStore = Record<string, SheetRow[]>;

let memory: DryRunStore | null = null;

/** Loads the dry-run store once, then keeps it in memory and mirrors to disk. */
async function load(): Promise<DryRunStore> {
  if (memory) return memory;
  try {
    memory = JSON.parse(await readFile(logPath(), "utf8")) as DryRunStore;
  } catch {
    memory = {};
  }
  return memory;
}

async function persist(store: DryRunStore): Promise<void> {
  const path = logPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(store, null, 2), "utf8");
}

function toRecord(tab: TabSpec, row: SheetRow): Record<string, string> {
  const record: Record<string, string> = {};
  tab.columns.forEach((name, index) => {
    const cell = row[index];
    record[name] =
      cell === undefined || cell === null
        ? ""
        : typeof cell === "boolean"
          ? cell
            ? "TRUE"
            : "FALSE"
          : String(cell);
  });
  return record;
}

const dryRunSink: SheetSink = {
  kind: "dry-run",
  get description() {
    return `local file ${logPath()}`;
  },

  async ensureTabs() {
    const store = await load();
    await persist(store);
  },

  async upsertRows(_sheetId, tab, rows) {
    const store = await load();
    const existing = store[tab.title] ?? [];
    let updated = 0;
    let appended = 0;
    for (const row of rows) {
      const key = String(row[0] ?? "");
      const index = existing.findIndex((r) => String(r[0] ?? "") === key);
      if (index >= 0) {
        existing[index] = row;
        updated += 1;
      } else {
        existing.push(row);
        appended += 1;
      }
    }
    store[tab.title] = existing;
    await persist(store);
    return { updated, appended };
  },

  async findRows(_sheetId, tab, column, value) {
    const store = await load();
    const rows = store[tab.title] ?? [];
    const columnIndex = tab.columns.indexOf(column);
    if (columnIndex < 0) return [];
    const found: { rowNumber: number; record: Record<string, string> }[] = [];
    rows.forEach((row, index) => {
      if (String(row[columnIndex] ?? "") !== value) return;
      found.push({ rowNumber: index + 2, record: toRecord(tab, row) });
    });
    return found;
  },

  async updateRowsAt(_sheetId, tab, updates) {
    const store = await load();
    const rows = store[tab.title] ?? [];
    for (const update of updates) rows[update.rowNumber - 2] = update.row;
    store[tab.title] = rows;
    await persist(store);
  },

  async readTab(_sheetId, tab) {
    const store = await load();
    return (store[tab.title] ?? []).map((row) => toRecord(tab, row));
  },
};

export function sheetSink(): SheetSink {
  return dryRunSheets() ? dryRunSink : realSink;
}

/** Test seam for the dry-run store. */
export function resetDryRunStore(): void {
  memory = null;
}

export { appendFile };
