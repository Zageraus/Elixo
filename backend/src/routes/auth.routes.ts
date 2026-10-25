import { Router } from "express";
import { randomBytes } from "crypto";
import { verifyMessage, id } from "ethers";
import { z } from "zod";
import { supabaseAdmin } from "../config/supabase.js";
import { issueAppJwt } from "../middleware/auth.js";
import { createClient } from "@supabase/supabase-js";

const router = Router();
const supabaseAuth = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const WALLET_RE = /^0x[a-fA-F0-9]{40}$/;

/**
 * users.wallet_address is NOT NULL, so email accounts get a placeholder
 * address derived from their Supabase Auth user id. Nobody holds a private
 * key for it, so it can never be used for wallet sign-in, and it is never
 * returned to the client.
 */
function emailAccountWallet(authUserId: string): string {
  return `0x${id(`email-account:${authUserId}`).slice(-40)}`;
}

function publicWallet(walletAddress: string, authUserId: string): string {
  return walletAddress === emailAccountWallet(authUserId) ? "" : walletAddress;
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
 *            and returns a signed JWT (also valid as a Supabase RLS token).
 */

router.post("/nonce", async (req, res) => {
  const schema = z.object({ wallet_address: z.string().regex(WALLET_RE) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid wallet_address" });

  const wallet = parsed.data.wallet_address.toLowerCase();
  const nonce = randomBytes(16).toString("hex");
  const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

  const { error } = await supabaseAdmin.from("auth_nonces").insert({
    wallet_address: wallet,
    nonce,
    expires_at,
  });
  if (error) return res.status(500).json({ error: error.message });

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
  const nonce = nonceMatch[1];

  const { data: nonceRow, error: nonceErr } = await supabaseAdmin
    .from("auth_nonces")
    .select("*")
    .eq("wallet_address", wallet)
    .eq("nonce", nonce)
    .is("consumed_at", null)
    .gte("expires_at", new Date().toISOString())
    .maybeSingle();

  if (nonceErr || !nonceRow) {
    return res.status(401).json({ error: "Nonce invalid, expired, or already used" });
  }

  await supabaseAdmin.from("auth_nonces").update({ consumed_at: new Date().toISOString() }).eq("id", nonceRow.id);

  // Method 2: Admin setup passcode check
  const providedAdminKey = parsed.data.admin_key?.trim();
  const wantsAdmin = Boolean(providedAdminKey);
  if (wantsAdmin) {
    const expectedKey = process.env.ADMIN_REGISTRATION_KEY;
    if (!expectedKey || providedAdminKey !== expectedKey) {
      return res.status(401).json({ error: "Invalid or unauthorized admin registration key" });
    }
  }

  // 3. Find or create the user (first-time wallets default to 'patient' unless valid admin_key is supplied).
  let { data: user, error: userErr } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("wallet_address", wallet)
    .maybeSingle();

  if (userErr) return res.status(500).json({ error: userErr.message });

  const targetRole = wantsAdmin ? "admin" : "patient";

  if (!user) {
    const { data: created, error: createErr } = await supabaseAdmin
      .from("users")
      .insert({
        wallet_address: wallet,
        role: targetRole,
        full_name: wantsAdmin ? `Admin ${wallet.slice(0, 8)}` : `User ${wallet.slice(0, 8)}`,
      })
      .select()
      .single();
    if (createErr) return res.status(500).json({ error: createErr.message });
    user = created;
  } else if (wantsAdmin && user.role !== "admin") {
    // Elevate existing user if a valid admin_key was provided
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("users")
      .update({ role: "admin" })
      .eq("id", user.id)
      .select()
      .single();
    if (updateErr) return res.status(500).json({ error: updateErr.message });
    user = updated;
  }

  if (!user.is_active) return res.status(403).json({ error: "Account disabled" });

  // 4. Issue the JWT (API session token + Supabase RLS token, see auth.ts).
  const token = issueAppJwt({ app_user_id: user.id, app_role: user.role, wallet_address: wallet });

  res.json({ token, user: { id: user.id, role: user.role, full_name: user.full_name, wallet_address: wallet } });
});


/**
 * EMAIL REGISTRATION
 * New email accounts always start with the patient role.
 */
router.post("/register", async (req, res) => {
  const schema = z.object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(72),
    full_name: z.string().trim().min(2).max(100),
    role: z.enum(["patient", "doctor"]),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Enter a valid email, a password of at least 8 characters, and your full name.",
    });
  }

  const email = parsed.data.email.toLowerCase();
  const full_name = parsed.data.full_name;

  try {
    // Create a real Supabase Auth account.
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password: parsed.data.password,
        email_confirm: true,
        user_metadata: { full_name },
      });

    if (authError) {
      const duplicate =
        /already registered|already exists|duplicate/i.test(authError.message);

      return res.status(duplicate ? 409 : 400).json({
        error: duplicate
          ? "An account with this email already exists. Please log in."
          : authError.message,
      });
    }

    if (!authData.user) {
      return res.status(500).json({ error: "Could not create the account." });
    }

    // Use the validated registration role (patient or doctor).
    // Admin registration remains unavailable through this endpoint.
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .insert({
        email,
        full_name,
        role: parsed.data.role,
        wallet_address: emailAccountWallet(authData.user.id),
      })
      .select("*")
      .single();

    if (userError) {
      // Avoid leaving an orphaned Auth account if the app user cannot be created.
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return res.status(500).json({ error: userError.message });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: "Account disabled." });
    }

    // Keep using the application's JWT for existing API and RLS behavior.
    const token = issueAppJwt({
      app_user_id: user.id,
      app_role: user.role,
      wallet_address: "",
    });

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        role: user.role,
        full_name: user.full_name,
        email: user.email,
        wallet_address: "",
      },
    });
  } catch (error) {
    console.error("Email registration failed:", error);
    return res.status(500).json({ error: "Registration failed." });
  }
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

  try {
    // Verify the password using Supabase Auth.
    const { data: authData, error: authError } =
      await supabaseAuth.auth.signInWithPassword({
        email,
        password: parsed.data.password,
      });

    if (authError || !authData.user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Look up the application's user record.
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("email", email)
      .maybeSingle();

    if (userError) {
      return res.status(500).json({ error: userError.message });
    }

    // A Supabase Auth account without an app user row is not automatically
    // assigned a privileged role. Create it as a patient.
    let appUser = user;

    if (!appUser) {
      const metadataName = authData.user.user_metadata?.full_name;
      const full_name =
        typeof metadataName === "string" && metadataName.trim()
          ? metadataName.trim()
          : email.split("@")[0];

      const { data: created, error: createError } = await supabaseAdmin
        .from("users")
        .insert({
          email,
          full_name,
          role: "patient",
          wallet_address: emailAccountWallet(authData.user.id),
        })
        .select("*")
        .single();

      if (createError) {
        return res.status(500).json({ error: createError.message });
      }

      appUser = created;
    }

    if (!appUser.is_active) {
      return res.status(403).json({ error: "Account disabled." });
    }

    const wallet_address = publicWallet(appUser.wallet_address, authData.user.id);

    const token = issueAppJwt({
      app_user_id: appUser.id,
      app_role: appUser.role,
      wallet_address,
    });

    return res.json({
      token,
      user: {
        id: appUser.id,
        role: appUser.role,
        full_name: appUser.full_name,
        email: appUser.email,
        wallet_address,
      },
    });
  } catch (error) {
    console.error("Email login failed:", error);
    return res.status(500).json({ error: "Login failed." });
  }
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

  let { data: user, error: userErr } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("wallet_address", demoWallets[role])
    .maybeSingle();

  if (userErr) return res.status(500).json({ error: userErr.message });

  if (!user) {
    const demoNames: Record<string, string> = {
      admin: "Alice Admin (Demo)",
      doctor: "Dr. Bob Rao (Demo)",
      patient: "Chitra Menon (Demo)",
    };

    const wallet = demoWallets[role];
    const name = demoNames[role];

    const { data: created, error: createErr } = await supabaseAdmin
      .from("users")
      .upsert({
        wallet_address: wallet,
        role,
        full_name: name,
      })
      .select()
      .single();

    if (createErr) return res.status(500).json({ error: createErr.message });
    user = created;

    if (role === "doctor") {
      await supabaseAdmin.from("doctor_profiles").upsert({
        user_id: user.id,
        specialization: "Cardiology",
        license_number: "LIC-DEMO-001",
        years_experience: 10,
        consultation_fee: 150.0,
      });
    } else if (role === "patient") {
      await supabaseAdmin.from("patient_profiles").upsert({
        user_id: user.id,
        date_of_birth: "1990-04-12",
        blood_group: "O+",
      });
    }
  }

  const token = issueAppJwt({
    app_user_id: user.id,
    app_role: user.role,
    wallet_address: user.wallet_address,
  });

  res.json({
    token,
    user: {
      id: user.id,
      role: user.role,
      full_name: user.full_name,
      wallet_address: user.wallet_address,
    },
  });
});

export default router;
