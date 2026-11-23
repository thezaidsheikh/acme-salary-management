"use client";

import { useRef, useState } from "react";
import { api, type ImportReport } from "./api";

/**
 * CSV import for the Employees page: picks a `.csv` file, uploads it, and
 * shows the backend's per-row report — how many rows were imported, and
 * every failed row with its file row number and reason — so HR can fix
 * exactly the rows that failed and re-upload. A sample CSV (the exact
 * columns the import accepts) is linked next to the button. After a
 * successful upload `onImported` runs so the list refreshes.
 */
export default function ImportEmployees({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState("");

  /**
   * Upload the chosen file; choosing no file (dialog cancelled) is a
   * no-op. Failures surface the backend's message; the report is kept
   * even when some rows failed, because that is a partial success.
   * @param file The chosen CSV file, if any.
   */
  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setUploading(true);
    setError("");
    setReport(null);
    try {
      setReport(await api.importEmployees(file));
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          aria-label="CSV file to import"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            // Reset so the same file can be picked again after fixing it.
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? "Importing…" : "Import CSV"}
        </button>
        <a className="text-sm text-indigo-700 underline" href="/sample-employees.csv" download>
          Download sample CSV
        </a>
      </div>
      {error && (
        <div role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-red-700">
          Import failed: {error}
        </div>
      )}
      {report && (
        <div className="rounded border bg-white p-4 text-sm">
          <p>
            Imported {report.imported} of {report.totalRows} rows.
          </p>
          {report.failed.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-slate-700">
              {report.failed.map((f) => (
                <li key={f.row}>
                  Row {f.row}: {f.reason}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-slate-500">All rows imported successfully.</p>
          )}
        </div>
      )}
    </div>
  );
}
