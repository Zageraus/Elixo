export type PaymentMethod = "upi" | "card" | "netbanking";

export interface PaymentSummary {
  status: "paid" | "refunded";
  amount: number;
  currency: string;
  method: PaymentMethod;
  provider_ref: string;
  paid_at: string;
  refunded_at: string | null;
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  upi: "UPI",
  card: "Card",
  netbanking: "Net banking",
};

export function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}
