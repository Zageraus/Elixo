"use client";

import { useState } from "react";
import { api, IntegrityResult } from "../lib/api";
import { shortHash } from "../lib/chain";

type Line = { ok: boolean | null; text: string };

function describe(kind: "report" | "prescription", r: IntegrityResult): Line[] {
  const lines: Line[] = [];

  if (kind === "report") {
    if (r.file === "match") lines.push({ ok: true, text: "The stored file matches the fingerprint recorded at upload." });
    else if (r.file === "changed") lines.push({ ok: false, text: "The stored file has changed since it was uploaded." });
    else lines.push({ ok: null, text: "No file is stored for this report, so its recorded fingerprint was checked instead." });
  } else if (r.recorded_hash && r.recorded_hash !== r.computed_hash) {
    lines.push({ ok: false, text: "The medications have changed since the prescription was anchored." });
  }

  const c = r.chain;
  if (c.status === "verified") {
    lines.push({ ok: true, text: `Matches the fingerprint anchored on-chain on ${new Date(c.anchoredAt).toLocaleString("en-IN")}.` });
  } else if (c.status === "mismatch") {
    lines.push({ ok: false, text: "Does not match the fingerprint anchored on-chain: this record was altered after anchoring." });
  } else if (c.status === "not_anchored") {
    lines.push({ ok: null, text: "This record isn't anchored on the current chain." });
  } else if (c.status === "disabled") {
    lines.push({ ok: null, text: "Blockchain anchoring is turned off, so there's nothing on-chain to compare with." });
  } else if (c.status === "unavailable") {
    lines.push({ ok: null, text: `Couldn't check the chain: ${c.error}` });
  }
  return lines;
}

/**
 * "Verify" button: re-hashes the record on the server and compares it with
 * the fingerprint stored at upload and the one anchored on-chain.
 */
export default function VerifyIntegrity({ kind, id }: { kind: "report" | "prescription"; id: string }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<IntegrityResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setChecking(true);
    setError(null);
    try {
      setResult(kind === "report" ? await api.verifyReport(id) : await api.verifyPrescription(id));
    } catch (err: any) {
      setResult(null);
      setError(err?.message ?? "Verification failed.");
    } finally {
      setChecking(false);
    }
  };

  const lines = result ? describe(kind, result) : [];
  const tampered = lines.some((l) => l.ok === false);
  const proven = !tampered && result?.chain.status === "verified";

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={checking}
        className="text-[11px] font-semibold px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 transition disabled:opacity-50"
      >
        {checking ? "Verifying…" : result ? "Verify again" : "🔍 Verify integrity"}
      </button>

      {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}

      {result && (
        <div
          role="status"
          className={`rounded-xl border p-3 text-[11px] space-y-1.5 ${
            tampered
              ? "border-red-500/30 bg-red-500/10"
              : proven
              ? "border-emerald-500/30 bg-emerald-500/10"
              : "border-zinc-700 bg-zinc-900/60"
          }`}
        >
          <p className={`font-bold ${tampered ? "text-red-300" : proven ? "text-emerald-300" : "text-zinc-300"}`}>
            {tampered ? "⚠️ Tampering detected" : proven ? "✅ Verified: unchanged since anchoring" : "ℹ️ Not fully verifiable"}
          </p>
          {lines.map((l, i) => (
            <p key={i} className={l.ok === false ? "text-red-300" : l.ok ? "text-emerald-300/90" : "text-zinc-400"}>
              {l.ok === false ? "✗" : l.ok ? "✓" : "•"} {l.text}
            </p>
          ))}
          {result.computed_hash && (
            <p className="font-mono text-zinc-500">SHA-256: {shortHash(result.computed_hash)}</p>
          )}
        </div>
      )}
    </div>
  );
}
