import { supabaseAdmin } from "../config/supabase.js";

export interface PaymentSummary {
  status: "paid" | "refunded";
  amount: number;
  currency: string;
  method: "upi" | "card" | "netbanking";
  provider_ref: string;
  paid_at: string;
  refunded_at: string | null;
}

/**
 * Adds `fee` (the doctor's current consultation fee, or null if none is set)
 * and `payment` (or null) to each appointment row. Uses the admin client
 * because doctor_profiles and payments rows belong to other users; callers
 * must only pass rows the user is already allowed to see.
 */
export async function attachPayments<T extends { appointment_id: string }>(rows: T[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.appointment_id);

  const [{ data: appts, error: apptErr }, { data: payments, error: payErr }] = await Promise.all([
    supabaseAdmin.from("appointments").select("id, doctor_id").in("id", ids),
    supabaseAdmin
      .from("payments")
      .select("appointment_id, status, amount, currency, method, provider_ref, paid_at, refunded_at")
      .in("appointment_id", ids),
  ]);
  if (apptErr) throw apptErr;
  if (payErr) throw payErr;

  const doctorIds = [...new Set(appts.map((a) => a.doctor_id))];
  const { data: profiles, error: profErr } = await supabaseAdmin
    .from("doctor_profiles")
    .select("user_id, consultation_fee")
    .in("user_id", doctorIds);
  if (profErr) throw profErr;

  const feeByDoctor = new Map(profiles.map((p) => [p.user_id, p.consultation_fee === null ? null : Number(p.consultation_fee)]));
  const doctorByAppt = new Map(appts.map((a) => [a.id, a.doctor_id]));
  const paymentByAppt = new Map(payments.map(({ appointment_id, ...p }) => [appointment_id, { ...p, amount: Number(p.amount) } as PaymentSummary]));

  return rows.map((r) => ({
    ...r,
    fee: feeByDoctor.get(doctorByAppt.get(r.appointment_id)) ?? null,
    payment: paymentByAppt.get(r.appointment_id) ?? null,
  }));
}
