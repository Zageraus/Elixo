/**
 * Anchors every report and prescription that isn't anchored on the current
 * chain yet:
 *   npm run anchor:backfill
 *
 * Safe to re-run. Records already anchored with the same hash are skipped,
 * and records whose on-chain hash differs are reported, not overwritten.
 * After a local chain restart, stale "confirmed" rows from the old chain
 * are replaced.
 */
import "dotenv/config";
import { prisma } from "../config/prisma.js";
import { anchorHashOnChain, hashPrescription, verifyOnChain } from "../services/blockchain.service.js";

type Target = { id: string; type: "report" | "prescription"; label: string; hash: string };

async function loadTargets(): Promise<Target[]> {
  const [reports, prescriptions] = await Promise.all([
    prisma.medical_reports.findMany({ select: { id: true, title: true, file_hash: true } }),
    prisma.prescriptions.findMany({ select: { id: true, items: { orderBy: { line_no: "asc" } } } }),
  ]);

  return [
    ...reports.map((r) => ({ id: r.id, type: "report" as const, label: r.title.trim(), hash: r.file_hash })),
    ...prescriptions.map((p) => {
      const medications = p.items.map((i) => ({
        name: i.medicine_name,
        dosage: i.dosage,
        frequency: i.frequency,
        duration_days: i.duration_days,
      }));
      return {
        id: p.id,
        type: "prescription" as const,
        label: medications.map((m) => m.name).join(", "),
        hash: hashPrescription(medications),
      };
    }),
  ];
}

async function main() {
  if (process.env.BLOCKCHAIN_ENABLED !== "true") {
    throw new Error("BLOCKCHAIN_ENABLED isn't true in backend/.env.");
  }

  const counts = { anchored: 0, alreadyAnchored: 0, mismatched: 0, failed: 0 };
  for (const t of await loadTargets()) {
    const name = `${t.type} "${t.label}"`;
    try {
      const check = await verifyOnChain(t.id, t.hash);
      if (check.status === "verified") {
        counts.alreadyAnchored++;
        continue;
      }
      if (check.status === "mismatch") {
        counts.mismatched++;
        console.warn(`⚠ ${name}: on-chain hash differs from the current data (possible tampering), left as is`);
        continue;
      }

      // Not on this chain: any "confirmed" row we hold is from an old chain.
      await prisma.blockchain_transactions.deleteMany({
        where: t.type === "report" ? { report_id: t.id } : { prescription_id: t.id },
      });

      const { txHash } = await anchorHashOnChain({ recordId: t.id, fileHashHex: t.hash, recordType: t.type });
      counts.anchored++;
      console.log(`✓ ${name} anchored (${txHash.slice(0, 10)}…)`);
    } catch (e: any) {
      counts.failed++;
      console.error(`✗ ${name}: ${e?.message ?? e}`);
    }
  }

  console.log(
    `\nDone: ${counts.anchored} anchored, ${counts.alreadyAnchored} already anchored, ` +
      `${counts.mismatched} mismatched, ${counts.failed} failed.`
  );
}

main()
  .catch((err) => {
    console.error(err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
