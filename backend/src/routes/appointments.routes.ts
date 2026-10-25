
import { Router } from "express";
import { z } from "zod";
import { supabaseAdmin, supabaseForRequest } from "../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";
import { attachPayments } from "../services/payments.service.js";

const router = Router();
router.use(requireAuth);

// Return only the fields needed for the patient booking form.
router.get("/doctors", async (req, res) => {
  if (req.auth!.app_role !== "patient") {
    return res.status(403).json({
      error: "Only patients can view the doctor list.",
    });
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, full_name, doctor_profiles(specialization)")
    .eq("role", "doctor")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) {
    console.error("Failed to load doctors:", error);
    return res.status(500).json({ error: "Failed to load doctors." });
  }

  // doctor_profiles is 1:1 with users; PostgREST may return it as an object
  // or a one-element array depending on how it resolves the relationship.
  const doctors = (data ?? []).map((d: any) => {
    const profile = Array.isArray(d.doctor_profiles) ? d.doctor_profiles[0] : d.doctor_profiles;
    return { id: d.id, full_name: d.full_name, specialization: profile?.specialization ?? null };
  });

  return res.json(doctors);
});

// List appointments using the request JWT.
router.get("/", async (req, res) => {
  if (!["patient", "doctor"].includes(req.auth!.app_role)) {
    return res.status(403).json({ error: "Insufficient role." });
  }

  const db = supabaseForRequest(req.rawJwt!);
  const isDoctor = req.auth!.app_role === "doctor";

  // Views run with their owner's rights, so RLS on appointments doesn't
  // filter them; scope the rows to the signed-in user here.
  const { data, error } = await db
    .from(isDoctor ? "v_doctor_dashboard" : "v_patient_dashboard")
    .select("*")
    .eq(isDoctor ? "doctor_id" : "patient_id", req.auth!.app_user_id)
    .order("scheduled_at", { ascending: true });

  if (error) {
    console.error("Failed to load appointments:", error);
    return res.status(500).json({ error: error.message });
  }

  try {
    return res.json(await attachPayments(data ?? []));
  } catch (e: any) {
    console.error("Failed to load payment details:", e);
    return res.status(500).json({ error: "Failed to load payment details." });
  }
});

// Request an appointment as a patient.
router.post("/", async (req, res) => {
  if (req.auth!.app_role !== "patient") {
    return res.status(403).json({
      error: "Only patients can request appointments.",
    });
  }

  const schema = z.object({
    doctor_id: z.string().uuid(),
    scheduled_at: z.string().datetime(),
    reason: z.string().trim().max(1000).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  // Verify the selected doctor exists before using the admin client.
  const { data: doctor, error: doctorError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("id", parsed.data.doctor_id)
    .eq("role", "doctor")
    .eq("is_active", true)
    .maybeSingle();

  if (doctorError) {
    console.error("Doctor lookup failed:", doctorError);
    return res.status(500).json({ error: "Could not verify the selected doctor." });
  }

  if (!doctor) {
    return res.status(400).json({ error: "Selected doctor does not exist." });
  }

  const { data, error } = await supabaseAdmin
    .from("appointments")
    .insert({
      ...parsed.data,
      patient_id: req.auth!.app_user_id,
      status: "requested",
    })
    .select()
    .single();

  if (error) {
    console.error("Appointment creation failed:", error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(201).json(data);
});

// Update appointment status: doctors/admins only.
// Doctors may update only appointments assigned to them.
router.patch("/:id/status", async (req, res) => {
  const role = req.auth!.app_role;

  if (role !== "doctor" && role !== "admin") {
    return res.status(403).json({
      error: "Only doctors or admins can update appointment status.",
    });
  }

  const idSchema = z.string().uuid();
  const parsedId = idSchema.safeParse(req.params.id);

  if (!parsedId.success) {
    return res.status(400).json({ error: "Invalid appointment ID." });
  }

  const schema = z.object({
    status: z.enum(["confirmed", "completed", "cancelled", "no_show"]),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const db = supabaseForRequest(req.rawJwt!);

  let query = db
    .from("appointments")
    .update({ status: parsed.data.status })
    .eq("id", parsedId.data);

  if (role === "doctor") {
    query = query.eq("doctor_id", req.auth!.app_user_id);
  }

  const { data, error } = await query.select().maybeSingle();

  if (error) {
    console.error("Appointment status update failed:", error);
    return res.status(500).json({ error: error.message });
  }

  if (!data) {
    return res.status(404).json({
      error: "Appointment not found or you are not authorized to update it.",
    });
  }

  return res.json(data);
});

export default router;
