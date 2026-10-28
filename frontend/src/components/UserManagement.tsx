"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, ManagedUser } from "../lib/api";
import Pager from "./Pager";

type RoleTab = "patient" | "doctor";
type StatusFilter = "all" | "active" | "inactive";

const PAGE_SIZE = 8;

/**
 * Admin panel for dropping patients and doctors. Deactivate is the default
 * (reversible, keeps records); permanent delete needs typed confirmation.
 */
export default function UserManagement({ onChanged }: { onChanged?: () => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<RoleTab>("patient");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [roleTotals, setRoleTotals] = useState({ patient: 0, doctor: 0 });
  const [reloadKey, setReloadKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [deleting, setDeleting] = useState<ManagedUser | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Wait for a pause in typing before searching on the server.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // A new search, tab or filter starts again from page 1.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, tab, status]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getManagedUsers({ role: tab, q: debouncedSearch, status, page, page_size: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return;
        setUsers(res.items);
        setTotal(res.total);
        setTotalPages(res.total_pages);
        setRoleTotals(res.role_totals);
      })
      .catch((err: any) => {
        if (!cancelled) setMessage({ type: "error", text: err.message || "Could not load users." });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, debouncedSearch, status, page, reloadKey]);

  const toggleActive = async (u: ManagedUser) => {
    setBusyId(u.id);
    setMessage(null);
    try {
      const res = await api.setUserActive(u.id, !u.is_active);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, is_active: res.is_active } : x)));
      // The row may no longer match the status filter.
      if (status !== "all") setReloadKey((k) => k + 1);
      setMessage({
        type: "success",
        text: res.is_active
          ? `${u.full_name} was reactivated.`
          : `${u.full_name} was deactivated${
              res.cancelled_appointments
                ? ` and ${res.cancelled_appointments} upcoming appointment${res.cancelled_appointments === 1 ? " was" : "s were"} cancelled`
                : ""
            }.${res.patients_notified ? ` ${res.patients_notified} patient${res.patients_notified === 1 ? "" : "s"} notified.` : ""}`,
      });
      onChanged?.();
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "Could not update the account." });
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyId(deleting.id);
    setMessage(null);
    setDeleteError(null);
    try {
      const res = await api.deleteUser(deleting.id);
      setReloadKey((k) => k + 1);
      setMessage({
        type: "success",
        text: `${deleting.full_name} was permanently deleted.${
          res.patients_notified
            ? ` ${res.patients_notified} patient${res.patients_notified === 1 ? " was" : "s were"} asked to choose another doctor.`
            : ""
        }`,
      });
      setDeleting(null);
      onChanged?.();
    } catch (err: any) {
      // Shown inside the dialog, which stays open and covers the panel message.
      setDeleteError(err.message || "Could not delete the account.");
    } finally {
      setBusyId(null);
    }
  };

  const visible = users;

  return (
    <section className="glass-card rounded-3xl p-6 sm:p-8 border border-zinc-800/80 shadow-2xl space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
        <div>
          <h2 className="text-lg font-bold text-white">👥 User Management</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Deactivate to block sign-in and keep records, or delete permanently.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-900/80 p-1 text-xs">
          {(["patient", "doctor"] as RoleTab[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setTab(r)}
              className={`rounded-lg px-4 py-2 font-semibold transition ${
                tab === r ? "bg-purple-600 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              {r === "patient" ? "Patients" : "Doctors"} ({roleTotals[r]})
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="search"
          value={search}
          maxLength={100}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search users"
          placeholder={tab === "doctor" ? "Search by name, email or specialization" : "Search by name or email"}
          className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-2.5 text-sm text-white outline-none focus:border-purple-500"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          aria-label="Filter by account status"
          className="rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-2.5 text-sm text-white outline-none focus:border-purple-500"
        >
          <option value="all">All accounts</option>
          <option value="active">Active only</option>
          <option value="inactive">Deactivated only</option>
        </select>
      </div>

      {message && (
        <div
          role={message.type === "error" ? "alert" : "status"}
          className={`text-xs rounded-xl px-4 py-3 border ${
            message.type === "error"
              ? "text-red-400 bg-red-500/10 border-red-500/30"
              : "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/60 overflow-hidden">
        {loading ? (
          <p className="p-6 text-sm text-zinc-500">Loading users…</p>
        ) : visible.length === 0 ? (
          <p className="p-6 text-sm text-zinc-500">No {tab === "doctor" ? "doctors" : "patients"} found.</p>
        ) : (
          visible.map((u) => (
            <div
              key={u.id}
              className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                u.is_active ? "" : "opacity-60"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-white text-sm">{u.full_name}</span>
                  {u.specialization && (
                    <span className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full">
                      {u.specialization}
                    </span>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full border ${
                      u.is_active
                        ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
                        : "text-zinc-400 bg-zinc-800 border-zinc-700"
                    }`}
                  >
                    {u.is_active ? "Active" : "Deactivated"}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-1 truncate">
                  {u.email ?? "No email"} · {u.appointment_count} appointment
                  {u.appointment_count === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  type="button"
                  disabled={busyId === u.id}
                  onClick={() => toggleActive(u)}
                  className={`text-xs font-semibold px-4 py-2 rounded-xl border transition disabled:opacity-50 ${
                    u.is_active
                      ? "bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/30"
                      : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                  }`}
                >
                  {u.is_active ? "Deactivate" : "Reactivate"}
                </button>
                <button
                  type="button"
                  disabled={busyId === u.id}
                  onClick={() => {
                    setDeleting(u);
                    setConfirmText("");
                    setDeleteError(null);
                  }}
                  className="text-xs font-semibold px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <Pager
        page={page}
        totalPages={totalPages}
        total={total}
        label={tab === "doctor" ? "doctors" : "patients"}
        disabled={loading}
        onChange={setPage}
      />

      {/* Portal to <body>: the panel's backdrop-filter would otherwise make
          it the containing block for this fixed overlay, so the dialog
          was positioned inside the (tall) panel and could open off-screen. */}
      {deleting && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => busyId !== deleting.id && setDeleting(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-3xl border border-red-500/30 bg-[#0b0f1a] p-6 space-y-4 shadow-2xl"
          >
            <h3 id="delete-title" className="text-lg font-bold text-white">
              Delete {deleting.full_name} permanently?
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              This removes the account, its login and everything linked to it. It can&apos;t be undone.
              To keep the records, deactivate instead.
            </p>
            <ul className="text-xs text-zinc-300 rounded-xl border border-zinc-800 divide-y divide-zinc-800">
              {[
                ["Appointments", deleting.appointment_count],
                ["Prescriptions", deleting.prescription_count],
                ...(deleting.role === "patient" ? [["Medical reports", deleting.report_count] as const] : []),
                ["Payments", deleting.payment_count],
              ].map(([label, n]) => (
                <li key={label} className="flex justify-between px-4 py-2">
                  <span className="text-zinc-500">{label}</span>
                  <span className="font-semibold">{n}</span>
                </li>
              ))}
            </ul>
            <label className="block text-xs text-zinc-300">
              Type <span className="font-mono font-bold text-red-400">DELETE</span> to confirm
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-2.5 text-sm text-white outline-none focus:border-red-500"
              />
            </label>
            {deleteError && (
              <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
                {deleteError}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                disabled={busyId === deleting.id}
                className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-900 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={confirmText !== "DELETE" || busyId === deleting.id}
                className="flex-1 rounded-xl bg-red-600 hover:bg-red-500 py-2.5 text-sm font-bold text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busyId === deleting.id ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
}
