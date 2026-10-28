"use client";

/** Previous / next controls for a server-paginated list. */
export default function Pager({
  page,
  totalPages,
  total,
  label,
  disabled,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  label: string;
  disabled?: boolean;
  onChange: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <nav
      aria-label={`${label} pages`}
      className="flex items-center justify-between gap-3 text-xs text-zinc-400 px-1"
    >
      <span>
        Page <span className="font-semibold text-zinc-200">{page}</span> of {totalPages} · {total} {label}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={disabled || page <= 1}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 font-semibold hover:bg-zinc-900 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={disabled || page >= totalPages}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 font-semibold hover:bg-zinc-900 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next →
        </button>
      </div>
    </nav>
  );
}
