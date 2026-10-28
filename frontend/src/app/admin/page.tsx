"use client";

import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api, getUser } from "../../lib/api";
import DashboardHeader from "../../components/DashboardHeader";
import UserManagement from "../../components/UserManagement";
import RoleGate from "../../components/RoleGate";
import { formatINR } from "../../lib/payments";

export default function AdminPage() {
  return (
    <RoleGate role="admin">
      <AdminDashboard />
    </RoleGate>
  );
}

function AdminDashboard() {
  const [user, setUser] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [load, setLoad] = useState<any[]>([]);

  useEffect(() => {
    const authed = getUser();
    if (authed) setUser(authed);

    api.getAnalytics().then(setAnalytics).catch(console.error);
    api.getDoctorLoad().then(setLoad).catch(console.error);
  }, []);

  const statCards = [
    { label: "Total Patients", value: analytics?.total_patients, icon: "🧑‍⚕️", color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
    { label: "Registered Doctors", value: analytics?.total_doctors, icon: "🩺", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
    { label: "Appointments Booked", value: analytics?.total_appointments, icon: "📅", color: "text-purple-400", bg: "bg-purple-500/10", border: "border-purple-500/20" },
    { label: "Visits Completed", value: analytics?.completed_appointments, icon: "✅", color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
    { label: "Medical Reports", value: analytics?.total_reports, icon: "📑", color: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500/20" },
    { label: "AI RAG Analyses", value: analytics?.total_ai_analyses, icon: "🧠", color: "text-purple-300", bg: "bg-purple-500/15", border: "border-purple-500/30" },
    { label: "Confirmed Sepolia Tx", value: analytics?.confirmed_chain_txs, icon: "⛓️", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
    { label: "Pending On-Chain Tx", value: analytics?.pending_chain_txs, icon: "⏳", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
    { label: "Revenue Collected", value: analytics ? formatINR(Number(analytics.total_revenue)) : undefined, icon: "💰", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
    { label: "Paid Consultations", value: analytics?.paid_payments, icon: "🧾", color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-cyan-500/20" },
    { label: "Awaiting Payment", value: analytics?.awaiting_payment, icon: "⌛", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
    { label: "Refunded", value: analytics ? formatINR(Number(analytics.total_refunded)) : undefined, icon: "↩️", color: "text-zinc-300", bg: "bg-zinc-500/10", border: "border-zinc-500/20" },
  ];

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="glass-card p-3 rounded-xl border border-zinc-700 bg-zinc-950/90 shadow-2xl text-xs space-y-1">
          <p className="font-mono text-zinc-400">Doctor ID: {label ? label.slice(0, 8) + '...' : 'N/A'}</p>
          <p className="font-bold text-purple-400">
            Appointments: <span className="text-white">{payload[0].value}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-[#030712] text-zinc-100 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-8">
      {/* Altherix Topbar */}
      <DashboardHeader
        role="admin"
        walletAddress={user?.wallet_address}
        fullName={user?.full_name}
      />

      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-purple-500/10 via-indigo-500/10 to-blue-500/5 border border-purple-500/30 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-2xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-400 text-xs font-semibold mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              <span>Platform Administration · Real-Time Throughput Analytics</span>
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black bg-gradient-to-r from-blue-400 via-purple-300 to-pink-400 bg-clip-text text-transparent">
              Admin Command Center 🛡️
            </h1>
            <p className="text-zinc-400 text-xs sm:text-sm mt-1.5 max-w-xl leading-relaxed">
              Real-time platform metrics populated from PostgreSQL analytical views (<code className="text-zinc-300">v_admin_analytics</code>), tracking cryptographic anchoring and clinician throughput.
            </p>
          </div>
          <div className="hidden md:flex items-center justify-center w-16 h-16 rounded-2xl bg-purple-500/10 border border-purple-500/30 text-3xl">
            📊
          </div>
        </div>
      </div>

      {/* KPI Grid (12 Stat Cards) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map((s, idx) => (
          <div
            key={idx}
            className={`glass-card rounded-2xl p-5 border border-zinc-800/80 hover:${s.border} transition-all duration-300 group`}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">{s.label}</span>
              <div className={`w-8 h-8 rounded-xl ${s.bg} border ${s.border} ${s.color} flex items-center justify-center text-sm group-hover:scale-110 transition-transform`}>
                {s.icon}
              </div>
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold text-white">{s.value ?? "—"}</p>
          </div>
        ))}
      </div>

      {/* Doctor Weekly Workload Chart Section */}
      <section className="glass-card rounded-3xl p-6 sm:p-8 border border-zinc-800/80 shadow-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>📈 Provider Weekly Load Distribution</span>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Aggregated appointment volume per physician derived from <code className="text-purple-400">v_doctor_weekly_load</code> view
            </p>
          </div>
          <span className="text-xs px-3 py-1 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-400 font-mono">
            Weekly Aggregation
          </span>
        </div>

        <div className="h-72 w-full pt-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={load}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="doctor_id" hide />
              <YAxis stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar
                dataKey="appointment_count"
                fill="url(#barGradient)"
                radius={[8, 8, 0, 0]}
              />
              <defs>
                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.9} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.5} />
                </linearGradient>
              </defs>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <UserManagement
        onChanged={() => {
          api.getAnalytics().then(setAnalytics).catch(console.error);
          api.getDoctorLoad().then(setLoad).catch(console.error);
        }}
      />
    </div>
  );
}
