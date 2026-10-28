import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, withAuditUser } from "../config/prisma.js";
import { supabaseAdmin } from "../config/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { paginated, parsePage } from "../utils/pagination.js";

const router = Router();
router.use(requireAuth, requireRole("admin"));

// Aggregate queries live in the v_admin_analytics view (counts, sums,
// averages). COUNT returns BIGINT and SUM/AVG return NUMERIC, so convert
// every value to a plain number for the API.
router.get("/analytics", async (_req, res) => {
  const [row] = await prisma.$queryRaw<Record<string, unknown>[]>`select * from v_admin_analytics`;
  res.json(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === null ? null : Number(v)])));
});

// Weekly appointments per doctor (GROUP BY view), joined to doctor names.
router.get("/doctor-load", async (_req, res) => {
  const rows = await prisma.$queryRaw<
    { doctor_id: string; doctor_name: string; week_start: Date; appointment_count: bigint; completed_count: bigint; cancelled_count: bigint }[]
  >`
    select l.doctor_id, u.full_name as doctor_name, l.week_start,
           l.appointment_count, l.completed_count, l.cancelled_count
    from v_doctor_weekly_load l
    join users u on u.id = l.doctor_id
    order by l.week_start desc, u.full_name`;
  res.json(rows);
});

router.get("/audit-logs", async (req, res) => {
  const page = parsePage(req);
  const [rows, total] = await Promise.all([
    prisma.audit_logs.findMany({
      orderBy: { created_at: "desc" },
      include: { user: { select: { full_name: true } } },
      skip: page.skip,
      take: page.take,
    }),
    prisma.audit_logs.count(),
  ]);
  res.json(paginated(rows, total, page));
});

router.patch("/users/:id/role", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const body = z.object({ role: z.enum(["patient", "doctor", "admin"]) }).safeParse(req.body);
  if (!id.success || !body.success) return res.status(400).json({ error: "Invalid user ID or role" });

  // trg_audit_users_role records the change with this admin as the actor.
  const user = await withAuditUser(req.auth!.app_user_id, (tx) =>
    tx.users.update({ where: { id: id.data }, data: { role: body.data.role } })
  );
  res.json(user);
});

/**
 * USER MANAGEMENT (patients and doctors only; admins can't be dropped here).
 */

const userIdSchema = z.string().uuid();

/** Loads a patient/doctor by id, or sends the error response and returns null. */
async function findManageableUser(req: Request, res: Response) {
  const parsedId = userIdSchema.safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(400).json({ error: "Invalid user ID." });
    return null;
  }
  const user = await prisma.users.findUnique({
    where: { id: parsedId.data },
    select: { id: true, full_name: true, email: true, role: true, is_active: true },
  });
  if (!user || (user.role !== "patient" && user.role !== "doctor")) {
    res.status(404).json({ error: "Patient or doctor not found." });
    return null;
  }
  return user;
}

const formatIST = (d: Date) =>
  d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

/**
 * Sends one notification to every patient who has an appointment with this
 * doctor. Patients with upcoming visits are told those visits are cancelled
 * (and refunded if paid). Runs inside the caller's transaction, before
 * anything is cancelled or deleted.
 */
async function notifyDoctorPatients(
  tx: Prisma.TransactionClient,
  doctor: { id: string; full_name: string },
  reason: "deactivated" | "deleted"
) {
  const appts = await tx.appointments.findMany({
    where: { doctor_id: doctor.id },
    select: { patient_id: true, scheduled_at: true, status: true, payment: { select: { status: true } } },
    orderBy: { scheduled_at: "asc" },
  });

  const now = Date.now();
  const byPatient = new Map<string, { upcoming: string[]; paid: boolean }>();
  for (const a of appts) {
    const entry = byPatient.get(a.patient_id) ?? { upcoming: [], paid: false };
    if ((a.status === "requested" || a.status === "confirmed") && a.scheduled_at.getTime() >= now) {
      entry.upcoming.push(formatIST(a.scheduled_at));
      if (a.payment?.status === "paid") entry.paid = true;
    }
    byPatient.set(a.patient_id, entry);
  }
  if (byPatient.size === 0) return 0;

  const lead =
    reason === "deactivated"
      ? `${doctor.full_name} is currently unavailable on ELIXOR.`
      : `${doctor.full_name} is no longer part of ELIXOR.`;
  const next =
    reason === "deactivated"
      ? "Please book with another doctor in the meantime."
      : "Please select a different doctor for your future appointments.";

  const rows = [...byPatient].map(([patient_id, { upcoming, paid }]) => {
    const cancelled = upcoming.length
      ? ` Your upcoming appointment${upcoming.length > 1 ? "s" : ""} on ${upcoming.join(", ")} IST ${
          upcoming.length > 1 ? "have" : "has"
        } been cancelled${paid ? " and your payment refunded" : ""}.`
      : "";
    return { user_id: patient_id, type: "appointment" as const, message: `${lead}${cancelled} ${next}` };
  });

  await tx.notifications.createMany({ data: rows });
  return rows.length;
}

const usersQuerySchema = z.object({
  role: z.enum(["patient", "doctor"]).default("patient"),
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "active", "inactive"]).default("all"),
});

/**
 * GET /api/admin/users?role=patient|doctor&q=&status=all|active|inactive&page=&page_size=
 * Server-side search (name, email, specialization), filtering and
 * pagination. Also returns how many patients and doctors match the search,
 * for the tab labels.
 */
router.get("/users", async (req, res) => {
  const query = usersQuerySchema.safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: query.error.flatten() });
  const { role, q, status } = query.data;
  const page = parsePage(req);

  const search: Prisma.usersWhereInput = q
    ? {
        OR: [
          { full_name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { doctor_profile: { specialization: { contains: q, mode: "insensitive" } } },
        ],
      }
    : {};
  const statusFilter: Prisma.usersWhereInput =
    status === "all" ? {} : { is_active: status === "active" };
  const where: Prisma.usersWhereInput = { role, ...search, ...statusFilter };

  const [users, total, patientTotal, doctorTotal] = await Promise.all([
    prisma.users.findMany({
      where,
      select: {
        id: true,
        full_name: true,
        email: true,
        role: true,
        is_active: true,
        created_at: true,
        doctor_profile: { select: { specialization: true } },
        _count: {
          select: {
            appointments_as_patient: true,
            appointments_as_doctor: true,
            prescriptions_as_patient: true,
            prescriptions_as_doctor: true,
            reports_as_patient: true,
          },
        },
      },
      orderBy: { full_name: "asc" },
      skip: page.skip,
      take: page.take,
    }),
    prisma.users.count({ where }),
    prisma.users.count({ where: { role: "patient", ...search, ...statusFilter } }),
    prisma.users.count({ where: { role: "doctor", ...search, ...statusFilter } }),
  ]);

  // Paid or refunded payments on each listed user's appointments.
  const ids = users.map((u) => u.id);
  const paidAppts = await prisma.appointments.findMany({
    where: { payment: { isNot: null }, OR: [{ patient_id: { in: ids } }, { doctor_id: { in: ids } }] },
    select: { patient_id: true, doctor_id: true },
  });
  const paymentCount = new Map<string, number>();
  for (const a of paidAppts) {
    for (const id of [a.patient_id, a.doctor_id]) paymentCount.set(id, (paymentCount.get(id) ?? 0) + 1);
  }

  res.json({
    ...paginated(
      users.map(({ doctor_profile, _count, ...u }) => ({
        ...u,
        specialization: doctor_profile?.specialization ?? null,
        appointment_count: _count.appointments_as_patient + _count.appointments_as_doctor,
        prescription_count: _count.prescriptions_as_patient + _count.prescriptions_as_doctor,
        report_count: _count.reports_as_patient,
        payment_count: paymentCount.get(u.id) ?? 0,
      })),
      total,
      page
    ),
    role_totals: { patient: patientTotal, doctor: doctorTotal },
  });
});

/**
 * Deactivate or reactivate. Deactivating blocks sign-in (checked on every
 * request), hides a doctor from booking, and cancels the user's upcoming
 * requested/confirmed appointments (paid ones are refunded by the
 * trg_refund_on_cancel trigger). Records are kept.
 *
 * Notifying patients, updating the account and cancelling appointments is
 * one transaction: if any step fails, nothing changes.
 */
router.patch("/users/:id/active", async (req, res) => {
  const parsed = z.object({ is_active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "is_active must be true or false." });

  const user = await findManageableUser(req, res);
  if (!user) return;

  const result = await withAuditUser(req.auth!.app_user_id, async (tx) => {
    // Tell the doctor's patients before their appointments are cancelled.
    const patientsNotified =
      user.role === "doctor" && user.is_active && !parsed.data.is_active
        ? await notifyDoctorPatients(tx, user, "deactivated")
        : 0;

    await tx.users.update({ where: { id: user.id }, data: { is_active: parsed.data.is_active } });

    let cancelled = 0;
    if (!parsed.data.is_active) {
      const { count } = await tx.appointments.updateMany({
        where: {
          ...(user.role === "doctor" ? { doctor_id: user.id } : { patient_id: user.id }),
          status: { in: ["requested", "confirmed"] },
          scheduled_at: { gte: new Date() },
        },
        data: { status: "cancelled", notes: "Cancelled automatically: account deactivated by admin." },
      });
      cancelled = count;
    }
    return { patientsNotified, cancelled };
  });

  res.json({
    id: user.id,
    is_active: parsed.data.is_active,
    cancelled_appointments: result.cancelled,
    patients_notified: result.patientsNotified,
  });
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

  // Notifications go to the patients, so they survive the cascade. Both
  // steps commit together.
  const patientsNotified = await withAuditUser(req.auth!.app_user_id, async (tx) => {
    const notified = user.role === "doctor" ? await notifyDoctorPatients(tx, user, "deleted") : 0;
    await tx.users.delete({ where: { id: user.id } });
    return notified;
  });

  // Files and the Auth login live outside the database; clean them up after
  // the rows are gone.
  if (user.role === "patient") {
    const folder = `reports/${user.id}`;
    const { data: files } = await supabaseAdmin.storage.from("medical-reports").list(folder);
    if (files?.length) {
      await supabaseAdmin.storage.from("medical-reports").remove(files.map((f) => `${folder}/${f.name}`));
    }
  }

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

  res.json({ id: user.id, deleted: true, patients_notified: patientsNotified });
});

export default router;
