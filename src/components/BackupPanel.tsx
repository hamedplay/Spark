import React, { useState, useRef } from 'react';
import { Download, Upload, Database, Loader as Loader2, CircleCheck as CheckCircle, TriangleAlert as AlertTriangle, Shield, FileText, Calendar, ClipboardList, MessageSquare, BookOpen, FolderOpen, Table2, RefreshCw, ChevronDown, ChevronUp, Info, Video, Send, Link } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import * as XLSX from '../lib/xlsxCompat';
import { TABLES, TABLE_LABEL, BACKUP_VERSION, PAGE_SIZE } from './Backup/tablesConfig';
import { TableRow, RestoreTableRow } from './Backup/BackupRows';
import { RestoreReport } from './Backup/RestoreReport';

/** Fetch all rows for a table using range-based pagination to avoid the 50K limit. */
async function fetchAllRows(tableKey: string): Promise<any[]> {
  const all: any[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from(tableKey)
      .select('*')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

// ── Restore panel ────────────────────────────────────────────────────────────
function RestorePanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsedData, setParsedData] = useState<Record<string, any[]> | null>(null);
  const [backupMeta, setBackupMeta] = useState<Record<string, any> | null>(null);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [strategy, setStrategy] = useState<'upsert' | 'replace'>('upsert');
  const [running, setRunning] = useState(false);
  const [tableStatus, setTableStatus] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
  const [restoreReport, setRestoreReport] = useState<Record<string, any> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [expandedReportTable, setExpandedReportTable] = useState<string | null>(null);

  const toggleTable = (key: string) => setSelectedTables(s => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const selectAll = () => { if (parsedData) setSelectedTables(new Set(Object.keys(parsedData))); };
  const selectNone = () => setSelectedTables(new Set());

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError('');
    setParsedData(null);
    setBackupMeta(null);
    setSelectedTables(new Set());
    setTableStatus({});
    setConfirmed(false);
    setParsing(true);

    try {
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        const obj = JSON.parse(text);
        if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error('فرمت JSON نامعتبر است');
        // Strip metadata and profiles keys
        const { _meta, profiles: _p, ...rest } = obj as any;
        if (_meta) setBackupMeta(_meta);
        for (const [k, v] of Object.entries(rest)) {
          if (!Array.isArray(v)) throw new Error(`جدول "${k}" آرایه نیست`);
        }
        setParsedData(rest as Record<string, any[]>);
        setSelectedTables(new Set(Object.keys(rest)));
      } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        const buf = await file.arrayBuffer();
        const wb = await XLSX.read(buf, { type: 'array' });
        const result: Record<string, any[]> = {};
        const labelToKey = Object.fromEntries(TABLES.map(t => [t.label.slice(0, 31), t.key]));
        for (const sheetName of wb.SheetNames) {
          const tableKey = labelToKey[sheetName] ?? sheetName;
          if (tableKey === 'profiles' || tableKey === '_meta') continue;
          const ws = wb.Sheets[sheetName];
          result[tableKey] = XLSX.utils.sheet_to_json(ws);
        }
        setParsedData(result);
        setSelectedTables(new Set(Object.keys(result)));
      } else {
        throw new Error('فقط فایل‌های JSON و XLSX پشتیبانی می‌شوند');
      }
    } catch (err: any) {
      setParseError(err.message || 'خطا در خواندن فایل');
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const runRestore = async () => {
    if (!parsedData || selectedTables.size === 0) return;
    setRunning(true);

    const init: Record<string, 'idle' | 'loading' | 'done' | 'error'> = {};
    for (const k of selectedTables) init[k] = 'loading';
    setTableStatus(init);

    const tables: Record<string, any[]> = {};
    for (const k of selectedTables) tables[k] = parsedData[k] ?? [];

    try {
      const { data, error } = await supabase.functions.invoke('restore-backup', {
        body: { tables, strategy },
      });

      if (error) throw error;

      const results = (data as any)?.results ?? {};
      const newStatus: Record<string, 'idle' | 'loading' | 'done' | 'error'> = {};
      for (const k of selectedTables) {
        const r = results[k];
        if (!r) { newStatus[k] = 'error'; continue; }
        newStatus[k] = r.success ? 'done' : 'error';
        if (!r.success && r.errors?.length) {
          toast.error(`خطا در بازیابی ${TABLE_LABEL[k] ?? k}: ${r.errors[0]}`);
        }
      }
      setTableStatus(newStatus);
      setRestoreReport(results);

      const doneCount = Object.values(newStatus).filter(s => s === 'done').length;
      const totalInserted = Object.values(results).reduce((s: number, r: any) => s + (r?.inserted ?? 0), 0);
      const totalUpdated = Object.values(results).reduce((s: number, r: any) => s + (r?.updated ?? 0), 0);
      const totalFailed = Object.values(results).reduce((s: number, r: any) => s + (r?.failed ?? 0), 0);
      if (doneCount > 0) {
        const parts = [`بازیابی ${doneCount} جدول`];
        if (totalInserted > 0) parts.push(`${totalInserted.toLocaleString('fa-IR')} ردیف جدید`);
        if (totalUpdated > 0) parts.push(`${totalUpdated.toLocaleString('fa-IR')} به‌روزرسانی`);
        if (totalFailed > 0) parts.push(`${totalFailed.toLocaleString('fa-IR')} ناموفق`);
        toast[totalFailed > 0 ? 'error' : 'success'](parts.join(' — '));
      }
    } catch (err: any) {
      toast.error(`خطا در بازیابی: ${err.message}`);
      const errStatus: Record<string, 'idle' | 'loading' | 'done' | 'error'> = {};
      for (const k of selectedTables) errStatus[k] = 'error';
      setTableStatus(errStatus);
    }

    setRunning(false);
    setConfirmed(false);
  };

  const doneCount = Object.values(tableStatus).filter(s => s === 'done').length;
  const totalSelected = selectedTables.size;

  return (
    <div className="space-y-4">
      <div
        onClick={() => fileRef.current?.click()}
        className="flex flex-col items-center justify-center gap-3 p-6 border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-2xl cursor-pointer hover:border-emerald-400 dark:hover:border-emerald-500 transition-colors bg-gray-50 dark:bg-gray-800/50 group"
      >
        <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center group-hover:scale-105 transition-transform">
          <Upload className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        {parsing ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> در حال خواندن فایل...
          </div>
        ) : fileName && parsedData ? (
          <div className="text-center">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{fileName}</p>
            <p className="text-xs text-gray-400 mt-0.5">{Object.keys(parsedData).length} جدول شناسایی شد</p>
            {backupMeta && (
              <p className="text-xs text-gray-400 mt-0.5">
                نسخه {backupMeta.version} — {new Date(backupMeta.created_at).toLocaleString('fa-IR')}
              </p>
            )}
          </div>
        ) : (
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">فایل پشتیبان را انتخاب کنید</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">JSON یا Excel (.xlsx)</p>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".json,.xlsx,.xls" className="hidden" onChange={handleFileChange} />
      </div>

      {parseError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-700 dark:text-red-300">{parseError}</p>
        </div>
      )}

      {parsedData && (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">روش بازیابی</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setStrategy('upsert')}
                className={`p-3 rounded-xl border transition-all text-right ${strategy === 'upsert' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-600' : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}
              >
                <p className={`text-sm font-semibold ${strategy === 'upsert' ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-700 dark:text-gray-300'}`}>ادغام (Upsert)</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-relaxed">ردیف‌های موجود به‌روز و ردیف‌های جدید اضافه می‌شوند. داده‌های فعلی حذف نمی‌شوند.</p>
              </button>
              <button
                onClick={() => setStrategy('replace')}
                className={`p-3 rounded-xl border transition-all text-right ${strategy === 'replace' ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-600' : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}
              >
                <p className={`text-sm font-semibold ${strategy === 'replace' ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-300'}`}>جایگزینی کامل</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-relaxed">تمام داده‌های فعلی حذف و از فایل پشتیبان بازنویسی می‌شوند.</p>
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                جداول ({selectedTables.size} از {Object.keys(parsedData).length} انتخاب‌شده)
              </p>
              <div className="flex gap-2">
                <button onClick={selectAll} className="text-xs px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-100 transition-colors">همه</button>
                <button onClick={selectNone} className="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">هیچ‌کدام</button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
              {Object.entries(parsedData).map(([key, rows]) => (
                <RestoreTableRow
                  key={key}
                  tableKey={key}
                  rowCount={rows.length}
                  selected={selectedTables.has(key)}
                  onToggle={() => toggleTable(key)}
                  status={tableStatus[key] || 'idle'}
                />
              ))}
            </div>
          </div>

          {running && totalSelected > 0 && (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl border border-emerald-100 dark:border-emerald-800 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">در حال بازیابی...</span>
                <span className="text-sm text-emerald-600 dark:text-emerald-400">{doneCount} / {totalSelected}</span>
              </div>
              <div className="w-full bg-emerald-100 dark:bg-emerald-900/50 rounded-full h-2">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${totalSelected > 0 ? (doneCount / totalSelected) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {restoreReport && !running && (
            <RestoreReport
              report={restoreReport}
              expandedTable={expandedReportTable}
              setExpandedTable={setExpandedReportTable}
            />
          )}

          {strategy === 'replace' && (
            <div className="flex items-start gap-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed font-medium mb-2">
                  حالت جایگزینی: تمام داده‌های فعلی جداول انتخاب‌شده حذف خواهند شد. این عملیات برگشت‌پذیر نیست.
                </p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="w-4 h-4 accent-red-500" />
                  <span className="text-xs text-red-700 dark:text-red-300 font-medium">تأیید می‌کنم که داده‌های فعلی حذف شوند</span>
                </label>
              </div>
            </div>
          )}

          <button
            onClick={runRestore}
            disabled={running || selectedTables.size === 0 || (strategy === 'replace' && !confirmed)}
            className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white rounded-2xl font-medium transition-colors shadow-sm"
          >
            {running
              ? <><Loader2 className="w-4 h-4 animate-spin" /> در حال بازیابی...</>
              : <><RefreshCw className="w-4 h-4" /> بازیابی ({selectedTables.size} جدول)</>
            }
          </button>
        </>
      )}
    </div>
  );
}

// ── Main BackupPanel ─────────────────────────────────────────────────────────
export function BackupPanel() {
  const [selected, setSelected] = useState<Set<string>>(new Set(TABLES.map(t => t.key)));
  const [format, setFormat] = useState<'json' | 'xlsx'>('json');
  const [running, setRunning] = useState(false);
  const [tableStatus, setTableStatus] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
  const [showRestore, setShowRestore] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const toggle = (key: string) => setSelected(s => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const selectAll = () => setSelected(new Set(TABLES.map(t => t.key)));
  const selectNone = () => setSelected(new Set());

  const runBackup = async () => {
    if (selected.size === 0) { toast.error('حداقل یک جدول انتخاب کنید'); return; }
    setRunning(true);
    setProgress({ done: 0, total: selected.size });

    const init: Record<string, 'idle' | 'loading' | 'done' | 'error'> = {};
    TABLES.forEach(t => { init[t.key] = selected.has(t.key) ? 'loading' : 'idle'; });
    setTableStatus(init);

    const result: Record<string, any[]> = {};
    let doneCount = 0;

    for (const cfg of TABLES) {
      if (!selected.has(cfg.key)) continue;
      try {
        const rows = await fetchAllRows(cfg.key);
        result[cfg.key] = rows;
        setTableStatus(s => ({ ...s, [cfg.key]: 'done' }));
      } catch {
        result[cfg.key] = [];
        setTableStatus(s => ({ ...s, [cfg.key]: 'error' }));
        toast.error(`خطا در خواندن ${cfg.label}`);
      }
      doneCount++;
      setProgress({ done: doneCount, total: selected.size });
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const rowCounts = Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.length]));
    const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);

    if (format === 'json') {
      const payload = {
        _meta: {
          version: BACKUP_VERSION,
          created_at: new Date().toISOString(),
          table_count: Object.keys(result).length,
          total_rows: totalRows,
          row_counts: rowCounts,
        },
        ...result,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${ts}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const wb = XLSX.utils.book_new();
      for (const cfg of TABLES) {
        if (!selected.has(cfg.key) || !result[cfg.key]?.length) continue;
        const ws = XLSX.utils.json_to_sheet(result[cfg.key]);
        XLSX.utils.book_append_sheet(wb, ws, cfg.label.slice(0, 31));
      }
      await XLSX.writeFile(wb, `backup_${ts}.xlsx`);
    }

    const nonEmpty = Object.values(result).filter(r => r.length > 0).length;
    toast.success(`پشتیبان‌گیری از ${nonEmpty} جدول — ${totalRows.toLocaleString('fa-IR')} ردیف`);
    setRunning(false);
  };

  return (
    <div className="space-y-5" dir="rtl">

      {/* ── Export / Backup section ─────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
          <Database className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h3 className="font-bold text-gray-800 dark:text-white">پشتیبان‌گیری از دیتابیس</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            خروجی کامل از {TABLES.length} جدول به فرمت JSON یا Excel
          </p>
        </div>
      </div>

      {/* Format selector */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">فرمت خروجی</p>
        <div className="flex gap-3 mb-3">
          {(['json', 'xlsx'] as const).map(f => (
            <button key={f} onClick={() => setFormat(f)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${format === f ? 'bg-blue-500 text-white border-blue-500' : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}>
              {f === 'json' ? 'JSON (پیشنهادی برای مهاجرت)' : 'Excel (.xlsx)'}
            </button>
          ))}
        </div>
        <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
          <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
            {format === 'json'
              ? 'JSON تمام انواع داده (JSONB، آرایه، null) را بدون محدودیت تعداد ردیف حفظ می‌کند و برای مهاجرت به دیتابیس جدید توصیه می‌شود.'
              : 'Excel برای مشاهده و ویرایش دستی مناسب است اما ممکن است انواع داده پیچیده (JSONB) را دقیق نگه ندارد.'
            }
          </p>
        </div>
      </div>

      {/* Table selection */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            جداول ({selected.size} از {TABLES.length} انتخاب‌شده)
          </p>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-xs px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors">همه</button>
            <button onClick={selectNone} className="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">هیچ‌کدام</button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-y-auto">
          {TABLES.map(cfg => (
            <TableRow
              key={cfg.key}
              cfg={cfg}
              selected={selected.has(cfg.key)}
              onToggle={() => toggle(cfg.key)}
              status={tableStatus[cfg.key] || 'idle'}
            />
          ))}
        </div>
      </div>

      {/* Progress */}
      {running && progress.total > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">در حال پشتیبان‌گیری...</span>
            <span className="text-sm text-blue-600 dark:text-blue-400">{progress.done} / {progress.total}</span>
          </div>
          <div className="w-full bg-blue-100 dark:bg-blue-900/50 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Warning */}
      <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
          فایل پشتیبان حاوی داده‌های واقعی سازمان است. در مکان امن ذخیره کنید و به اشخاص غیرمجاز دسترسی ندهید.
        </p>
      </div>

      {/* Export button */}
      <button
        onClick={runBackup}
        disabled={running || selected.size === 0}
        className="w-full flex items-center justify-center gap-2 py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white rounded-2xl font-medium transition-colors shadow-sm"
      >
        {running
          ? <><Loader2 className="w-4 h-4 animate-spin" /> در حال پشتیبان‌گیری...</>
          : <><Download className="w-4 h-4" /> دریافت پشتیبان ({selected.size} جدول)</>
        }
      </button>

      {/* ── Restore / Import section ────────────────────────────────────── */}
      <div className="border-t border-gray-100 dark:border-gray-700 pt-5">
        <button
          onClick={() => setShowRestore(v => !v)}
          className="w-full flex items-center gap-3 text-right"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
            <Upload className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-800 dark:text-white">بازیابی / وارد کردن پشتیبان</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              بارگذاری فایل پشتیبان و اعمال مجدد داده‌ها
            </p>
          </div>
          {showRestore
            ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
            : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
          }
        </button>

        {showRestore && (
          <div className="mt-4">
            <RestorePanel />
          </div>
        )}
      </div>
    </div>
  );
}
