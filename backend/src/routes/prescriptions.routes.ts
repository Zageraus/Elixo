import { Router, Request } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, withAuditUser } from "../config/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { hashPrescription, anchorHashOnChain, checkOnChain } from "../services/blockchain.service.js";
import { paginated, parsePage } from "../utils/pagination.js";

const router = Router();
router.use(requireAuth);

/** Same rule as the old RLS policy: the patient, the prescribing doctor, or an admin. */
function visibleTo(req: Request): Prisma.prescriptionsWhereInput {
  if (req.auth!.app_role === "admin") return {};
  const me = req.auth!.app_user_id;
  return { OR: [{ patient_id: me }, { doctor_id: me }] };
}

const PRESCRIPTION_INCLUDE = {
  items: { orderBy: { line_no: "asc" } },
  patient: { select: { full_name: true } },
  doctor: { select: { full_name: true } },
  blockchain_transactions: { select: { tx_hash: true, status: true, block_number: true, chain: true } },
} satisfies Prisma.prescriptionsInclude;

type PrescriptionWithItems = Prisma.prescriptionsGetPayload<{ include: typeof PRESCRIPTION_INCLUDE }>;

/** Medicines in their original order, in the shape the frontend and hash use. */
const medicationsOf = (items: { medicine_name: string; dosage: string; frequency: string; duration_days: number }[]) =>
  items.map((i) => ({ name: i.medicine_name, dosage: i.dosage, frequency: i.frequency, duration_days: i.duration_days }));

function toResponse({ items, patient, doctor, ...p }: PrescriptionWithItems) {
  return {
    ...p,
    medications: medicationsOf(items),
    patient_name: patient.full_name,
    doctor_name: doctor.full_name,
  };
}

// GET /api/prescriptions?page=&page_size=  -> newest first, paginated
router.get("/", async (req, res) => {
  const page = parsePage(req);
  const where = visibleTo(req);

  const [rows, total] = await Promise.all([
    prisma.prescriptions.findMany({
      where,
      include: PRESCRIPTION_INCLUDE,
      orderBy: { issued_at: "desc" },
      skip: page.skip,
      take: page.take,
    }),
    prisma.prescriptions.count({ where }),
  ]);

  res.json(paginated(rows.map(toResponse), total, page));
});

/**
 * GET /api/prescriptions/:id/verify
 * Re-hashes the medications as stored now and compares them with the hash
 * recorded when anchoring and with the hash held on-chain.
 */
router.get("/:id/verify", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Invalid prescription ID." });

  const rx = await prisma.prescriptions.findFirst({
    where: { id: id.data, ...visibleTo(req) },
    select: {
      id: true,
      items: { orderBy: { line_no: "asc" } },
      blockchain_transactions: { select: { data_hash: true, status: true } },
    },
  });
  if (!rx) return res.status(404).json({ error: "Not found or not authorized" });

  const computedHash = hashPrescription(medicationsOf(rx.items));
  const confirmed = rx.blockchain_transactions.find((t) => t.status === "confirmed");

  res.json({
    recorded_hash: confirmed?.data_hash ?? null,
    computed_hash: computedHash,
    chain: await checkOnChain(rx.id, computedHash),
  });
});

const medicationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  dosage: z.string().trim().min(1).max(100),
  frequency: z.string().trim().min(1).max(200),
  duration_days: z.number().int().positive().max(3650),
});

/**
 * POST /api/prescriptions
 * Calls the stored procedure sp_create_prescription (migration 012), which
 * inserts the prescription and all its items. It runs inside a Prisma
 * transaction, so if any item is rejected nothing is saved.
 */
router.post("/", requireRole("doctor", "admin"), async (req, res) => {
  const schema = z.object({
    appointment_id: z.string().uuid().optional(),
    patient_id: z.string().uuid(),
    medications: z.array(medicationSchema).min(1).max(30),
    notes: z.string().max(2000).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const me = req.auth!.app_user_id;
  const { patient_id, appointment_id, medications, notes } = parsed.data;

  const prescription = await withAuditUser(me, async (tx) => {
    const [created] = await tx.$queryRaw<{ p_prescription_id: string }[]>`
      call sp_create_prescription(
        ${me}::uuid, ${patient_id}::uuid, ${appointment_id ?? null}::uuid,
        ${notes ?? null}, ${JSON.stringify(medications)}::jsonb, null)`;
    return tx.prescriptions.findUniqueOrThrow({
      where: { id: created.p_prescription_id },
      include: PRESCRIPTION_INCLUDE,
    });
  });

  // Blockchain anchoring is optional.
  let blockchain: {
    txHash?: string;
    blockNumber?: number;
    status?: string;
    error?: string;
  };

  if (process.env.BLOCKCHAIN_ENABLED === "true") {
    try {
      blockchain = await anchorHashOnChain({
        recordId: prescription.id,
        fileHashHex: hashPrescription(medicationsOf(prescription.items)),
        recordType: "prescription",
      });
    } catch (e: unknown) {
      blockchain = {
        error: e instanceof Error ? e.message : "Blockchain anchoring failed",
      };
    }
  } else {
    blockchain = { status: "disabled" };
  }

  return res.status(201).json({ prescription: toResponse(prescription), blockchain });
});

export default router;
