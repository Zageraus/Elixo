"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getUser, MedicationItem, DoctorOption } from "../../lib/api";
import {
  formatINR,
  PAYMENT_METHOD_LABELS,
  PaymentMethod,
  PaymentSummary,
} from "../../lib/payments";
import DashboardHeader from "../../components/DashboardHeader";
import VerifyIntegrity from "../../components/VerifyIntegrity";
import { chainLabel, explorerTxUrl, shortHash } from "../../lib/chain";

interface PrescriptionRecord {
  id: string;
  patient_id: string;
  appointment_id?: string;
  doctor_id: string;
  medications: MedicationItem[];
  notes?: string;
  issued_at: string;
  doctor_name?: string | null;
  blockchain_transactions?: {
    tx_hash: string;
    chain?: string;
    status: string;
    block_number?: number;
  }[];
}

function SkeletonCard() {
  return (
    <div className="glass-card rounded-2xl p-5 border border-zinc-800/80 animate-pulse space-y-3">
      <div className="flex items-center justify-between">
        <div className="h-3 w-24 bg-zinc-800 rounded-full" />
        <div className="h-8 w-8 bg-zinc-800 rounded-xl" />
      </div>
      <div className="h-8 w-16 bg-zinc-800 rounded-lg" />
      <div className="h-2.5 w-28 bg-zinc-800 rounded-full" />
    </div>
  );
}

function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="p-10 flex flex-col items-center gap-3 text-center">
      <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-2xl">
        {icon}
      </div>
      <p className="text-sm font-semibold text-zinc-300">{title}</p>
      <p className="text-xs text-zinc-500 max-w-xs leading-relaxed">{subtitle}</p>
    </div>
  );
}

export default function PatientDashboard() {
  const [user, setUser] = useState<any>(null);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{
    type: "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [specializationFilter, setSpecializationFilter] = useState("");
  const [checkoutAppt, setCheckoutAppt] = useState<any | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("upi");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PaymentSummary | null>(null);
  const [openingFileId, setOpeningFileId] = useState<string | null>(null);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [doctorsLoading, setDoctorsLoading] = useState(true);
  const [doctorsFailed, setDoctorsFailed] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookingMessage, setBookingMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const router = useRouter();

  useEffect(() => {
    const authed = getUser();
    // The doctor-list and booking endpoints are patient-only, so send
    // signed-out users to login and other roles to their own dashboard.
    if (!authed) {
      router.replace("/");
      return;
    }
    if (authed.role !== "patient") {
      router.replace(authed.role === "doctor" ? "/doctor" : "/admin");
      return;
    }
    setUser(authed);

    Promise.allSettled([
      api.getAppointments(),
      api.getReports(),
      api.getPrescriptions(),
      api.getDoctors(),
    ]).then(([appts, rpts, presc, docs]) => {
      if (appts.status === "fulfilled") setAppointments(appts.value);
      if (rpts.status === "fulfilled") setReports(rpts.value);
      if (presc.status === "fulfilled") setPrescriptions(presc.value);
      if (docs.status === "fulfilled") setDoctors(docs.value);
      else {
        console.error("Could not load doctors:", docs.reason);
        setDoctorsFailed(true);
        setBookingMessage({
          type: "error",
          text: `Could not load doctors: ${docs.reason?.message ?? "unknown error"}`,
        });
      }
      setLoading(false);
      setDoctorsLoading(false);
    });
  }, [router]);

  const handleBookAppointment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBooking(true);
    setBookingMessage(null);
    // React clears e.currentTarget once the handler awaits, so keep the element.
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const doctorId = String(form.get("doctor_id") || "").trim();
    const localDateTime = String(form.get("scheduled_at") || "");
    const reason = String(form.get("reason") || "").trim();

    if (!doctorId || !localDateTime) {
      setBookingMessage({ type: "error", text: "Choose a doctor and an appointment date and time." });
      setBooking(false);
      return;
    }

    try {
      await api.createAppointment({
        doctor_id: doctorId,
        scheduled_at: new Date(localDateTime).toISOString(),
        ...(reason ? { reason } : {}),
      });
      setAppointments(await api.getAppointments());
      setBookingMessage({
        type: "success",
        text: "Appointment request submitted successfully. Your request is pending until the doctor responds.",
      });
      formEl.reset();
    } catch (err: any) {
      setBookingMessage({
        type: "error",
        text: err?.message ?? "Could not book the appointment. Please try again.",
      });
    } finally {
      setBooking(false);
    }
  };

  const openCheckout = (appt: any) => {
    setCheckoutAppt(appt);
    setPayMethod("upi");
    setPayError(null);
    setReceipt(null);
  };

  const closeCheckout = () => {
    if (paying) return;
    setCheckoutAppt(null);
  };

  const handlePay = async () => {
    if (!checkoutAppt) return;
    setPaying(true);
    setPayError(null);
    try {
      const payment = await api.payForAppointment(checkoutAppt.appointment_id, payMethod);
      setReceipt(payment);
      setAppointments((prev) =>
        prev.map((a) =>
          a.appointment_id === checkoutAppt.appointment_id ? { ...a, payment } : a
        )
      );
    } catch (err: any) {
      setPayError(err?.message ?? "Payment failed. Please try again.");
    } finally {
      setPaying(false);
    }
  };

  const openReportFile = async (reportId: string) => {
    // Open the tab during the click so popup blockers allow it, then point
    // it at the signed link once the backend returns one.
    const tab = window.open("", "_blank");
    setOpeningFileId(reportId);
    setFileErrors((prev) => {
      const { [reportId]: _, ...rest } = prev;
      return rest;
    });
    try {
      const { url } = await api.getReportFileUrl(reportId);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (err: any) {
      tab?.close();
      setFileErrors((prev) => ({ ...prev, [reportId]: err?.message ?? "Could not open the file." }));
    } finally {
      setOpeningFileId(null);
    }
  };

  const handleUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setUploading(true);
    setUploadMessage(null);
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    try {
      const result = await api.uploadReport(form);
      const updatedReports = await api.getReports();
      setReports(updatedReports);

      // Describe each step as it actually went: the file is saved either
      // way, but AI and anchoring can be skipped, off, or fail on their own.
      const parts = ["Report uploaded."];
      let hadProblem = false;
      if (result.ai_analysis) {
        parts.push("AI summary added below.");
      } else if (result.ai_error) {
        parts.push(`AI summary failed: ${result.ai_error}`);
        hadProblem = true;
      } else {
        parts.push("No report text was given, so there's no AI summary.");
      }
      if (result.blockchain && "txHash" in result.blockchain) {
        parts.push(
          `Anchored on ${chainLabel(result.blockchain.chain)} (tx ${shortHash(result.blockchain.txHash)}).`
        );
      } else if (result.blockchain_error) {
        parts.push(`Blockchain anchoring failed: ${result.blockchain_error}`);
        hadProblem = true;
      } else {
        parts.push("Blockchain anchoring is turned off, so it wasn't anchored.");
      }

      setUploadMessage({ type: hadProblem ? "warning" : "success", text: parts.join(" ") });
      formEl.reset();
    } catch (err: any) {
      console.error(err);
      setUploadMessage({
        type: "error",
        text: err.message ?? "Upload failed. Please try again.",
      });
    } finally {
      setUploading(false);
    }
  };

  const specializations = Array.from(
    new Set(doctors.map((d) => d.specialization).filter((s): s is string => Boolean(s)))
  ).sort();
  const filteredDoctors = specializationFilter
    ? doctors.filter((d) => d.specialization === specializationFilter)
    : doctors;

  const statCards = [
    {
      label: "Appointments",
      value: appointments.length,
      sub: "Scheduled visits",
      icon: "📅",
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      border: "border-blue-500/20",
      hoverBorder: "hover:border-blue-500/40",
    },
    {
      label: "Prescriptions",
      value: prescriptions.length,
      sub: "Active medications",
      icon: "💊",
      color: "text-purple-400",
      bg: "bg-purple-500/10",
      border: "border-purple-500/20",
      hoverBorder: "hover:border-purple-500/40",
    },
    {
      label: "Reports",
      value: reports.length,
      sub: "AI-analyzed files",
      icon: "📑",
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
      hoverBorder: "hover:border-emerald-500/40",
    },
    {
      label: "Audit Trail",
      value: "Sepolia",
      sub: "100% tamper-proof",
      icon: "⛓️",
      color: "text-pink-400",
      bg: "bg-pink-500/10",
      border: "border-pink-500/20",
      hoverBorder: "hover:border-pink-500/40",
    },
  ];

  return (
    <div className="min-h-screen bg-[#030712] text-zinc-100 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-8">
      <DashboardHeader
        role="patient"
        walletAddress={user?.wallet_address}
        fullName={user?.full_name}
      />

      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/5 border border-purple-500/30 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(147,51,234,0.08),transparent_60%)] pointer-events-none" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Private Health Records · Audit-Ready</span>
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black bg-gradient-to-r from-blue-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
              Welcome back, {user?.full_name?.split(" ")[0] || "Patient"} 👋
            </h1>
            <p className="text-zinc-400 text-sm mt-2 max-w-xl leading-relaxed">
              View your appointments, prescriptions, and AI-analyzed medical
              reports — all cryptographically anchored on Ethereum Sepolia.
            </p>
          </div>
          <div className="hidden md:flex items-center justify-center w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/30 text-3xl flex-shrink-0">
            🩺
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          : statCards.map((s, idx) => (
              <div
                key={idx}
                className={`glass-card rounded-2xl p-5 border border-zinc-800/80 ${s.hoverBorder} transition-all duration-300 group`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider leading-tight">
                    {s.label}
                  </span>
                  <div
                    className={`w-9 h-9 rounded-xl ${s.bg} border ${s.border} ${s.color} flex items-center justify-center text-sm group-hover:scale-110 transition-transform flex-shrink-0`}
                  >
                    {s.icon}
                  </div>
                </div>
                <p className={`text-2xl sm:text-3xl font-extrabold ${s.color}`}>
                  {s.value}
                </p>
                <span className="text-[11px] text-zinc-500 mt-1 block">
                  {s.sub}
                </span>
              </div>
            ))}
      </div>

      {/* Book Appointment */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center text-sm">
              🗓️
            </span>
            Book an Appointment
          </h2>
          <p className="text-xs text-zinc-500 mt-1 ml-10">
            Choose a doctor, select a time, and submit your appointment request.
          </p>
        </div>

        <form
          onSubmit={handleBookAppointment}
          className="glass-card border border-zinc-800/80 rounded-2xl p-6 shadow-xl space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4">
            <div>
              <label htmlFor="specialization_filter" className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Specialization
              </label>
              <select
                id="specialization_filter"
                value={specializationFilter}
                onChange={(e) => setSpecializationFilter(e.target.value)}
                disabled={doctorsLoading || specializations.length === 0}
                className="w-full glass-input rounded-xl p-3 text-sm bg-zinc-900/80 focus:ring-1 focus:ring-cyan-500 focus:outline-none disabled:opacity-60"
              >
                <option value="">All specializations</option>
                {specializations.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="doctor_id" className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Doctor <span className="text-red-400">*</span>
              </label>
              <select
                // Remount when the filter changes so a doctor hidden by the
                // filter can't stay selected.
                key={specializationFilter}
                id="doctor_id"
                name="doctor_id"
                required
                defaultValue=""
                disabled={doctorsLoading || filteredDoctors.length === 0}
                className="w-full glass-input rounded-xl p-3 text-sm bg-zinc-900/80 focus:ring-1 focus:ring-cyan-500 focus:outline-none disabled:opacity-60"
              >
                <option value="" disabled>
                  {doctorsLoading ? "Loading doctors…" : filteredDoctors.length ? "Select a doctor" : "No doctors available"}
                </option>
                {filteredDoctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.full_name || "Doctor"}
                    {doctor.specialization ? ` · ${doctor.specialization}` : ""}
                  </option>
                ))}
              </select>
              {!doctorsLoading && !doctorsFailed && doctors.length === 0 && (
                <p className="text-[11px] text-amber-400 mt-1.5">
                  No doctors are registered yet.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="scheduled_at" className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Date and time <span className="text-red-400">*</span>
              </label>
              <input
                id="scheduled_at"
                name="scheduled_at"
                type="datetime-local"
                required
                min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                className="w-full glass-input rounded-xl p-3 text-sm bg-zinc-900/80 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="reason" className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Reason for visit <span className="text-zinc-500 font-normal">(optional)</span>
              </label>
              <input
                id="reason"
                name="reason"
                maxLength={500}
                placeholder="e.g. Follow-up consultation"
                className="w-full glass-input rounded-xl p-3 text-sm bg-zinc-900/80 focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          {bookingMessage && (
            <div
              role="status"
              className={`p-3.5 rounded-xl text-xs font-medium border ${
                bookingMessage.type === "success"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : "bg-red-500/10 border-red-500/30 text-red-400"
              }`}
            >
              {bookingMessage.text}
            </div>
          )}

          <button
            type="submit"
            disabled={booking || doctorsLoading || doctors.length === 0}
            className="rounded-xl bg-gradient-to-r from-cyan-700 via-blue-600 to-purple-600 hover:from-cyan-600 hover:to-purple-500 text-white px-6 py-3 text-xs font-semibold disabled:opacity-50 shadow-lg transition-all"
          >
            {booking ? "Submitting request…" : "Request Appointment"}
          </button>
        </form>
      </section>

      {/* Upcoming Appointments */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center text-sm">
              📅
            </span>
            Appointments
          </h2>
          <span className="text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-full font-medium">
            {appointments.length} scheduled
          </span>
        </div>

        <div className="glass-card rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/60 overflow-hidden shadow-xl">
          {loading ? (
            <div className="p-6 space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center justify-between animate-pulse">
                  <div className="space-y-2">
                    <div className="h-3.5 w-32 bg-zinc-800 rounded-full" />
                    <div className="h-2.5 w-48 bg-zinc-800 rounded-full" />
                  </div>
                  <div className="h-6 w-20 bg-zinc-800 rounded-full" />
                </div>
              ))}
            </div>
          ) : appointments.length === 0 ? (
            <EmptyState
              icon="📅"
              title="No upcoming appointments"
              subtitle="Your scheduled visits with doctors will appear here once booked."
            />
          ) : (
            appointments.map((a) => (
              <div
                key={a.appointment_id}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-900/40 transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-bold text-white text-sm">
                      {a.doctor_name}
                    </span>
                    {a.specialization && (
                      <span className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded-full font-medium">
                        {a.specialization}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    {new Date(a.scheduled_at).toLocaleString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <div className="self-start sm:self-auto flex flex-col items-start sm:items-end gap-2">
                  <span
                    className={`text-xs px-3 py-1 rounded-full font-semibold capitalize border ${
                      a.appointment_status === "confirmed"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                        : a.appointment_status === "completed"
                        ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                        : a.appointment_status === "cancelled" || a.appointment_status === "no_show"
                        ? "bg-red-500/10 text-red-400 border-red-500/30"
                        : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                    }`}
                  >
                    {a.appointment_status}
                  </span>
                  {a.payment?.status === "paid" ? (
                    <span className="text-[11px] text-emerald-400">
                      Paid {formatINR(a.payment.amount)} ·{" "}
                      <span className="font-mono text-zinc-500">{a.payment.provider_ref}</span>
                    </span>
                  ) : a.payment?.status === "refunded" ? (
                    <span className="text-[11px] text-zinc-400">
                      Refunded {formatINR(a.payment.amount)}
                    </span>
                  ) : a.fee > 0 &&
                    (a.appointment_status === "confirmed" || a.appointment_status === "completed") ? (
                    <button
                      type="button"
                      onClick={() => openCheckout(a)}
                      className="text-xs font-semibold px-4 py-1.5 rounded-xl bg-gradient-to-r from-cyan-600 to-purple-600 text-white shadow-md hover:brightness-110 transition"
                    >
                      Pay {formatINR(a.fee)}
                    </button>
                  ) : a.fee > 0 && a.appointment_status === "requested" ? (
                    <span className="text-[11px] text-zinc-500">
                      Fee {formatINR(a.fee)} · pay after the doctor accepts
                    </span>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Prescriptions */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center text-sm">
              💊
            </span>
            Prescriptions
            <span className="text-xs bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2.5 py-0.5 rounded-full font-semibold">
              Sepolia Verified
            </span>
          </h2>
          <span className="text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-full font-medium">
            {prescriptions.length} issued
          </span>
        </div>

        <div className="space-y-3.5">
          {loading ? (
            <div className="glass-card rounded-2xl border border-zinc-800/80 p-6 animate-pulse space-y-3">
              <div className="h-3 w-40 bg-zinc-800 rounded-full" />
              <div className="flex gap-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-8 w-28 bg-zinc-800 rounded-xl" />
                ))}
              </div>
            </div>
          ) : prescriptions.length === 0 ? (
            <div className="glass-card rounded-2xl border border-zinc-800/80 overflow-hidden">
              <EmptyState
                icon="💊"
                title="No prescriptions on file"
                subtitle="Prescriptions issued by your doctor will appear here, each anchored to the Sepolia blockchain."
              />
            </div>
          ) : (
            prescriptions.map((p) => {
              const tx = p.blockchain_transactions?.find(
                (t) => t.status === "confirmed"
              );
              const txHash = tx?.tx_hash;
              const txUrl = txHash ? explorerTxUrl(tx?.chain, txHash) : null;
              return (
                <div
                  key={p.id}
                  className="glass-card rounded-2xl p-5 border border-zinc-800/80 hover:border-purple-500/30 transition-all duration-300 space-y-4 shadow-xl"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs border-b border-zinc-800/60 pb-3">
                    <span className="text-zinc-400">
                      Prescribed on{" "}
                      <span className="font-semibold text-white">
                        {new Date(p.issued_at).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </span>
                      {p.doctor_name && (
                        <>
                          {" "}by{" "}
                          <span className="font-semibold text-white">{p.doctor_name}</span>
                        </>
                      )}
                    </span>
                    <span className="text-[11px] font-mono text-zinc-600">
                      Ref: {p.id.slice(0, 8)}
                    </span>
                  </div>

                  <div>
                    <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
                      Medications
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {Array.isArray(p.medications) &&
                      p.medications.length > 0 ? (
                        p.medications.map((m, idx) => (
                          <div
                            key={idx}
                            className="px-3 py-1.5 bg-zinc-900/90 border border-zinc-700/80 rounded-xl text-xs flex items-center gap-1.5"
                          >
                            <span className="font-bold text-purple-300">
                              {m.name}
                            </span>
                            <span className="text-zinc-500">·</span>
                            <span className="text-zinc-400">{m.dosage}</span>
                            <span className="text-zinc-500">·</span>
                            <span className="text-blue-400">{m.frequency}</span>
                            <span className="text-zinc-600 text-[10px]">
                              {m.duration_days}d
                            </span>
                          </div>
                        ))
                      ) : (
                        <span className="text-xs text-zinc-500">
                          No medication data available
                        </span>
                      )}
                    </div>
                  </div>

                  {p.notes && (
                    <div className="text-xs text-zinc-300 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80">
                      <span className="font-semibold text-zinc-400 block mb-1">
                        Doctor&apos;s Instructions
                      </span>
                      {p.notes}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] text-zinc-500 flex-wrap gap-2 pt-1 border-t border-zinc-800/60">
                    {txHash ? (
                      <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Anchored on {chainLabel(tx?.chain)}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-zinc-500 font-medium">
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                        Not anchored on-chain
                      </span>
                    )}
                    {txHash &&
                      (txUrl ? (
                        <a
                          href={txUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 transition-colors"
                        >
                          tx: {shortHash(txHash)} ↗
                        </a>
                      ) : (
                        <span className="font-mono text-zinc-400">tx: {shortHash(txHash)}</span>
                      ))}
                  </div>
                  {txHash && <VerifyIntegrity kind="prescription" id={p.id} />}
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Medical Reports & AI Analysis */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center text-sm">
              📑
            </span>
            Medical Reports &amp; AI Analysis
          </h2>
          <span className="text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-full font-medium">
            {reports.length} report{reports.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="glass-card rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/60 overflow-hidden shadow-xl">
          {loading ? (
            <div className="p-6 space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="animate-pulse space-y-2">
                  <div className="h-3.5 w-44 bg-zinc-800 rounded-full" />
                  <div className="h-2.5 w-32 bg-zinc-800 rounded-full" />
                  <div className="h-12 w-full bg-zinc-800/60 rounded-xl" />
                </div>
              ))}
            </div>
          ) : reports.length === 0 ? (
            <EmptyState
              icon="📑"
              title="No reports uploaded yet"
              subtitle="Use the form below to upload a document. Include its text to get an AI summary."
            />
          ) : (
            reports.map((r) => (
              <div
                key={r.report_id}
                className="p-5 space-y-3 hover:bg-zinc-900/30 transition-colors"
              >
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h3 className="font-bold text-white text-sm">{r.title}</h3>
                    <span className="text-[11px] text-zinc-500 capitalize mt-0.5 block">
                      {r.report_type?.replace(/_/g, " ")}
                    </span>
                  </div>
                  {(() => {
                    // blockchain_status is null when no anchoring was attempted
                    // (e.g. BLOCKCHAIN_ENABLED is off), which is not "pending".
                    const badge =
                      r.blockchain_status === "confirmed"
                        ? { label: "Anchored", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" }
                        : r.blockchain_status === "pending"
                        ? { label: "Anchoring…", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30" }
                        : r.blockchain_status === "failed"
                        ? { label: "Anchoring failed", cls: "bg-red-500/10 text-red-400 border-red-500/30" }
                        : { label: "Not anchored", cls: "bg-zinc-800 text-zinc-400 border-zinc-700" };
                    return (
                      <div className="flex-shrink-0 flex items-center gap-2">
                        {r.has_file && (
                          <button
                            type="button"
                            onClick={() => openReportFile(r.report_id)}
                            disabled={openingFileId === r.report_id}
                            className="text-xs px-3 py-1 rounded-full font-semibold border border-purple-500/30 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 transition disabled:opacity-50"
                          >
                            {openingFileId === r.report_id ? "Opening…" : "View PDF ↗"}
                          </button>
                        )}
                        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                    );
                  })()}
                </div>

                {fileErrors[r.report_id] && (
                  <p role="alert" className="text-[11px] text-red-400">
                    {fileErrors[r.report_id]}
                  </p>
                )}

                {!r.summary && (
                  <p className="text-[11px] text-zinc-500">
                    No AI summary: this report was uploaded without its text.
                  </p>
                )}

                {r.summary && (
                  <div className="bg-purple-950/20 border border-purple-500/25 rounded-xl p-3.5 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-300">
                      <span>🧠</span>
                      <span>AI Summary</span>
                    </div>
                    <p className="text-zinc-300 text-xs leading-relaxed">
                      {r.summary}
                    </p>
                  </div>
                )}

                {r.tx_hash && r.blockchain_status === "confirmed" && (
                  <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1 flex-wrap gap-2">
                    <span className="font-mono">
                      Hash:{" "}
                      <span className="text-zinc-400">
                        {r.file_hash?.slice(0, 16)}…
                      </span>
                    </span>
                    {explorerTxUrl(r.chain, r.tx_hash) ? (
                      <a
                        href={explorerTxUrl(r.chain, r.tx_hash)!}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 transition-colors"
                      >
                        View on Etherscan ↗
                      </a>
                    ) : (
                      <span className="font-mono text-zinc-400">
                        {chainLabel(r.chain)} · tx {shortHash(r.tx_hash)}
                      </span>
                    )}
                  </div>
                )}

                {r.blockchain_status === "confirmed" && (
                  <VerifyIntegrity kind="report" id={r.report_id} />
                )}
              </div>
            ))
          )}
        </div>
      </section>

      {/* Upload Form */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center text-sm">
              📤
            </span>
            Upload a Medical Report
          </h2>
          <p className="text-xs text-zinc-500 mt-1 ml-10">
            Your report will be AI-analyzed and cryptographically anchored on Sepolia.
          </p>
        </div>

        <form
          onSubmit={handleUpload}
          className="glass-card border border-zinc-800/80 rounded-2xl p-6 shadow-xl space-y-5"
        >
          <input type="hidden" name="patient_id" value={user?.id || ""} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Report Title <span className="text-red-400">*</span>
              </label>
              <input
                name="title"
                placeholder="e.g. Lipid Panel, CBC, MRI Scan"
                required
                className="w-full glass-input rounded-xl p-2.5 text-xs bg-zinc-900/80 focus:ring-1 focus:ring-purple-500 focus:outline-none transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Category
              </label>
              <select
                name="report_type"
                className="w-full glass-input rounded-xl p-2.5 text-xs bg-zinc-900/80 focus:ring-1 focus:ring-purple-500 focus:outline-none transition"
              >
                <option value="lab_result">Lab Result</option>
                <option value="imaging">Imaging</option>
                <option value="discharge_summary">Discharge Summary</option>
                <option value="consultation_note">Consultation Note</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              Report Content{" "}
              <span className="text-zinc-500 font-normal">(optional — paste lab values or notes for AI analysis)</span>
            </label>
            <textarea
              name="raw_text"
              placeholder="e.g. Cholesterol: 210 mg/dL, HDL: 45, LDL: 140, Triglycerides: 175…"
              className="w-full glass-input rounded-xl p-2.5 text-xs bg-zinc-900/80 focus:ring-1 focus:ring-purple-500 focus:outline-none transition"
              rows={3}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              Attach File <span className="text-zinc-500 font-normal">(PDF or image)</span>{" "}
              <span className="text-red-400">*</span>
            </label>
            <input
              type="file"
              name="file"
              required
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="w-full text-xs text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-purple-500/10 file:text-purple-300 hover:file:bg-purple-500/20 file:cursor-pointer cursor-pointer transition"
            />
          </div>

          {uploadMessage && (
            <div
              className={`p-3.5 rounded-xl text-xs font-medium border flex items-start gap-2.5 ${
                uploadMessage.type === "success"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                  : uploadMessage.type === "warning"
                  ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                  : "bg-red-500/10 border-red-500/30 text-red-400"
              }`}
            >
              <span>{uploadMessage.type === "success" ? "✅" : "⚠️"}</span>
              <span>{uploadMessage.text}</span>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              disabled={uploading}
              className="rounded-xl bg-gradient-to-r from-purple-700 via-indigo-600 to-blue-500 hover:from-purple-600 hover:to-blue-400 text-white px-6 py-2.5 text-xs font-semibold disabled:opacity-50 shadow-lg shadow-purple-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 flex items-center gap-2"
            >
              {uploading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Uploading &amp; Analyzing…</span>
                </>
              ) : (
                <>
                  <span>Upload &amp; Analyze</span>
                  <span>🧠</span>
                </>
              )}
            </button>
            {uploading && (
              <span className="text-[11px] text-zinc-500">
                AI analysis + blockchain anchoring may take 10–30s
              </span>
            )}
          </div>
        </form>
      </section>

      {/* Simulated checkout */}
      {checkoutAppt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={closeCheckout}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="checkout-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md glass-card rounded-3xl border border-zinc-800 bg-[#0b0f1a] p-6 space-y-5 shadow-2xl"
          >
            {receipt ? (
              <>
                <div className="text-center space-y-2">
                  <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 flex items-center justify-center text-xl">
                    ✓
                  </div>
                  <h2 id="checkout-title" className="text-lg font-bold text-white">
                    Payment successful
                  </h2>
                  <p className="text-3xl font-black text-white">{formatINR(receipt.amount)}</p>
                </div>
                <dl className="text-xs divide-y divide-zinc-800 rounded-xl border border-zinc-800">
                  {[
                    ["Receipt", receipt.provider_ref],
                    ["Doctor", checkoutAppt.doctor_name],
                    ["Method", PAYMENT_METHOD_LABELS[receipt.method]],
                    ["Paid on", new Date(receipt.paid_at).toLocaleString("en-IN")],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-4 px-4 py-2.5">
                      <dt className="text-zinc-500">{label}</dt>
                      <dd className="text-zinc-200 font-medium text-right">{value}</dd>
                    </div>
                  ))}
                </dl>
                <button
                  type="button"
                  onClick={closeCheckout}
                  className="w-full rounded-xl bg-zinc-800 hover:bg-zinc-700 py-3 text-sm font-semibold text-white transition"
                >
                  Done
                </button>
              </>
            ) : (
              <>
                <div>
                  <h2 id="checkout-title" className="text-lg font-bold text-white">
                    Pay consultation fee
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1">
                    {checkoutAppt.doctor_name} ·{" "}
                    {new Date(checkoutAppt.scheduled_at).toLocaleString("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>

                <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 p-4 flex items-center justify-between">
                  <span className="text-sm text-zinc-400">Amount</span>
                  <span className="text-2xl font-black text-white">{formatINR(checkoutAppt.fee)}</span>
                </div>

                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold text-zinc-300 mb-2">Payment method</legend>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={payMethod === m}
                        onClick={() => setPayMethod(m)}
                        className={`rounded-xl border py-2.5 text-xs font-semibold transition ${
                          payMethod === m
                            ? "border-cyan-500 bg-cyan-500/10 text-white"
                            : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                        }`}
                      >
                        {PAYMENT_METHOD_LABELS[m]}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <p className="text-[11px] text-amber-400/90 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
                  Test mode: no real money is charged and no payment details are collected.
                </p>

                {payError && (
                  <p role="alert" className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
                    {payError}
                  </p>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={closeCheckout}
                    disabled={paying}
                    className="flex-1 rounded-xl border border-zinc-700 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-900 transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handlePay}
                    disabled={paying}
                    className="flex-[2] rounded-xl bg-gradient-to-r from-cyan-600 to-purple-600 py-3 text-sm font-bold text-white shadow-lg hover:brightness-110 transition disabled:opacity-50"
                  >
                    {paying ? "Processing…" : `Pay ${formatINR(checkoutAppt.fee)}`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
