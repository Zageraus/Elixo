import { Router } from "express";
import { randomBytes } from "crypto";
import { verifyMessage, id } from "ethers";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, toNumber } from "../config/prisma.js";
import { supabaseAdmin } from "../config/supabase.js";
import { issueAppJwt, requireAuth } from "../middleware/auth.js";
import { createClient } from "@supabase/supabase-js";

const router = Router();
// Supabase Auth checks email passwords (stored as bcrypt hashes in auth.users).
const supabaseAuth = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * users.wallet_address is unique, so email accounts get a placeholder
 * address derived from their Supabase Auth user id. Nobody holds a private
 * key for it, so it can never be used for wallet sign-in, and it is never
 * returned to the client.
 */
function emailAccountWallet(authUserId: string): string {
  return `0x${id(`email-account:${authUserId}`).slice(-40)}`;
}

function publicWallet(walletAddress: string | null, authUserId: string): string {
  return !walletAddress || walletAddress === emailAccountWallet(authUserId) ? "" : walletAddress;
}

/**
 * WORKFLOW 1 — BLOCKCHAIN AUTHENTICATION
 *
 * Step 1: POST /api/auth/nonce  { wallet_address }
 *         -> server generates a one-time nonce, stores it, returns a
 *            human-readable message for the wallet to sign.
 * Step 2: user signs that exact message in MetaMask (no gas, no tx).
 * Step 3: POST /api/auth/verify { wallet_address, signature }
 *         -> server recovers the signer address from the signature,
 *            checks it matches wallet_address AND the nonce is unexpired
 *            + unused, marks it consumed, looks up/creates the user row,
 *            and returns a signed JWT.
 */

router.post("/nonce", async (req, res) => {
  const schema = z.object({ wallet_address: z.string().regex(WALLET_RE) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid wallet_address" });

  const wallet = parsed.data.wallet_address.toLowerCase();
  const nonce = randomBytes(16).toString("hex");

  await prisma.auth_nonces.create({
    data: { wallet_address: wallet, nonce, expires_at: new Date(Date.now() + 5 * 60 * 1000) }, // 5 min
  });

  const message =
    `HealthChain wants you to sign in with your Ethereum account:\n${wallet}\n\n` +
    `This request will not trigger a blockchain transaction or cost gas.\n\n` +
    `Nonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;

  res.json({ message, nonce });
});

router.post("/verify", async (req, res) => {
  const schema = z.object({
    wallet_address: z.string().regex(WALLET_RE),
    message: z.string(),
    signature: z.string(),
    admin_key: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const wallet = parsed.data.wallet_address.toLowerCase();

  // 1. Recover signer from signature and confirm it matches the claimed wallet.
  let recovered: string;
  try {
    recovered = verifyMessage(parsed.data.message, parsed.data.signature).toLowerCase();
  } catch {
    return res.status(401).json({ error: "Signature verification failed" });
  }
  if (recovered !== wallet) {
    return res.status(401).json({ error: "Signature does not match wallet address" });
  }

  // 2. Extract & validate the nonce embedded in the signed message.
  const nonceMatch = parsed.data.message.match(/Nonce:\s*([a-f0-9]+)/i);
  if (!nonceMatch) return res.status(400).json({ error: "Nonce missing from message" });

  // Consuming the nonce is a single conditional UPDATE, so two requests
  // racing with the same signature can't both succeed.
  const { count: consumed } = await prisma.auth_nonces.updateMany({
    where: {
      wallet_address: wallet,
      nonce: nonceMatch[1],
      consumed_at: null,
      expires_at: { gte: new Date() },
    },
    data: { consumed_at: new Date() },
  });
  if (consumed !== 1) {
    return res.status(401).json({ error: "Nonce invalid, expired, or already used" });
  }

  // Admin setup passcode check
  const providedAdminKey = parsed.data.admin_key?.trim();
  const wantsAdmin = Boolean(providedAdminKey);
  if (wantsAdmin) {
    const expectedKey = process.env.ADMIN_REGISTRATION_KEY;
    if (!expectedKey || providedAdminKey !== expectedKey) {
      return res.status(401).json({ error: "Invalid or unauthorized admin registration key" });
    }
  }

  // 3. Find or create the user (first-time wallets default to 'patient' unless valid admin_key is supplied).
  let user = await prisma.users.findUnique({ where: { wallet_address: wallet } });

  if (!user) {
    user = await prisma.users.create({
      data: {
        wallet_address: wallet,
        role: wantsAdmin ? "admin" : "patient",
        full_name: wantsAdmin ? `Admin ${wallet.slice(0, 8)}` : `User ${wallet.slice(0, 8)}`,
      },
    });
  } else if (wantsAdmin && user.role !== "admin") {
    // Elevate existing user if a valid admin_key was provided
    user = await prisma.users.update({ where: { id: user.id }, data: { role: "admin" } });
  }

  if (!user.is_active) return res.status(403).json({ error: "Account disabled" });

  // 4. Issue the JWT.
  const token = issueAppJwt({ app_user_id: user.id, app_role: user.role, wallet_address: wallet });

  res.json({ token, user: { id: user.id, role: user.role, full_name: user.full_name, wallet_address: wallet } });
});

/**
 * EMAIL REGISTRATION
 * New email accounts are patients or doctors; doctors also get a
 * doctor_profiles row with their specialization and license number.
 */
router.post("/register", async (req, res) => {
  const schema = z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(72),
    full_name: z.string().trim().min(2).max(100),
    role: z.enum(["patient", "doctor"]),
    specialization: z.string().trim().min(2).max(100).optional(),
    license_number: z.string().trim().min(2).max(50).optional(),
    consultation_fee: z.number().positive().max(100000).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Enter a valid email, a password of at least 8 characters, and your full name.",
    });
  }

  const email = parsed.data.email.toLowerCase();
  const full_name = parsed.data.full_name;
  const isDoctor = parsed.data.role === "doctor";

  // doctor_profiles.specialization and license_number are NOT NULL, and the
  // consultation fee is what patients pay once an appointment is accepted.
  if (
    isDoctor &&
    (!parsed.data.specialization || !parsed.data.license_number || !parsed.data.consultation_fee)
  ) {
    return res.status(400).json({
      error: "Doctors must provide a specialization, license number and consultation fee.",
    });
  }

  if (isDoctor) {
    const existingLicense = await prisma.doctor_profiles.findUnique({
      where: { license_number: parsed.data.license_number! },
      select: { user_id: true },
    });
    if (existingLicense) {
      return res.status(409).json({ error: "A doctor with this license number is already registered." });
    }
  }

  // Create a real Supabase Auth account (it stores the bcrypt password hash).
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (authError) {
    const duplicate = /already registered|already exists|duplicate/i.test(authError.message);
    return res.status(duplicate ? 409 : 400).json({
      error: duplicate ? "An account with this email already exists. Please log in." : authError.message,
    });
  }
  if (!authData.user) {
    return res.status(500).json({ error: "Could not create the account." });
  }

  // The users row and (for doctors) the doctor_profiles row are written in
  // ONE transaction: either both exist or neither does.
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.users.create({
        data: { email, full_name, role: parsed.data.role, wallet_address: emailAccountWallet(authData.user.id) },
      });
      if (isDoctor) {
        await tx.doctor_profiles.create({
          data: {
            user_id: created.id,
            specialization: parsed.data.specialization!,
            license_number: parsed.data.license_number!,
            consultation_fee: parsed.data.consultation_fee!,
          },
        });
      }
      return created;
    });
  } catch (e) {
    // The transaction rolled back; also remove the Auth account so the
    // email can be used again.
    await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = String((e.meta as { target?: unknown } | undefined)?.target ?? "");
      return res.status(409).json({
        error: target.includes("license")
          ? "A doctor with this license number is already registered."
          : "An account with this email already exists. Please log in.",
      });
    }
    throw e;
  }

  const token = issueAppJwt({ app_user_id: user.id, app_role: user.role, wallet_address: "" });

  return res.status(201).json({
    token,
    user: { id: user.id, role: user.role, full_name: user.full_name, email: user.email, wallet_address: "" },
  });
});

/**
 * EMAIL LOGIN
 */
router.post("/login", async (req, res) => {
  const schema = z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(1).max(72),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Enter a valid email and password." });
  }

  const email = parsed.data.email.toLowerCase();

  // Verify the password using Supabase Auth.
  const { data: authData, error: authError } = await supabaseAuth.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });

  if (authError || !authData.user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  // Look up the application's user record. A Supabase Auth account without
  // an app user row is never given a privileged role: create it as a patient.
  let appUser = await prisma.users.findUnique({ where: { email } });

  if (!appUser) {
    const metadataName = authData.user.user_metadata?.full_name;
    const full_name =
      typeof metadataName === "string" && metadataName.trim() ? metadataName.trim() : email.split("@")[0];

    appUser = await prisma.users.create({
      data: { email, full_name, role: "patient", wallet_address: emailAccountWallet(authData.user.id) },
    });
  }

  if (!appUser.is_active) {
    return res.status(403).json({ error: "Account disabled." });
  }

  const wallet_address = publicWallet(appUser.wallet_address, authData.user.id);

  const token = issueAppJwt({ app_user_id: appUser.id, app_role: appUser.role, wallet_address });

  return res.json({
    token,
    user: { id: appUser.id, role: appUser.role, full_name: appUser.full_name, email: appUser.email, wallet_address },
  });
});

/**
 * GET /api/auth/me
 * The signed-in user, read fresh from the database (role and active status
 * included), so the frontend never has to trust what it stored at login.
 */
router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.users.findUnique({
    where: { id: req.auth!.app_user_id },
    select: {
      id: true,
      role: true,
      full_name: true,
      email: true,
      phone: true,
      is_active: true,
      created_at: true,
      doctor_profile: { select: { specialization: true, license_number: true, consultation_fee: true } },
    },
  });
  if (!user) return res.status(404).json({ error: "Account not found." });

  const { doctor_profile, ...rest } = user;
  res.json({
    ...rest,
    // Email accounts carry a placeholder address internally; the token holds the public one.
    wallet_address: req.auth!.wallet_address,
    doctor_profile: doctor_profile
      ? { ...doctor_profile, consultation_fee: toNumber(doctor_profile.consultation_fee) }
      : null,
  });
});

/**
 * DEMO / DEV LOGIN (NO METAMASK REQUIRED)
 * Allows testing as Patient, Doctor, or Admin without needing a browser extension.
 */
router.post("/demo", async (req, res) => {
  // This passwordless role switch is strictly for a local classroom demo.
  // Never expose demo impersonation in a deployed environment.
  if (process.env.NODE_ENV !== "development") {
    return res.status(404).json({ error: "Demo login is only available in development mode" });
  }

  const schema = z.object({
    role: z.enum(["patient", "doctor", "admin"]).default("patient"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid role" });

  const role = parsed.data.role;

  // Use only deterministic demo identities. Never issue a demo token for an
  // arbitrary real user just because that user has the requested role.
  const demoWallets: Record<string, string> = {
    admin: "0x111111111111111111111111111111111111aaaa",
    doctor: "0x222222222222222222222222222222222222bbbb",
    patient: "0x333333333333333333333333333333333333cccc",
  };
  const demoNames: Record<string, string> = {
    admin: "Alice Admin (Demo)",
    doctor: "Dr. Bob Rao (Demo)",
    patient: "Chitra Menon (Demo)",
  };

  let user = await prisma.users.findUnique({ where: { wallet_address: demoWallets[role] } });

  if (!user) {
    user = await prisma.$transaction(async (tx) => {
      const created = await tx.users.create({
        data: { wallet_address: demoWallets[role], role, full_name: demoNames[role] },
      });
      if (role === "doctor") {
        await tx.doctor_profiles.create({
          data: {
            user_id: created.id,
            specialization: "Cardiology",
            license_number: "LIC-DEMO-001",
            years_experience: 10,
            consultation_fee: 150.0,
          },
        });
      } else if (role === "patient") {
        await tx.patient_profiles.create({
          data: { user_id: created.id, date_of_birth: new Date("1990-04-12"), blood_group: "O+" },
        });
      }
      return created;
    });
  }

  const wallet_address = user.wallet_address ?? "";
  const token = issueAppJwt({ app_user_id: user.id, app_role: user.role, wallet_address });

  res.json({
    token,
    user: { id: user.id, role: user.role, full_name: user.full_name, wallet_address },
  });
});

export default router;
