"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, setToken, setUser } from "../lib/api";

export default function LoginPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"patient" | "doctor">("patient");
  const [authError, setAuthError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleRoute = (user: any) => {
    if (user.role === "doctor") router.push("/doctor");
    else if (user.role === "admin") router.push("/admin");
    else router.push("/patient");
  };

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    setLoading(true);

    try {
      const result =
        mode === "register"
          ? await api.register({
              email: email.trim(),
              password,
              full_name: fullName.trim(),
              role,
            })
          : await api.login({
              email: email.trim(),
              password,
            });

      setToken(result.token);
      setUser(result.user);
      handleRoute(result.user);
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Authentication failed."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#030712] text-zinc-100 flex flex-col justify-between selection:bg-purple-600/30">
      {/* Floating Pill Navbar with Mobile Menu (Altherix Style) */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex justify-center px-4 pt-4">
        <div className="max-w-6xl w-full glass-card rounded-2xl px-5 py-3.5 flex items-center justify-between border border-zinc-800/80 shadow-2xl backdrop-blur-xl bg-zinc-950/85">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-600 to-blue-500 flex items-center justify-center text-white font-black text-sm shadow-md">
              🩺
            </div>
            <a href="/" className="font-extrabold text-base tracking-wider text-white hover:text-purple-400 transition-colors">
              ELIXOR
            </a>
          </div>

          <div className="hidden md:flex items-center gap-7 text-xs font-semibold text-zinc-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#workflows" className="hover:text-white transition-colors">Workflows</a>
            <a href="#architecture" className="hover:text-white transition-colors">Architecture</a>
            <a href="#security" className="hover:text-white transition-colors">Security</a>
            <a href="#faqs" className="hover:text-white transition-colors">FAQs</a>
          </div>

          <div className="flex items-center gap-3">
            {/* Mobile Hamburger Toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white"
              aria-label="Toggle navigation menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed top-20 inset-x-4 glass-card bg-zinc-950/95 border border-zinc-800 rounded-2xl p-5 shadow-2xl backdrop-blur-2xl flex flex-col gap-3 z-50 animate-in fade-in slide-in-from-top-2">
            <a href="#features" onClick={() => setMobileMenuOpen(false)} className="py-2 text-sm text-zinc-300 font-medium hover:text-white">Features</a>
            <a href="#workflows" onClick={() => setMobileMenuOpen(false)} className="py-2 text-sm text-zinc-300 font-medium hover:text-white">Workflows</a>
            <a href="#architecture" onClick={() => setMobileMenuOpen(false)} className="py-2 text-sm text-zinc-300 font-medium hover:text-white">Architecture</a>
            <a href="#security" onClick={() => setMobileMenuOpen(false)} className="py-2 text-sm text-zinc-300 font-medium hover:text-white">Security</a>
            <a href="#faqs" onClick={() => setMobileMenuOpen(false)} className="py-2 text-sm text-zinc-300 font-medium hover:text-white">FAQs</a>
          </div>
        )}
      </nav>

      {/* Hero & Login Section */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 pt-32 pb-20 max-w-6xl mx-auto w-full">
        {/* Top Announcement Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-purple-500/10 border border-purple-500/30 text-purple-300 text-xs font-semibold mb-6 shadow-sm backdrop-blur-sm animate-pulse-slow">
          <span className="flex h-2 w-2 rounded-full bg-purple-400"></span>
          <span>Secure Healthcare Records · AI Assistance · Blockchain Audit</span>
        </div>

        {/* Hero Headlines */}
        <div className="text-center max-w-3xl mb-12">
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black tracking-tight leading-[1.12] mb-6">
            ELIXOR <br />
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
              Healthcare Environment
            </span>
            <br></br>
            <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            
            </span>
          </h1>
          <p className="text-sm sm:text-base text-zinc-400 max-w-2xl mx-auto leading-relaxed">
            Manage appointments and medical documents with role-based access, AI-assisted review, and tamper-evident blockchain auditing.
          </p>
        </div>

        {/* Email Authentication Card */}
        <div className="w-full max-w-lg glass-card rounded-3xl p-6 sm:p-8 border border-zinc-800/80 shadow-2xl backdrop-blur-2xl hover:border-purple-500/40 transition-all duration-500 space-y-6">
          <div className="text-center">
            <h2 className="text-xl font-bold text-white tracking-tight">
              {mode === "login" ? "Welcome Back" : "Create Your Account"}
            </h2>
            <p className="text-xs text-zinc-400 mt-2">
              {mode === "login"
                ? "Sign in securely with your email and password."
                : "Register to get started with ELIXOR."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-900/80 p-1">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setAuthError("");
              }}
              className={`rounded-lg py-2.5 text-sm font-semibold transition ${
                mode === "login"
                  ? "bg-purple-600 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("register");
                setAuthError("");
              }}
              className={`rounded-lg py-2.5 text-sm font-semibold transition ${
                mode === "register"
                  ? "bg-purple-600 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Create Account
            </button>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {mode === "register" && (
              <div className="space-y-1.5">
                <label htmlFor="fullName" className="text-xs font-medium text-zinc-300">
                  Full Name
                </label>
                <input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Enter your full name"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-3 text-sm text-white outline-none focus:border-purple-500"
                />
              </div>
            )}

            {mode === "register" && (
              <fieldset className="space-y-2">
                <legend className="text-xs font-medium text-zinc-300">
                  Register as
                </legend>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setRole("patient")}
                    aria-pressed={role === "patient"}
                    className={`rounded-xl border p-3 text-left transition ${
                      role === "patient"
                        ? "border-purple-500 bg-purple-500/10"
                        : "border-zinc-700 bg-zinc-900/60 hover:border-zinc-500"
                    }`}
                  >
                    <span className="block text-sm font-semibold text-white">Patient</span>
                    <span className="mt-1 block text-xs text-zinc-400">Book appointments</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole("doctor")}
                    aria-pressed={role === "doctor"}
                    className={`rounded-xl border p-3 text-left transition ${
                      role === "doctor"
                        ? "border-purple-500 bg-purple-500/10"
                        : "border-zinc-700 bg-zinc-900/60 hover:border-zinc-500"
                    }`}
                  >
                    <span className="block text-sm font-semibold text-white">Doctor</span>
                    <span className="mt-1 block text-xs text-zinc-400">Manage patients</span>
                  </button>
                </div>
              </fieldset>
            )}

            <div className="space-y-1.5">
              <label htmlFor="email" className="text-xs font-medium text-zinc-300">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-3 text-sm text-white outline-none focus:border-purple-500"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-zinc-300">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                minLength={mode === "register" ? 8 : 1}
                maxLength={72}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === "register" ? "At least 8 characters" : "Enter your password"}
                className="w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-4 py-3 text-sm text-white outline-none focus:border-purple-500"
              />
            </div>

            {authError && (
              <div
                role="alert"
                className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
              >
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 py-3.5 text-sm font-bold text-white shadow-lg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading
                ? "Please wait..."
                : mode === "login"
                  ? "Sign In"
                  : "Create Account"}
            </button>
          </form>

          <p className="text-center text-xs text-zinc-500">
            {mode === "register"
              ? role === "doctor"
                ? "Doctor access will be assigned to this account. Use verified credentials in production."
                : "Patient access lets you book and manage appointments."
              : "Sign in with the email and password for your account."}
          </p>
        </div>

        {/* Section 1: Core Architectural Pillars (#features) */}
        <section id="features" className="w-full mt-28 pt-12 border-t border-zinc-800/80 scroll-mt-24">
          <div className="text-center mb-12">
            <h2 className="text-xs font-bold uppercase tracking-widest text-purple-400 mb-2">Core Platform Capabilities</h2>
            <p className="text-2xl sm:text-3xl font-black text-white">Engineered for Clinical Privacy, Integrity &amp; Speed</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="glass-card rounded-2xl p-6 border border-zinc-800/80 hover:border-blue-500/50 transition-all duration-300 group">
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center text-xl mb-4 group-hover:scale-110 transition-transform">
                🔑
              </div>
              <h3 className="text-base font-bold text-white mb-2">Role-Based Secure Access</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Patients, doctors, and administrators enter their role-specific demo portal. Blockchain signing is handled separately from ordinary patient and doctor access.
              </p>
            </div>

            <div className="glass-card rounded-2xl p-6 border border-zinc-800/80 hover:border-purple-500/50 transition-all duration-300 group">
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center text-xl mb-4 group-hover:scale-110 transition-transform">
                ⛓️
              </div>
              <h3 className="text-base font-bold text-white mb-2">Zero-Knowledge On-Chain Proofs</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Deterministic SHA-256 digests of clinical files and prescriptions are permanently anchored to Ethereum Sepolia. Sensitive health records remain fully private off-chain.
              </p>
            </div>

            <div className="glass-card rounded-2xl p-6 border border-zinc-800/80 hover:border-pink-500/50 transition-all duration-300 group">
              <div className="w-12 h-12 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400 flex items-center justify-center text-xl mb-4 group-hover:scale-110 transition-transform">
                🧠
              </div>
              <h3 className="text-base font-bold text-white mb-2">Clinical Narrative AI &amp; RAG</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Uploaded diagnostic records are transformed into dense vector representations to retrieve patient longitudinal history, surfacing laboratory trends and anomaly flags.
              </p>
            </div>
          </div>
        </section>

        {/* Section 2: The Three Core Workflows (#workflows) */}
        <section id="workflows" className="w-full mt-24 scroll-mt-24">
          <div className="text-center mb-12">
            <h2 className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-2">End-to-End Execution Flow</h2>
            <p className="text-2xl sm:text-3xl font-black text-white">How ELIXOR Operates</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="glass-card rounded-2xl p-6 border border-zinc-800/80 space-y-3">
              <div className="text-xs font-mono font-bold text-purple-400">STAGE 01</div>
              <h3 className="text-base font-bold text-white">Cryptographic Challenge</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Client requests an ephemeral single-use nonce. User signs the human-readable statement via wallet. Backend recovers the signer address and mints role-scoped session tokens.
              </p>
            </div>

            <div className="glass-card rounded-2xl p-6 border border-zinc-800/80 space-y-3">
              <div className="text-xs font-mono font-bold text-blue-400">STAGE 02</div>
              <h3 className="text-base font-bold text-white">Document Ingestion &amp; Synthesis</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Diagnostic files are encrypted and uploaded to private bucket storage. Clinical narratives are parsed and evaluated against patient history to flag abnormalities and recommendations.
              </p>
            </div>

            <div className="glass-card rounded-2xl p-6 border border-zinc-800/80 space-y-3">
              <div className="text-xs font-mono font-bold text-emerald-400">STAGE 03</div>
              <h3 className="text-base font-bold text-white">Sepolia Smart Contract Anchor</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                A cryptographic SHA-256 fingerprint is committed to the <code className="text-zinc-300">MedicalAudit.sol</code> contract on Ethereum, producing a tamper-proof timestamp verifiable on Etherscan.
              </p>
            </div>
          </div>
        </section>

        {/* Section 3: Architecture & Relational Engineering (#architecture) */}
        <section id="architecture" className="w-full mt-24 glass-card rounded-3xl p-8 border border-zinc-800/80 scroll-mt-24">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Enterprise Database Architecture</span>
              <h3 className="text-xl sm:text-2xl font-bold text-white mt-1">Third Normal Form (3NF) &amp; Automated Audit Capture</h3>
              <p className="text-xs text-zinc-400 mt-2 max-w-2xl leading-relaxed">
                Physician and patient profiles are decoupled into 1:1 extension tables. Automated PostgreSQL triggers capture every state change into append-only audit tables with full JSON diffs.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-3 py-1 rounded-full text-xs font-mono bg-zinc-900 border border-zinc-700 text-zinc-300">3NF Schema</span>
              <span className="px-3 py-1 rounded-full text-xs font-mono bg-zinc-900 border border-zinc-700 text-zinc-300">Automated Triggers</span>
              <span className="px-3 py-1 rounded-full text-xs font-mono bg-zinc-900 border border-zinc-700 text-zinc-300">Analytical Views</span>
            </div>
          </div>
        </section>

        {/* Section 4: Security & Privacy Alignment (#security) */}
        <section id="security" className="w-full mt-20 scroll-mt-24">
          <div className="text-center mb-10">
            <h2 className="text-xs font-bold uppercase tracking-widest text-cyan-400 mb-2">Compliance &amp; Data Security</h2>
            <p className="text-2xl sm:text-3xl font-black text-white">Why Protected Health Information Never Touches Blockchain</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="glass-card rounded-2xl p-6 border border-zinc-800/80 space-y-2.5">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>🛡️</span> Zero-Knowledge Verification
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Publishing raw medical reports on a public blockchain violates HIPAA and GDPR standards. ELIXOR anchors only fixed 32-byte mathematical hashes, enabling public verification of document integrity without revealing patient names or diagnoses.
              </p>
            </div>

            <div className="glass-card rounded-2xl p-6 border border-zinc-800/80 space-y-2.5">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>🔒</span> Row-Level Security Enforced in PostgreSQL
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Access control is not enforced by vulnerable client-side conditional checks. Every SQL query is filtered by database engine policies that evaluate user IDs and clinical roles directly against cryptographic JWT claims.
              </p>
            </div>
          </div>
        </section>

        {/* Section 5: Frequently Asked Questions (#faqs) */}
        <section id="faqs" className="w-full mt-24 scroll-mt-24">
          <div className="text-center mb-10">
            <h2 className="text-xs font-bold uppercase tracking-widest text-purple-400 mb-2">Clinical &amp; Technical Questions</h2>
            <p className="text-2xl sm:text-3xl font-black text-white">Frequently Asked Questions</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto">
            <div className="glass-card rounded-2xl p-5 border border-zinc-800/80 space-y-2">
              <h3 className="text-sm font-bold text-white">Do patients need to pay Ethereum gas fees?</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                No. Patient login is handled via EIP-4361 off-chain signatures which cost zero gas. When lab reports or prescriptions are anchored, transactions are submitted by authorized backend relayers.
              </p>
            </div>

            <div className="glass-card rounded-2xl p-5 border border-zinc-800/80 space-y-2">
              <h3 className="text-sm font-bold text-white">What happens if a document is altered?</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Even a single altered character in a lab report produces a completely different SHA-256 fingerprint. The on-chain <code className="text-zinc-300">verifyRecord()</code> function will instantly identify tampering.
              </p>
            </div>

            <div className="glass-card rounded-2xl p-5 border border-zinc-800/80 space-y-2">
              <h3 className="text-sm font-bold text-white">How does the clinical AI decision support work?</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                The platform vectors clinical narratives using Ollama or OpenAI embeddings, queries past patient reports via PostgreSQL vector similarity, and generates structured summaries for licensed doctors to review.
              </p>
            </div>

            <div className="glass-card rounded-2xl p-5 border border-zinc-800/80 space-y-2">
              <h3 className="text-sm font-bold text-white">Can doctors access records for any patient?</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                No. PostgreSQL Row-Level Security policies strictly restrict clinician access to patients with whom they have an active scheduled appointment or direct consultation relationship.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Complete Enterprise Footer */}
      <footer className="border-t border-zinc-800/80 py-10 px-4 text-xs text-zinc-500 bg-[#030712]/95 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-col sm:flex-row items-center gap-3 text-center sm:text-left">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-purple-600 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
                🩺
              </div>
              <span className="font-bold text-zinc-200">ELIXOR Platform</span>
            </div>
            <span className="hidden sm:inline">·</span>
            <span>Decentralized Healthcare Management Infrastructure</span>
          </div>

          <div className="flex items-center gap-6 text-zinc-400 flex-wrap justify-center">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#workflows" className="hover:text-white transition-colors">Workflows</a>
            <a href="#architecture" className="hover:text-white transition-colors">Architecture</a>
            <a href="#security" className="hover:text-white transition-colors">Security</a>
            <a href="#faqs" className="hover:text-white transition-colors">FAQs</a>
          </div>

          <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
            <span>Sepolia Testnet</span>
            <span>·</span>
            <span>EVM Compatible</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
