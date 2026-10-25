"use client";

import { useState } from "react";
import Link from "next/link";
import { clearAuth } from "../lib/api";
import NotificationBell from "./NotificationBell";

interface DashboardHeaderProps {
  role: "patient" | "doctor" | "admin";
  walletAddress?: string;
  fullName?: string;
}

export default function DashboardHeader({ role, walletAddress, fullName }: DashboardHeaderProps) {
  const [copied, setCopied] = useState(false);

  const roleStyles = {
    patient: {
      badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
      dot: "bg-emerald-500",
      label: "Patient Portal",
    },
    doctor: {
      badge: "bg-blue-500/10 text-blue-400 border-blue-500/30",
      dot: "bg-blue-500",
      label: "Doctor Portal",
    },
    admin: {
      badge: "bg-purple-500/10 text-purple-400 border-purple-500/30",
      dot: "bg-purple-500",
      label: "Admin Portal",
    },
  }[role];

  const copyWallet = () => {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <header className="sticky top-4 z-40 mb-8">
      <div className="glass-card rounded-2xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xl border border-zinc-800/80 bg-zinc-950/80 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-500 flex items-center justify-center text-white font-black text-sm shadow-md group-hover:scale-105 transition-transform duration-300">
              🩺
            </div>
            <div>
              <span className="font-extrabold text-base tracking-wider text-white group-hover:text-purple-400 transition-colors">
                ELIXOR
              </span>
              <span className="block text-[10px] font-mono text-zinc-400 -mt-0.5 tracking-tight">
                AI-ASSISTED HEALTHCARE
              </span>
            </div>
          </Link>

          <div className="h-6 w-px bg-zinc-800 mx-1 hidden sm:block" />

          <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold border ${roleStyles.badge}`}>
            <span className={`w-2 h-2 rounded-full ${roleStyles.dot} animate-pulse`} />
            <span>{roleStyles.label}</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Sepolia Network Badge */}
          <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 rounded-xl bg-zinc-900/90 border border-zinc-800 text-[11px] font-mono text-zinc-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Sepolia Testnet</span>
          </div>

          {fullName && (
            <span className="text-xs font-semibold text-zinc-200 hidden md:inline-block px-2">
              {fullName}
            </span>
          )}

          <NotificationBell />

          <Link
            href="/"
            onClick={() => clearAuth()}
            className="text-xs font-semibold px-3.5 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/30 transition-all duration-200 flex items-center gap-1.5"
          >
            <span>Sign out</span>
            <span>⏻</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
