import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../config/supabase.js";

export interface AppJwtPayload {
  app_user_id: string;
  app_role: "patient" | "doctor" | "admin";
  wallet_address: string;
}

/**
 * Mints the token our own API issues to the browser after a successful
 * wallet-signature login. This token doubles as the Supabase-compatible
 * JWT: it's signed with the SAME secret configured as Supabase's custom
 * JWT secret, and carries `app_user_id` / `app_role` as custom claims that
 * db/migrations/004_rls_policies.sql reads via auth.jwt(). One token,
 * two consumers (our API + Supabase RLS) — no separate session store.
 */
export function issueAppJwt(payload: AppJwtPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: "12h",
    audience: "authenticated", // required by Supabase's JWT consumers
  });
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AppJwtPayload;
      rawJwt?: string;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  const token = header.slice("Bearer ".length);
  let decoded: AppJwtPayload;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!) as AppJwtPayload;
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Tokens live for 12h, so check the account on every request: a user an
  // admin deactivated or deleted loses access immediately.
  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("is_active")
    .eq("id", decoded.app_user_id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: "Could not verify account." });
  if (!user?.is_active) {
    return res.status(401).json({ error: "This account has been deactivated or removed." });
  }

  req.auth = decoded;
  req.rawJwt = token;
  next();
}

export function requireRole(...roles: Array<AppJwtPayload["app_role"]>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.app_role)) {
      return res.status(403).json({ error: "Insufficient role" });
    }
    next();
  };
}
