"use client";

import { useEffect, useRef, useState } from "react";
import { api, AppNotification } from "../lib/api";

const TYPE_ICONS: Record<AppNotification["type"], string> = {
  appointment: "📅",
  report: "📑",
  prescription: "💊",
  system: "ℹ️",
};

export default function NotificationBell() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getNotifications().then(setItems).catch(console.error);
  }, []);

  // Close when clicking outside the panel.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = items.filter((n) => !n.is_read).length;

  const markAllRead = async () => {
    try {
      await api.markAllNotificationsRead();
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
        className="relative w-9 h-9 rounded-xl bg-zinc-900/90 border border-zinc-800 hover:border-zinc-600 flex items-center justify-center text-sm transition"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-zinc-800 bg-[#0b0f1a] shadow-2xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <span className="text-sm font-bold text-white">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-[11px] font-semibold text-purple-400 hover:text-purple-300"
              >
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto divide-y divide-zinc-800/70">
            {items.length === 0 ? (
              <li className="px-4 py-6 text-xs text-zinc-500 text-center">No notifications yet.</li>
            ) : (
              items.map((n) => (
                <li key={n.id} className={`px-4 py-3 flex gap-3 ${n.is_read ? "" : "bg-purple-500/5"}`}>
                  <span className="text-sm">{TYPE_ICONS[n.type] ?? "ℹ️"}</span>
                  <div className="min-w-0">
                    <p className={`text-xs leading-relaxed ${n.is_read ? "text-zinc-400" : "text-zinc-100"}`}>
                      {n.message}
                    </p>
                    <p className="text-[10px] text-zinc-600 mt-1">
                      {new Date(n.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                  </div>
                  {!n.is_read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-400 flex-shrink-0" />}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
