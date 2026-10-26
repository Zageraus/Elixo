
import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin, supabaseForRequest } from "../config/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { hashPrescription, anchorHashOnChain, checkOnChain } from "../services/blockchain.service.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const db = supabaseForRequest(req.rawJwt!);

  const { data, error } = await db
    .from("prescriptions")
    .select("*, blockchain_transactions(tx_hash, status, block_number, chain)")
    .order("issued_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  // Look names up with the admin client: users RLS hides other people's rows.
  const ids = [...new Set(data.flatMap((p) => [p.patient_id, p.doctor_id]))];
  const { data: people, error: peopleError } = await supabaseAdmin
    .from("users")
    .select("id, full_name")
    .in("id", ids);

  if (peopleError) return res.status(500).json({ error: peopleError.message });

  const names = new Map(people.map((u) => [u.id, u.full_name]));
  res.json(
    data.map((p) => ({
      ...p,
      patient_name: names.get(p.patient_id) ?? null,
      doctor_name: names.get(p.doctor_id) ?? null,
    }))
  );
});

/**
 * GET /api/prescriptions/:id/verify
 * Re-hashes the medications as stored now and compares them with the hash
 * recorded when anchoring and with the hash held on-chain.
 */
router.get("/:id/verify", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Invalid prescription ID." });

  // RLS-scoped: only the patient, prescribing doctor or an admin gets a row.
  const db = supabaseForRequest(req.rawJwt!);
  const { data: rx, error } = await db
    .from("prescriptions")
    .select("id, medications, blockchain_transactions(data_hash, status)")
    .eq("id", id.data)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!rx) return res.status(404).json({ error: "Not found or not authorized" });

  const computedHash = hashPrescription(rx.medications);
  const confirmed = (rx.blockchain_transactions as { data_hash: string; status: string }[]).find(
    (t) => t.status === "confirmed"
  );

  res.json({
    recorded_hash: confirmed?.data_hash ?? null,
    computed_hash: computedHash,
    chain: await checkOnChain(rx.id, computedHash),
  });
});

const medicationSchema = z.object({
  name: z.string(),
  dosage: z.string(),
  frequency: z.string(),
  duration_days: z.number().int().positive(),
});

router.post("/", requireRole("doctor", "admin"), async (req, res) => {
  const schema = z.object({
    appointment_id: z.string().uuid().optional(),
    patient_id: z.string().uuid(),
    medications: z.array(medicationSchema).min(1),
    notes: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const db = supabaseForRequest(req.rawJwt!);

  const { data: prescription, error } = await db
    .from("prescriptions")
    .insert({
      ...parsed.data,
      doctor_id: req.auth!.app_user_id,
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Blockchain anchoring is optional.
  let blockchain: {
    txHash?: string;
    blockNumber?: number;
    status?: string;
    error?: string;
  };

  if (process.env.BLOCKCHAIN_ENABLED === "true") {
    const contentHash = hashPrescription(parsed.data.medications);

    try {
      blockchain = await anchorHashOnChain({
        recordId: prescription.id,
        fileHashHex: contentHash,
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

  return res.status(201).json({ prescription, blockchain });
});

export default router;
