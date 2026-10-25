import { Router, Request, Response } from "express";
import { z } from "zod";
import { supabaseAdmin, supabaseForRequest } from "../config/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));

router.get("/analytics", async (req, res) => {
  const db = supabaseForRequest(req.rawJwt!);
  const { data, error } = await db.from("v_admin_analytics").select("*").single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get("/doctor-load", async (req, res) => {
  const db = supabaseForRequest(req.rawJwt!);
  const { data, error } = await db.from("v_doctor_weekly_load").select("*").order("week_start", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get("/audit-logs", async (req, res) => {
  const db = supabaseForRequest(req.rawJwt!);
  const { data, error } = await db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch("/users/:id/role", async (req, res) => {
  const { role } = req.body;
  if (!["patient", "doctor", "admin"].includes(role)) return res.status(400).json({ error: "Invalid role" });
  const db = supabaseForRequest(req.rawJwt!);
  const { data, error } = await db.from("users").update({ role }).eq("id", req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/**
 * USER MANAGEMENT (patients and doctors only; admins can't be dropped here).
 * Uses the admin client: these actions span other users' rows.
 */

const userIdSchema = z.string().uuid();

/** Loads a patient/doctor by id, or sends the error response and returns null. */
async function findManageableUser(req: Request, res: Response) {
  const parsedId = userIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(400).json({ error: "Invalid user ID." });
    return null;
  }
  const { data: user, error } = await supabaseAdmin
    .from("users")
    .select("id, full_name, email, role, is_active")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return null;
  }
  if (!user || (user.role !== "patient" && user.role !== "doctor")) {
    res.status(404).json({ error: "Patient or doctor not found." });
    return null;
  }
  return user;
}

const countBy = (rows: { [k: string]: string | null }[], ...keys: string[]) => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const key of keys) {
      const id = row[key];
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
};

router.get("/users", async (_req, res) => {
  const [users, profiles, appts, prescriptions, reports, payments] = await Promise.all([
    supabaseAdmin
      .from("users")
      .select("id, full_name, email, role, is_active, created_at")
      .in("role", ["patient", "doctor"])
      .order("full_name"),
    supabaseAdmin.from("doctor_profiles").select("user_id, specialization"),
    supabaseAdmin.from("appointments").select("patient_id, doctor_id"),
    supabaseAdmin.from("prescriptions").select("patient_id, doctor_id"),
    supabaseAdmin.from("medical_reports").select("patient_id"),
    supabaseAdmin.from("payments").select("patient_id, doctor_id"),
  ]);
  const failed = [users, profiles, appts, prescriptions, reports, payments].find((r) => r.error);
  if (failed?.error) return res.status(500).json({ error: failed.error.message });

  const specialization = new Map(profiles.data!.map((p) => [p.user_id, p.specialization]));
  const apptCounts = countBy(appts.data!, "patient_id", "doctor_id");
  const prescriptionCounts = countBy(prescriptions.data!, "patient_id", "doctor_id");
  const reportCounts = countBy(reports.data!, "patient_id");
  const paymentCounts = countBy(payments.data!, "patient_id", "doctor_id");

  res.json(
    users.data!.map((u) => ({
      ...u,
      specialization: specialization.get(u.id) ?? null,
      appointment_count: apptCounts.get(u.id) ?? 0,
      prescription_count: prescriptionCounts.get(u.id) ?? 0,
      report_count: reportCounts.get(u.id) ?? 0,
      payment_count: paymentCounts.get(u.id) ?? 0,
    }))
  );
});

/**
 * Deactivate or reactivate. Deactivating blocks sign-in (checked on every
 * request), hides a doctor from booking, and cancels the user's upcoming
 * requested/confirmed appointments (paid ones are refunded by the
 * trg_refund_on_cancel trigger). Records are kept.
 */
router.patch("/users/:id/active", async (req, res) => {
  const parsed = z.object({ is_active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "is_active must be true or false." });

  const user = await findManageableUser(req, res);
  if (!user) return;

  const { error } = await supabaseAdmin.from("users").update({ is_active: parsed.data.is_active }).eq("id", user.id);
  if (error) return res.status(500).json({ error: error.message });

  let cancelled = 0;
  if (!parsed.data.is_active) {
    const column = user.role === "doctor" ? "doctor_id" : "patient_id";
    const { data, error: cancelErr } = await supabaseAdmin
      .from("appointments")
      .update({ status: "cancelled", notes: "Cancelled automatically: account deactivated by admin." })
      .eq(column, user.id)
      .in("status", ["requested", "confirmed"])
      .gte("scheduled_at", new Date().toISOString())
      .select("id");
    if (cancelErr) return res.status(500).json({ error: cancelErr.message });
    cancelled = data.length;
  }

  res.json({ id: user.id, is_active: parsed.data.is_active, cancelled_appointments: cancelled });
});

/**
 * Permanent delete. The users row cascades to the person's appointments,
 * prescriptions, reports, payments, profiles and notifications; audit_logs
 * keep their rows with user_id set to null. Also removes the Supabase Auth
 * login and, for patients, their uploaded report files.
 */
router.delete("/users/:id", async (req, res) => {
  const user = await findManageableUser(req, res);
  if (!user) return;

  if (user.role === "patient") {
    const folder = `reports/${user.id}`;
    const { data: files } = await supabaseAdmin.storage.from("medical-reports").list(folder);
    if (files?.length) {
      await supabaseAdmin.storage.from("medical-reports").remove(files.map((f) => `${folder}/${f.name}`));
    }
  }

  const { error } = await supabaseAdmin.from("users").delete().eq("id", user.id);
  if (error) return res.status(500).json({ error: error.message });

  // Remove the matching Auth login (if any) so the email can't sign back in.
  if (user.email) {
    const email = user.email.toLowerCase();
    for (let page = 1; ; page++) {
      const { data, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (listErr) break;
      const match = data.users.find((u) => u.email?.toLowerCase() === email);
      if (match) {
        await supabaseAdmin.auth.admin.deleteUser(match.id);
        break;
      }
      if (data.users.length < 200) break;
    }
  }

  res.json({ id: user.id, deleted: true });
});

export default router;
