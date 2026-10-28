import { Router } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { withAuditUser } from "../config/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { PAYMENT_SUMMARY_SELECT } from "../services/payments.service.js";

const router = Router();
router.use(requireAuth);

class PaymentRejected extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * POST /api/payments  { appointment_id, method }
 * Simulated checkout: no gateway is called and no card details are taken.
 * The amount always comes from the doctor's consultation fee on the server,
 * never from the client. A patient can pay once the doctor has accepted
 * (confirmed) or completed the appointment.
 *
 * Runs as one transaction that locks the appointment row (SELECT ... FOR
 * UPDATE), so two simultaneous checkouts, or a doctor cancelling at the
 * same moment, can't both act on the same appointment.
 */
router.post("/", requireRole("patient"), async (req, res) => {
  const schema = z.object({
    appointment_id: z.string().uuid(),
    method: z.enum(["upi", "card", "netbanking"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const me = req.auth!.app_user_id;

  try {
    const payment = await withAuditUser(me, async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; patient_id: string; status: string }[]>`
        select id, patient_id, status::text as status
        from appointments
        where id = ${parsed.data.appointment_id}::uuid
        for update`;
      const appt = locked[0];
      if (!appt || appt.patient_id !== me) throw new PaymentRejected(404, "Appointment not found.");
      if (appt.status !== "confirmed" && appt.status !== "completed") {
        throw new PaymentRejected(409, "You can pay once the doctor has accepted the appointment.");
      }

      const details = await tx.appointments.findUniqueOrThrow({
        where: { id: appt.id },
        select: {
          payment: { select: { id: true } },
          doctor: { select: { doctor_profile: { select: { consultation_fee: true } } } },
        },
      });
      if (details.payment) throw new PaymentRejected(409, "This appointment is already paid.");

      const fee = Number(details.doctor.doctor_profile?.consultation_fee ?? 0);
      if (!(fee > 0)) throw new PaymentRejected(409, "This doctor hasn't set a consultation fee.");

      return tx.payments.create({
        data: {
          appointment_id: appt.id,
          amount: fee,
          method: parsed.data.method,
          provider_ref: `SIM-${randomBytes(5).toString("hex").toUpperCase()}`,
        },
        select: PAYMENT_SUMMARY_SELECT,
      });
    });

    res.status(201).json({ ...payment, amount: Number(payment.amount) });
  } catch (e) {
    if (e instanceof PaymentRejected) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

export default router;
