"use client";

import { useEffect, useState, useRef } from "react";
import { api, getUser, MedicationItem } from "../../lib/api";
import DashboardHeader from "../../components/DashboardHeader";
import { formatINR, PaymentSummary } from "../../lib/payments";

interface AppointmentItem {
  appointment_id: string;
  patient_id: string;
  patient_name: string;
  doctor_name: string;
  scheduled_at: string;
  status: string;
  patient_report_count: number;
  fee: number | null;
  payment: PaymentSummary | null;
}

interface PrescriptionRecord {
  id: string;
  patient_id: string;
  appointment_id?: string;
  doctor_id: string;
  medications: MedicationItem[];
  notes?: string;
  issued_at: string;
  patient_name?: string | null;
  blockchain_transactions?: {
    tx_hash: string;
    status: string;
    block_number?: number;
  }[];
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

export default function DoctorDashboard() {
  const [user, setUser] = useState<any>(null);
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [medications, setMedications] = useState<MedicationItem[]>([
    { name: "", dosage: "", frequency: "", duration_days: 7 },
  ]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<any | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const authed = getUser();
    if (authed) setUser(authed);
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [appts, presc] = await Promise.allSettled([
        api.getAppointments(),
        api.getPrescriptions(),
      ]);
      if (appts.status === "fulfilled") setAppointments(appts.value);
      if (presc.status === "fulfilled") setPrescriptions(presc.value);
    } catch (err) {
      console.error("Error loading doctor data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMedication = () => {
    setMedications((prev) => [
      ...prev,
      { name: "", dosage: "", frequency: "", duration_days: 7 },
    ]);
  };

  const handleRemoveMedication = (index: number) => {
    if (medications.length <= 1) return;
    setMedications((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMedChange = (
    index: number,
    field: keyof MedicationItem,
    value: any
  ) => {
    setMedications((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleUpdateStatus = async (
    appt: AppointmentItem,
    status: "confirmed" | "completed" | "cancelled"
  ) => {
    setUpdatingId(appt.appointment_id);
    setStatusError(null);
    try {
      await api.updateAppointmentStatus(appt.appointment_id, status);
      setAppointments((prev) =>
        prev.map((a) =>
          a.appointment_id === appt.appointment_id ? { ...a, status } : a
        )
      );
    } catch (err: any) {
      setStatusError(err.message || "Could not update the appointment.");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleStartPrescription = (appt: AppointmentItem) => {
    setSelectedPatientId(appt.patient_id);
    setSelectedAppointmentId(appt.appointment_id);
    setSubmitSuccess(null);
    setErrorMessage(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleSubmitPrescription = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitSuccess(null);

    if (!selectedPatientId) {
      setErrorMessage("Please select a patient before issuing a prescription.");
      return;
    }

    const validMeds = medications.filter(
      (m) =>
        m.name.trim() &&
        m.dosage.trim() &&
        m.frequency.trim() &&
        m.duration_days > 0
    );

    if (validMeds.length === 0) {
      setErrorMessage(
        "Please fill in at least one medication (name, dosage, frequency, and duration)."
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.createPrescription({
        patient_id: selectedPatientId,
        appointment_id: selectedAppointmentId || undefined,
        medications: validMeds,
        notes: notes.trim() || undefined,
      });
      setSubmitSuccess(res);
      setMedications([{ name: "", dosage: "", frequency: "", duration_days: 7 }]);
      setNotes("");
      setSelectedAppointmentId("");
      const refreshed = await api.getPrescriptions().catch(() => []);
      setPrescriptions(refreshed);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to create prescription. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const uniquePatients = Array.from(
    new Map(
      appointments.map((a) => [
        a.patient_id,
        { id: a.patient_id, name: a.patient_name },
      ])
    ).values()
  );

  return (
    <div className="min-h-screen bg-[#030712] text-zinc-100 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-8">
      <DashboardHeader
        role="doctor"
        walletAddress={user?.wallet_address}
        fullName={user?.full_name}
      />

      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/5 border border-purple-500/30 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(37,99,235,0.08),transparent_60%)] pointer-events-none" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-semibold mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span>Licensed Healthcare Provider · Secure Provider Portal</span>
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black bg-gradient-to-r from-blue-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
              Welcome back, Dr. {user?.full_name?.split(" ").slice(-1)[0] || "Doctor"} ⚕️
            </h1>
            <p className="text-zinc-400 text-sm mt-2 max-w-xl leading-relaxed">
              Review your patient queue, evaluate AI-generated report summaries,
              and issue tamper-evident prescriptions anchored to Ethereum Sepolia.
            </p>
          </div>
          <div className="hidden md:flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/30 text-3xl flex-shrink-0">
            ⚕️
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            label: "Patient Queue",
            value: appointments.length,
            sub: "Scheduled visits",
            icon: "📅",
            color: "text-blue-400",
            bg: "bg-blue-500/10",
            border: "border-blue-500/20",
            hover: "hover:border-blue-500/40",
          },
          {
            label: "Prescriptions Issued",
            value: prescriptions.length,
            sub: "Blockchain-anchored",
            icon: "💊",
            color: "text-purple-400",
            bg: "bg-purple-500/10",
            border: "border-purple-500/20",
            hover: "hover:border-purple-500/40",
          },
          {
            label: "Active Patients",
            value: uniquePatients.length,
            sub: "Under your care",
            icon: "👥",
            color: "text-emerald-400",
            bg: "bg-emerald-500/10",
            border: "border-emerald-500/20",
            hover: "hover:border-emerald-500/40",
          },
        ].map((s, idx) => (
          <div
            key={idx}
            className={`glass-card rounded-2xl p-5 border border-zinc-800/80 ${s.hover} transition-all duration-300 group`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                {s.label}
              </span>
              <div
                className={`w-9 h-9 rounded-xl ${s.bg} border ${s.border} ${s.color} flex items-center justify-center text-sm group-hover:scale-110 transition-transform`}
              >
                {s.icon}
              </div>
            </div>
            {loading ? (
              <div className="h-9 w-16 bg-zinc-800 rounded-lg animate-pulse" />
            ) : (
              <p className={`text-3xl font-extrabold ${s.color}`}>{s.value}</p>
            )}
            <span className="text-[11px] text-zinc-500 mt-1 block">{s.sub}</span>
          </div>
        ))}
      </div>

      {/* Patient Queue */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center text-sm">
              👥
            </span>
            Patient Queue
          </h2>
          <span className="text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-full font-medium">
            {appointments.length} appointment{appointments.length !== 1 ? "s" : ""}
          </span>
        </div>

        {statusError && (
          <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            {statusError}
          </div>
        )}

        <div className="glass-card rounded-2xl border border-zinc-800/80 divide-y divide-zinc-800/60 overflow-hidden shadow-xl">
          {loading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex items-center justify-between animate-pulse"
                >
                  <div className="space-y-2">
                    <div className="h-3.5 w-36 bg-zinc-800 rounded-full" />
                    <div className="h-2.5 w-52 bg-zinc-800 rounded-full" />
                  </div>
                  <div className="h-8 w-32 bg-zinc-800 rounded-xl" />
                </div>
              ))}
            </div>
          ) : appointments.length === 0 ? (
            <EmptyState
              icon="📋"
              title="No appointments scheduled"
              subtitle="Once patients book appointments with you, they'll appear here ready to prescribe."
            />
          ) : (
            appointments.map((a) => (
              <div
                key={a.appointment_id}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-900/40 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="font-bold text-white text-sm truncate">
                      {a.patient_name}
                    </span>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full capitalize font-medium border ${
                        a.status === "confirmed"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : a.status === "completed"
                          ? "bg-blue-500/10 text-blue-400 border-blue-500/30"
                          : a.status === "cancelled" || a.status === "no_show"
                          ? "bg-red-500/10 text-red-400 border-red-500/30"
                          : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                      }`}
                    >
                      {a.status}
                    </span>
                    {a.payment?.status === "paid" ? (
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-medium border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                        Paid {formatINR(a.payment.amount)}
                      </span>
                    ) : a.payment?.status === "refunded" ? (
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-medium border bg-zinc-800 text-zinc-400 border-zinc-700">
                        Refunded
                      </span>
                    ) : (a.status === "confirmed" || a.status === "completed") && (a.fee ?? 0) > 0 ? (
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-medium border bg-amber-500/10 text-amber-400 border-amber-500/30">
                        Awaiting payment
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    {new Date(a.scheduled_at).toLocaleString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {a.patient_report_count > 0 && (
                      <span className="ml-2 text-zinc-500">
                        · {a.patient_report_count} report
                        {a.patient_report_count !== 1 ? "s" : ""} on file
                      </span>
                    )}
                  </p>
                </div>

                <div className="self-start sm:self-auto flex flex-wrap items-center gap-2 flex-shrink-0">
                {a.status === "requested" && (
                  <>
                    <button
                      type="button"
                      disabled={updatingId === a.appointment_id}
                      onClick={() => handleUpdateStatus(a, "confirmed")}
                      className="text-xs font-semibold px-4 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 transition-all duration-200 disabled:opacity-50"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={updatingId === a.appointment_id}
                      onClick={() => handleUpdateStatus(a, "cancelled")}
                      className="text-xs font-semibold px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-all duration-200 disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </>
                )}
                {a.status === "confirmed" && (
                  <button
                    type="button"
                    disabled={updatingId === a.appointment_id}
                    onClick={() => handleUpdateStatus(a, "completed")}
                    className="text-xs font-semibold px-4 py-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 transition-all duration-200 disabled:opacity-50"
                  >
                    Mark completed
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleStartPrescription(a)}
                  className="flex-shrink-0 text-xs font-semibold px-4 py-2 rounded-xl bg-gradient-to-r from-purple-800 via-indigo-600 to-blue-500 hover:from-purple-700 hover:to-blue-400 text-white shadow-md hover:scale-105 active:scale-95 transition-all duration-300 flex items-center gap-2"
                >
                  <span>💊</span>
                  <span>Write Prescription</span>
                </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Prescription Form */}
      <section ref={formRef} className="space-y-4 scroll-mt-6">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center text-sm">
              💊
            </span>
            Issue a Prescription
            <span className="text-xs bg-purple-500/10 text-purple-400 border border-purple-500/30 px-2.5 py-0.5 rounded-full font-semibold">
              Sepolia Smart Contract
            </span>
          </h2>
          <p className="text-xs text-zinc-500 mt-1 ml-10">
            Medication orders are saved to the database and anchored on-chain as SHA-256 digests.
          </p>
        </div>

        <form
          onSubmit={handleSubmitPrescription}
          className="glass-card border border-zinc-800/80 rounded-2xl p-6 shadow-xl space-y-5"
        >
          {/* Patient + Appointment row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Patient <span className="text-red-400">*</span>
              </label>
              {uniquePatients.length > 0 ? (
                <select
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  className="w-full glass-input rounded-xl p-2.5 text-xs bg-zinc-900/80 focus:ring-1 focus:ring-purple-500 focus:outline-none transition"
                  required
                >
                  <option value="">— Select a patient —</option>
                  {uniquePatients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder="Enter Patient UUID"
                  value={selectedPatientId}
                  onChange={(e) => setSelectedPatientId(e.target.value)}
                  className="w-full glass-input rounded-xl p-2.5 text-xs bg-zinc-900/80 focus:ring-1 focus:ring-purple-500 focus:outline-none transition"
                  required
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Appointment Reference{" "}
                <span className="text-zinc-500 font-normal">(optional)</span>
              </label>
              <select
                value={selectedAppointmentId}
                onChange={(e) => setSelectedAppointmentId(e.target.value)}
                className="w-full glass-input rounded-xl p-2.5 text-xs bg-zinc-900/80 focus:ring-1 focus:ring-purple-500 focus:outline-none transition"
              >
                <option value="">— Not linked to an appointment —</option>
                {appointments
                  .filter(
                    (a) =>
                      !selectedPatientId || a.patient_id === selectedPatientId
                  )
                  .map((a) => (
                    <option key={a.appointment_id} value={a.appointment_id}>
                      {a.patient_name} ·{" "}
                      {new Date(a.scheduled_at).toLocaleDateString()}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Medication rows */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-zinc-300">
                Medications <span className="text-red-400">*</span>
              </label>
              <button
                type="button"
                onClick={handleAddMedication}
                className="text-xs font-semibold text-purple-400 hover:text-purple-300 transition-colors flex items-center gap-1"
              >
                <span>+</span> Add Medication
              </button>
            </div>

            <div className="space-y-3">
              {medications.map((med, idx) => (
                <div
                  key={idx}
                  className="bg-zinc-950/60 border border-zinc-800/80 rounded-xl p-4 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                        Medicine Name
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Amoxicillin"
                        value={med.name}
                        onChange={(e) =>
                          handleMedChange(idx, "name", e.target.value)
                        }
                        required
                        className="w-full glass-input rounded-lg p-2 text-xs bg-zinc-900 focus:ring-1 focus:ring-purple-500 focus:outline-none transition"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                        Dosage
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 500mg"
                        value={med.dosage}
                        onChange={(e) =>
                          handleMedChange(idx, "dosage", e.target.value)
                        }
                        required
                        className="w-full glass-input rounded-lg p-2 text-xs bg-zinc-900 focus:ring-1 focus:ring-purple-500 focus:outline-none transition"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 items-end">
                    <div className="col-span-2 sm:col-span-1">
                      <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                        Frequency
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Twice daily"
                        value={med.frequency}
                        onChange={(e) =>
                          handleMedChange(idx, "frequency", e.target.value)
                        }
                        required
                        className="w-full glass-input rounded-lg p-2 text-xs bg-zinc-900 focus:ring-1 focus:ring-purple-500 focus:outline-none transition"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                        Duration (days)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={med.duration_days}
                        onChange={(e) =>
                          handleMedChange(
                            idx,
                            "duration_days",
                            parseInt(e.target.value) || 1
                          )
                        }
                        required
                        className="w-full glass-input rounded-lg p-2 text-xs bg-zinc-900 focus:ring-1 focus:ring-purple-500 focus:outline-none transition"
                      />
                    </div>
                    <div className="flex justify-end items-end pb-0.5">
                      {medications.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMedication(idx)}
                          className="text-red-400 hover:text-red-300 text-xs font-medium px-3 py-2 rounded-lg hover:bg-red-500/10 transition-colors border border-red-500/20 hover:border-red-500/40"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              Clinical Notes{" "}
              <span className="text-zinc-500 font-normal">(optional)</span>
            </label>
            <textarea
              placeholder="e.g. Take with food after meals. Complete full course. Follow up in 7 days if symptoms persist."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full glass-input rounded-xl p-3 text-xs bg-zinc-900/80 focus:ring-1 focus:ring-purple-500 focus:outline-none transition"
            />
          </div>

          {errorMessage && (
            <div className="p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs font-medium flex items-start gap-2">
              <span>⚠️</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {submitSuccess && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-xs space-y-3">
              <div className="flex items-center gap-2 font-bold text-emerald-400">
                <span>✅</span>
                <span>Prescription issued and anchored on-chain</span>
              </div>
              <p className="text-emerald-300/80">
                ID:{" "}
                <span className="font-mono text-zinc-300">
                  {submitSuccess.prescription?.id}
                </span>
              </p>
              {submitSuccess.blockchain?.tx_hash && (
                <div className="bg-zinc-900/80 p-2.5 rounded-xl border border-emerald-500/30 flex items-center justify-between gap-3">
                  <span className="font-mono text-[11px] text-zinc-400 truncate">
                    tx: {submitSuccess.blockchain.tx_hash}
                  </span>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${submitSuccess.blockchain.tx_hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:underline flex-shrink-0 text-[11px] font-medium"
                  >
                    Etherscan ↗
                  </a>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-700 via-indigo-600 to-blue-500 hover:from-purple-600 hover:to-blue-400 text-white font-semibold text-xs shadow-lg shadow-purple-900/20 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 flex items-center gap-2 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Anchoring on Sepolia…</span>
                </>
              ) : (
                <>
                  <span>Sign &amp; Issue Prescription</span>
                  <span>⛓️</span>
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* Prescription History */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-400 flex items-center justify-center text-sm">
              📋
            </span>
            Prescription History
          </h2>
          <span className="text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded-full font-medium">
            {prescriptions.length} on file
          </span>
        </div>

        <div className="space-y-3.5">
          {!loading && prescriptions.length === 0 ? (
            <div className="glass-card rounded-2xl border border-zinc-800/80 overflow-hidden">
              <EmptyState
                icon="📋"
                title="No prescriptions issued yet"
                subtitle="Use the form above to issue your first prescription — it will be anchored on Sepolia and listed here."
              />
            </div>
          ) : (
            prescriptions.map((p) => {
              const txHash = p.blockchain_transactions?.find(
                (t) => t.status === "confirmed"
              )?.tx_hash;
              return (
                <div
                  key={p.id}
                  className="glass-card rounded-2xl p-5 border border-zinc-800/80 hover:border-purple-500/30 transition-all duration-300 space-y-4 shadow-xl"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs border-b border-zinc-800/60 pb-3">
                    <div>
                      <span className="text-zinc-500">Patient: </span>
                      {p.patient_name ? (
                        <span className="font-semibold text-zinc-200">
                          {p.patient_name}
                        </span>
                      ) : (
                        <span className="font-mono text-zinc-300 text-[11px]">
                          {p.patient_id.slice(0, 8)}…
                        </span>
                      )}
                    </div>
                    <span className="text-zinc-500 text-[11px]">
                      Issued{" "}
                      {new Date(p.issued_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {Array.isArray(p.medications) &&
                      p.medications.map((m, mIdx) => (
                        <div
                          key={mIdx}
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
                      ))}
                  </div>

                  {p.notes && (
                    <div className="text-xs text-zinc-300 bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80">
                      <span className="font-semibold text-zinc-400 block mb-1">
                        Clinical Instructions
                      </span>
                      {p.notes}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[11px] flex-wrap gap-2 pt-1 border-t border-zinc-800/60">
                    {txHash ? (
                      <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Blockchain Anchored
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-zinc-500 font-medium">
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
                        Not anchored on-chain
                      </span>
                    )}
                    {txHash && (
                      <a
                        href={`https://sepolia.etherscan.io/tx/${txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-blue-400 hover:text-blue-300 hover:underline flex items-center gap-1 transition-colors"
                      >
                        tx: {txHash.slice(0, 10)}…{txHash.slice(-6)} ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
