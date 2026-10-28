import { prisma, toNumber } from "../config/prisma.js";

export interface PaymentSummary {
  status: "paid" | "refunded";
  amount: number;
  currency: string;
  method: "upi" | "card" | "netbanking";
  provider_ref: string;
  paid_at: Date;
  refunded_at: Date | null;
}

export const PAYMENT_SUMMARY_SELECT = {
  status: true,
  amount: true,
  currency: true,
  method: true,
  provider_ref: true,
  paid_at: true,
  refunded_at: true,
} as const;

/**
 * Adds `fee` (the doctor's current consultation fee, or null if none is set)
 * and `payment` (or null) to each appointment row, using one joined query.
 * Callers must only pass rows the user is already allowed to see.
 */
export async function attachPayments<T extends { appointment_id: string }>(rows: T[]) {
  if (rows.length === 0) return [];

  const appts = await prisma.appointments.findMany({
    where: { id: { in: rows.map((r) => r.appointment_id) } },
    select: {
      id: true,
      doctor: { select: { doctor_profile: { select: { consultation_fee: true } } } },
      payment: { select: PAYMENT_SUMMARY_SELECT },
    },
  });
  const byId = new Map(appts.map((a) => [a.id, a]));

  return rows.map((r) => {
    const a = byId.get(r.appointment_id);
    return {
      ...r,
      fee: toNumber(a?.doctor.doctor_profile?.consultation_fee),
      payment: a?.payment ? ({ ...a.payment, amount: Number(a.payment.amount) } as PaymentSummary) : null,
    };
  });
}
