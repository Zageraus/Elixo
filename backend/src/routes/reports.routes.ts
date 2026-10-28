import { Router, Request } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";
import { z } from "zod";
import { prisma, toNumber, withAuditUser } from "../config/prisma.js";
import { supabaseAdmin } from "../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { sha256Hex, anchorHashOnChain, checkOnChain } from "../services/blockchain.service.js";
import { analyzeReport } from "../services/ai.service.js";
import { paginated, parsePage } from "../utils/pagination.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

router.use(requireAuth);

/**
 * POST /api/reports
 * Full pipeline for a new medical report:
 *   1. Upload file bytes to Supabase Storage
 *   2. Insert the medical_reports row (only the patient, the assigned
 *      doctor or an admin may add a report)
 *   3. sha256 the file -> anchor on-chain (Workflow 3)
 *   4. If raw_text/extracted text is present -> run RAG analysis (Workflow 2)
 */
router.post("/", upload.single("file"), async (req, res) => {
  const schema = z.object({
    patient_id: z.string().uuid(),
    doctor_id: z.string().uuid().optional(),
    appointment_id: z.string().uuid().optional(),
    report_type: z.enum(["lab_result", "imaging", "discharge_summary", "consultation_note", "other"]),
    title: z.string().trim().min(1).max(200),
    raw_text: z.string().max(20000).optional(), // pre-extracted text (OCR done client-side or by a separate worker)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!req.file) return res.status(400).json({ error: "file is required" });

  const me = req.auth!.app_user_id;
  if (req.auth!.app_role !== "admin" && parsed.data.patient_id !== me && parsed.data.doctor_id !== me) {
    return res.status(403).json({ error: "You can only add reports for yourself or your own patients." });
  }

  const fileHash = sha256Hex(req.file.buffer);
  const storagePath = `reports/${parsed.data.patient_id}/${Date.now()}_${req.file.originalname}`;

  const { error: uploadErr } = await supabaseAdmin.storage.from("medical-reports").upload(storagePath, req.file.buffer, {
    contentType: req.file.mimetype,
  });
  if (uploadErr) return res.status(500).json({ error: uploadErr.message });

  const report = await withAuditUser(me, (tx) =>
    tx.medical_reports.create({
      data: { ...parsed.data, raw_text: parsed.data.raw_text || null, file_url: storagePath, file_hash: fileHash },
    })
  );

  // Fire-and-report: anchor on-chain + AI analysis. In production these
  // would be queued (e.g. via a job table + worker) rather than awaited
  // inline, but sync here keeps the demo/grading flow simple to trace.
  const results: Record<string, unknown> = { report };

  if (process.env.BLOCKCHAIN_ENABLED === "true") {
    try {
      results.blockchain = await anchorHashOnChain({
        recordId: report.id,
        fileHashHex: fileHash,
        recordType: "report",
      });
    } catch (e: any) {
      results.blockchain_error = e.message;
    }
  } else {
    results.blockchain = { status: "disabled" };
  }

  if (parsed.data.raw_text) {
    try {
      results.ai_analysis = await analyzeReport({
        reportId: report.id,
        patientId: parsed.data.patient_id,
        reportText: parsed.data.raw_text,
      });
    } catch (e: any) {
      results.ai_error = e.message;
    }
  }

  res.status(201).json(results);
});

type ReportViewRow = {
  report_id: string;
  patient_id: string;
  doctor_id: string | null;
  title: string;
  report_type: string;
  file_hash: string;
  report_created_at: Date;
  summary: string | null;
  findings: unknown;
  confidence: Prisma.Decimal | null;
  model_used: string | null;
  tx_hash: string | null;
  blockchain_status: string | null;
  block_number: bigint | null;
  chain: string | null;
};

/**
 * Access rule for reports (same as the p_reports_select RLS policy): admins
 * see everything, everyone else only reports where they are the patient or
 * the assigned doctor. Returned as SQL for the view query below.
 */
function reportAccessSql(req: Request): Prisma.Sql {
  if (req.auth!.app_role === "admin") return Prisma.sql`true`;
  const me = req.auth!.app_user_id;
  return Prisma.sql`(patient_id = ${me}::uuid or doctor_id = ${me}::uuid)`;
}

function reportAccessWhere(req: Request): Prisma.medical_reportsWhereInput {
  if (req.auth!.app_role === "admin") return {};
  const me = req.auth!.app_user_id;
  return { OR: [{ patient_id: me }, { doctor_id: me }] };
}

/** Reads v_report_with_analysis (migration 011) for the reports this user may see. */
async function reportsFromView(req: Request, extra: Prisma.Sql, limit?: { take: number; skip: number }) {
  const page = limit ? Prisma.sql`limit ${limit.take} offset ${limit.skip}` : Prisma.empty;
  const rows = await prisma.$queryRaw<ReportViewRow[]>`
    select report_id, patient_id, doctor_id, title, report_type::text as report_type, file_hash,
           report_created_at, summary, findings, confidence, model_used, tx_hash,
           blockchain_status::text as blockchain_status, block_number, chain
    from v_report_with_analysis
    where ${reportAccessSql(req)} and ${extra}
    order by report_created_at desc
    ${page}`;
  return rows.map((r) => ({ ...r, confidence: toNumber(r.confidence) }));
}

const REPORTS_BUCKET = "medical-reports";
const SIGNED_URL_SECONDS = 60;

/**
 * Returns the ids of the given reports whose file actually exists in
 * storage (seeded demo reports only have text). Lists each patient folder
 * once rather than probing every file.
 */
async function reportsWithStoredFile(reportIds: string[]): Promise<Set<string>> {
  if (reportIds.length === 0) return new Set();
  const rows = await prisma.medical_reports.findMany({
    where: { id: { in: reportIds } },
    select: { id: true, file_url: true },
  });

  const folders = new Map<string, { id: string; name: string }[]>();
  for (const r of rows) {
    const slash = r.file_url.lastIndexOf("/");
    const folder = r.file_url.slice(0, slash);
    folders.set(folder, [...(folders.get(folder) ?? []), { id: r.id, name: r.file_url.slice(slash + 1) }]);
  }

  const stored = new Set<string>();
  await Promise.all(
    [...folders].map(async ([folder, files]) => {
      const { data } = await supabaseAdmin.storage.from(REPORTS_BUCKET).list(folder, { limit: 1000 });
      const names = new Set((data ?? []).map((f) => f.name));
      files.forEach((f) => names.has(f.name) && stored.add(f.id));
    })
  );
  return stored;
}

/** Loads a report the signed-in user may see, or null. */
function findVisibleReport(req: Request, id: string) {
  return prisma.medical_reports.findFirst({
    where: { id, ...reportAccessWhere(req) },
    select: { id: true, file_url: true, file_hash: true },
  });
}

/**
 * GET /api/reports/:id/file -> { url, expires_in }
 * Same access rule as the report itself (patient, assigned doctor, admin).
 * The bucket stays private; the link is signed and expires in a minute.
 */
router.get("/:id/file", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Invalid report ID." });

  const report = await findVisibleReport(req, id.data);
  if (!report) return res.status(404).json({ error: "Not found or not authorized" });

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from(REPORTS_BUCKET)
    .createSignedUrl(report.file_url, SIGNED_URL_SECONDS);
  if (signErr || !signed) {
    return res.status(404).json({ error: "No file is stored for this report." });
  }

  res.json({ url: signed.signedUrl, expires_in: SIGNED_URL_SECONDS });
});

/**
 * GET /api/reports/:id/verify
 * Re-hashes the stored file and compares it with (a) the hash recorded at
 * upload and (b) the hash anchored on-chain. Reports without a stored file
 * (seeded demo data) are checked on-chain using their recorded hash.
 */
router.get("/:id/verify", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Invalid report ID." });

  const report = await findVisibleReport(req, id.data);
  if (!report) return res.status(404).json({ error: "Not found or not authorized" });

  // Storage serves a cached copy for a while after an object is overwritten,
  // which would hide a swapped file. The unique query string bypasses it.
  const { data: blob } = await supabaseAdmin.storage
    .from(REPORTS_BUCKET)
    .download(`${report.file_url}?verify=${Date.now()}`);
  const computedHash = blob ? sha256Hex(Buffer.from(await blob.arrayBuffer())) : null;

  res.json({
    recorded_hash: report.file_hash,
    computed_hash: computedHash,
    file: computedHash === null ? "missing" : computedHash === report.file_hash ? "match" : "changed",
    chain: await checkOnChain(id.data, computedHash ?? report.file_hash),
  });
});

router.get("/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Invalid report ID." });

  const [report] = await reportsFromView(req, Prisma.sql`report_id = ${id.data}::uuid`);
  if (!report) return res.status(404).json({ error: "Not found or not authorized" });
  res.json(report);
});

// GET /api/reports?page=&page_size=  -> newest first, paginated
router.get("/", async (req, res) => {
  const page = parsePage(req);
  const [rows, total] = await Promise.all([
    reportsFromView(req, Prisma.sql`true`, page),
    prisma.medical_reports.count({ where: reportAccessWhere(req) }),
  ]);

  const stored = await reportsWithStoredFile(rows.map((r) => r.report_id));
  res.json(paginated(rows.map((r) => ({ ...r, has_file: stored.has(r.report_id) })), total, page));
});

export default router;
