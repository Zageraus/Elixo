import { Router } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "../config/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

/**
 * POST /api/payments  { appointment_id, method }
 * Simulated checkout: no gateway is called and no card details are taken.
 * The amount always comes from the doctor's consultation fee on the server,
 * never from the client. A patient can pay once the doctor has accepted
 * (confirmed) or completed the appointment.
 */
router.post("/", requireRole("patient"), async (req, res) => {
  const schema = z.object({
    appointment_id: z.string().uuid(),
    method: z.enum(["upi", "card", "netbanking"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { data: appt, error: apptErr } = await supabaseAdmin
    .from("appointments")
    .select("id, patient_id, doctor_id, status")
    .eq("id", parsed.data.appointment_id)
    .maybeSingle();
  if (apptErr) return res.status(500).json({ error: apptErr.message });
  if (!appt || appt.patient_id !== req.auth!.app_user_id) {
    return res.status(404).json({ error: "Appointment not found." });
  }
  if (appt.status !== "confirmed" && appt.status !== "completed") {
    return res.status(409).json({ error: "You can pay once the doctor has accepted the appointment." });
  }

  const { data: profile, error: profErr } = await supabaseAdmin
    .from("doctor_profiles")
    .select("consultation_fee")
    .eq("user_id", appt.doctor_id)
    .maybeSingle();
  if (profErr) return res.status(500).json({ error: profErr.message });
  const fee = profile?.consultation_fee === null || profile?.consultation_fee === undefined ? 0 : Number(profile.consultation_fee);
  if (!(fee > 0)) return res.status(409).json({ error: "This doctor hasn't set a consultation fee." });

  const { data: payment, error: payErr } = await supabaseAdmin
    .from("payments")
    .insert({
      appointment_id: appt.id,
      patient_id: appt.patient_id,
      doctor_id: appt.doctor_id,
      amount: fee,
      method: parsed.data.method,
      provider_ref: `SIM-${randomBytes(5).toString("hex").toUpperCase()}`,
    })
    .select("status, amount, currency, method, provider_ref, paid_at, refunded_at")
    .single();

  if (payErr) {
    if (payErr.code === "23505") return res.status(409).json({ error: "This appointment is already paid." });
    return res.status(500).json({ error: payErr.message });
  }

  return res.status(201).json({ ...payment, amount: Number(payment.amount) });
});

export default router;
