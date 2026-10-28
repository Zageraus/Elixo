import { Router } from "express";
import { z } from "zod";
import { prisma, withAuditUser } from "../config/prisma.js";
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

  const doctors = await prisma.users.findMany({
    where: { role: "doctor", is_active: true },
    select: { id: true, full_name: true, doctor_profile: { select: { specialization: true } } },
    orderBy: { full_name: "asc" },
  });

  res.json(
    doctors.map((d) => ({ id: d.id, full_name: d.full_name, specialization: d.doctor_profile?.specialization ?? null }))
  );
});

type PatientDashboardRow = {
  patient_id: string;
  full_name: string;
  appointment_id: string;
  scheduled_at: Date;
  appointment_status: string;
  doctor_name: string;
  specialization: string | null;
};

type DoctorDashboardRow = {
  doctor_id: string;
  doctor_name: string;
  appointment_id: string;
  scheduled_at: Date;
  status: string;
  patient_id: string;
  patient_name: string;
  patient_report_count: bigint;
};

// List the signed-in user's appointments from the dashboard views
// (db/migrations/003_views.sql). Views are read with a parameterised raw
// query; the WHERE clause scopes rows to the signed-in user.
router.get("/", async (req, res) => {
  if (!["patient", "doctor"].includes(req.auth!.app_role)) {
    return res.status(403).json({ error: "Insufficient role." });
  }

  const me = req.auth!.app_user_id;

  if (req.auth!.app_role === "patient") {
    const rows = await prisma.$queryRaw<PatientDashboardRow[]>`
      select patient_id, full_name, appointment_id, scheduled_at,
             appointment_status::text as appointment_status, doctor_name, specialization
      from v_patient_dashboard
      where patient_id = ${me}::uuid
      order by scheduled_at`;
    return res.json(await attachPayments(rows));
  }

  const rows = await prisma.$queryRaw<DoctorDashboardRow[]>`
    select doctor_id, doctor_name, appointment_id, scheduled_at, status::text as status,
           patient_id, patient_name, patient_report_count
    from v_doctor_dashboard
    where doctor_id = ${me}::uuid
    order by scheduled_at`;

  // Doctors see the allergies of patients who have an appointment with them.
  const profiles = await prisma.patient_profiles.findMany({
    where: { user_id: { in: [...new Set(rows.map((r) => r.patient_id))] } },
    select: { user_id: true, allergies: true },
  });
  const allergiesByPatient = new Map(profiles.map((p) => [p.user_id, p.allergies]));

  const withPayments = await attachPayments(rows);
  res.json(withPayments.map((r) => ({ ...r, patient_allergies: allergiesByPatient.get(r.patient_id) ?? null })));
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

  if (new Date(parsed.data.scheduled_at).getTime() < Date.now()) {
    return res.status(400).json({ error: "Choose a date and time in the future." });
  }

  const doctor = await prisma.users.findFirst({
    where: { id: parsed.data.doctor_id, role: "doctor", is_active: true },
    select: { id: true },
  });
  if (!doctor) {
    return res.status(400).json({ error: "Selected doctor does not exist." });
  }

  const me = req.auth!.app_user_id;
  const appointment = await withAuditUser(me, (tx) =>
    tx.appointments.create({
      data: {
        patient_id: me,
        doctor_id: doctor.id,
        scheduled_at: new Date(parsed.data.scheduled_at),
        reason: parsed.data.reason || null,
        status: "requested",
      },
    })
  );

  res.status(201).json(appointment);
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

  const parsedId = z.string().uuid().safeParse(req.params.id);
  if (!parsedId.success) {
    return res.status(400).json({ error: "Invalid appointment ID." });
  }

  const parsed = z
    .object({ status: z.enum(["confirmed", "completed", "cancelled", "no_show"]) })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const me = req.auth!.app_user_id;
  const updated = await withAuditUser(me, async (tx) => {
    const appt = await tx.appointments.findFirst({
      where: { id: parsedId.data, ...(role === "doctor" ? { doctor_id: me } : {}) },
      select: { id: true },
    });
    if (!appt) return null;
    // trg_refund_on_cancel and trg_notify_appointment run in this same transaction.
    return tx.appointments.update({ where: { id: appt.id }, data: { status: parsed.data.status } });
  });

  if (!updated) {
    return res.status(404).json({
      error: "Appointment not found or you are not authorized to update it.",
    });
  }

  res.json(updated);
});

export default router;
