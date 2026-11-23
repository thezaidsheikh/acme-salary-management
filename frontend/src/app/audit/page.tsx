"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type AuditLogRow, type PageMeta } from "@/features/employees/api";
import { DEPARTMENTS } from "@/shared/lib/constants";
import { formatMoney } from "@/shared/utils/format";

/** Rows per page in the audit log. */
const PAGE_SIZE = 20;
/** Debounce delay for the search box, so every keystroke is not a request. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Format an ISO timestamp as "YYYY-MM-DD HH:MM" (UTC) — deterministic, so
 * two HR Managers reading the log see the same time for the same change.
 * @param iso ISO timestamp from the backend.
 * @returns The timestamp as "YYYY-MM-DD HH:MM".
 */
function formatWhen(iso: string): string {
  return new Date(iso).toISOString().replace("T", " ").slice(0, 16);
}

/**
 * Company-wide audit log page: every salary change in the org, newest
 * first, with employee search, department and date-range filters and
 * 20 rows per page with Previous/Next pagination. Each row says who
 * changed whose salary, old → new, the reason, and when. Fetches from
 * the backend at runtime.
 */
export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      const params: Record<string, string | number> = { page, pageSize: PAGE_SIZE };
      if (search) params.search = search;
      if (department) params.department = department;
      if (from) params.from = from;
      if (to) params.to = to;
      api
        .listAuditLog(params)
        .then(({ data, meta: m }) => {
          setRows(data);
          setMeta(m);
          setError("");
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search, department, from, to, page]);

  /** Wraps a filter setter so changing a filter also resets to page 1. */
  const resetPage =
    (fn: (v: string) => void) =>
    (v: string) => {
      setPage(1);
      fn(v);
    };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          Audit log{" "}
          {meta && <span className="text-base font-normal text-slate-500">({meta.total.toLocaleString()})</span>}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Every salary change in the company, newest first — who changed whose salary, old → new, the reason,
          and when.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          className="rounded-lg border px-3 py-2 text-sm"
          placeholder="Search employee name or email…"
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
        />
        <select
          aria-label="Department"
          className="rounded-lg border px-2 py-2 text-sm"
          value={department}
          onChange={(e) => resetPage(setDepartment)(e.target.value)}
        >
          <option value="">All departments</option>
          {DEPARTMENTS.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm text-slate-500">
          From
          <input
            aria-label="From date"
            type="date"
            className="rounded-lg border px-2 py-2 text-sm"
            value={from}
            onChange={(e) => resetPage(setFrom)(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-1 text-sm text-slate-500">
          To
          <input
            aria-label="To date"
            type="date"
            className="rounded-lg border px-2 py-2 text-sm"
            value={to}
            onChange={(e) => resetPage(setTo)(e.target.value)}
          />
        </label>
      </div>
      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-red-700">
          Could not load audit log: {error}. Is the backend running?
        </div>
      )}
      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded border bg-white p-6 text-center text-slate-500">
          No salary changes match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-slate-500">
                <th className="px-3 py-2">When</th>
                <th>Employee</th>
                <th>Department</th>
                <th>Changed by</th>
                <th>Old → New / month</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap">{formatWhen(r.changedAt)}</td>
                  <td>
                    <Link className="font-medium text-indigo-700" href={`/employees/${r.employeeId}`}>
                      {r.employeeName}
                    </Link>
                  </td>
                  <td>{r.department}</td>
                  <td>{r.changedBy}</td>
                  <td className="whitespace-nowrap">
                    {formatMoney(r.oldSalary, r.currency)} → {formatMoney(r.newSalary, r.currency)}
                  </td>
                  <td>{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {meta && (
        <div className="flex items-center justify-between text-sm">
          <span>
            Page {meta.page} of {meta.totalPages} · {meta.total.toLocaleString()} changes
          </span>
          <div className="flex gap-2">
            <button
              className="rounded border bg-white px-3 py-1 disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button
              className="rounded border bg-white px-3 py-1 disabled:opacity-40"
              disabled={page >= meta.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
