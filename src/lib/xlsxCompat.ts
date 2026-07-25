/**
 * Thin async wrapper around ExcelJS that mirrors the xlsx API surface used in
 * this codebase. Replaces the xlsx package (CVEs: GHSA-4r6h-8v6p-xvw6,
 * GHSA-5pgg-2g8v-p4x9).
 *
 * Supported subset:
 *   utils.json_to_sheet, utils.aoa_to_sheet, utils.sheet_to_json
 *   utils.book_new, utils.book_append_sheet
 *   writeFile(wb, filename)  — async, triggers browser download
 *   read(buf)                — async, returns a Workbook-like object
 */

import ExcelJS from 'exceljs';

// ── Sheet / Workbook shapes that mirror xlsx's public API ─────────────────────

export interface Sheet {
  /** parsed row objects */
  _rows: Record<string, unknown>[];
  /** ordered column headers */
  _headers: string[];
  /** raw AOA data (set only when built via aoa_to_sheet) */
  _aoa?: unknown[][];
}

/** Workbook returned by book_new() and read() */
export interface Workbook {
  /** ordered sheet names (mirrors xlsx's wb.SheetNames) */
  SheetNames: string[];
  /** name → Sheet map (mirrors xlsx's wb.Sheets) */
  Sheets: Record<string, Sheet>;
  /** internal ordered list used during write */
  _ordered: { name: string; sheet: Sheet }[];
}

// ── utils ─────────────────────────────────────────────────────────────────────

function json_to_sheet(data: Record<string, unknown>[]): Sheet {
  const headers = data.length > 0 ? Object.keys(data[0]) : [];
  return { _rows: data, _headers: headers };
}

function aoa_to_sheet(data: unknown[][]): Sheet {
  const [headerRow, ...rest] = data;
  const headers = (headerRow as string[]) ?? [];
  const rows = rest.map((row) => {
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => { obj[h] = (row as unknown[])[i]; });
    return obj;
  });
  return { _rows: rows, _headers: headers, _aoa: data };
}

function sheet_to_json<T = Record<string, unknown>>(
  sheet: Sheet,
  _opts?: { defval?: unknown },
): T[] {
  return sheet._rows as T[];
}

function book_new(): Workbook {
  return { SheetNames: [], Sheets: {}, _ordered: [] };
}

function book_append_sheet(wb: Workbook, ws: Sheet, name: string): void {
  wb.SheetNames.push(name);
  wb.Sheets[name] = ws;
  wb._ordered.push({ name, sheet: ws });
}

export const utils = {
  json_to_sheet,
  aoa_to_sheet,
  sheet_to_json,
  book_new,
  book_append_sheet,
};

// ── writeFile — builds xlsx buffer and triggers browser download ───────────────

export async function writeFile(wb: Workbook, filename: string): Promise<void> {
  const ejWb = new ExcelJS.Workbook();

  for (const { name, sheet } of wb._ordered) {
    const ws = ejWb.addWorksheet(name);

    if (sheet._aoa) {
      for (const row of sheet._aoa) {
        ws.addRow(row as ExcelJS.CellValue[]);
      }
    } else {
      if (sheet._headers.length > 0) {
        ws.addRow(sheet._headers);
      }
      for (const row of sheet._rows) {
        ws.addRow(sheet._headers.map((h) => (row[h] ?? '') as ExcelJS.CellValue));
      }
    }
  }

  const buffer = await ejWb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── read — parses ArrayBuffer into a Workbook ─────────────────────────────────

export async function read(
  input: ArrayBuffer | Uint8Array | number[] | unknown,
  _opts?: { type?: string },
): Promise<Workbook> {
  const ejWb = new ExcelJS.Workbook();
  let buf: ArrayBuffer;

  if (input instanceof ArrayBuffer) {
    buf = input;
  } else if (input instanceof Uint8Array) {
    buf = input.buffer as ArrayBuffer;
  } else if (Array.isArray(input)) {
    buf = new Uint8Array(input as number[]).buffer;
  } else {
    throw new Error('xlsxCompat.read: unsupported input type');
  }

  await ejWb.xlsx.load(buf);

  const wb = book_new();
  ejWb.eachSheet((ws) => {
    const rows: Record<string, unknown>[] = [];
    let headers: string[] = [];
    let firstRow = true;

    ws.eachRow((row) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1); // index 0 is always empty
      if (firstRow) {
        headers = values.map((v) => String(v ?? ''));
        firstRow = false;
      } else {
        const obj: Record<string, unknown> = {};
        headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
        rows.push(obj);
      }
    });

    book_append_sheet(wb, { _rows: rows, _headers: headers }, ws.name);
  });

  return wb;
}

// ── Default export (mirrors: import * as XLSX from 'xlsx') ────────────────────

const XLSX = { utils, writeFile, read };
export default XLSX;
