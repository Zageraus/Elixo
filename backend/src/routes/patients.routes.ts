import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("patient"));

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

// Blank text fields are stored as NULL rather than empty strings.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

const profileSchema = z.object({
  date_of_birth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format.")
    .refine((v) => !Number.isNaN(Date.parse(v)), "Not a valid date.")
    .refine((v) => v >= "1900-01-01" && v <= new Date().toISOString().slice(0, 10), "Date of birth must be in the past.")
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  blood_group: z
    .enum(BLOOD_GROUPS)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  allergies: optionalText(1000),
  emergency_contact: optionalText(200),
});

type ProfileRow = {
  date_of_birth: Date | null;
  blood_group: string | null;
  allergies: string | null;
  emergency_contact: string | null;
};

const PROFILE_SELECT = { date_of_birth: true, blood_group: true, allergies: true, emergency_contact: true } as const;

// The DATE column comes back as a Date at UTC midnight; send YYYY-MM-DD.
const toResponse = (p: ProfileRow | null) => ({
  date_of_birth: p?.date_of_birth ? p.date_of_birth.toISOString().slice(0, 10) : null,
  blood_group: p?.blood_group ?? null,
  allergies: p?.allergies ?? null,
  emergency_contact: p?.emergency_contact ?? null,
});

// The signed-in patient's health profile. Patients who registered by email
// have no row yet, so return empty fields instead of a 404.
router.get("/me/profile", async (req, res) => {
  const profile = await prisma.patient_profiles.findUnique({
    where: { user_id: req.auth!.app_user_id },
    select: PROFILE_SELECT,
  });
  res.json(toResponse(profile));
});

// Create or replace the signed-in patient's own health profile.
router.put("/me/profile", async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const data = {
    ...parsed.data,
    date_of_birth: parsed.data.date_of_birth ? new Date(parsed.data.date_of_birth) : null,
  };
  const profile = await prisma.patient_profiles.upsert({
    where: { user_id: req.auth!.app_user_id },
    create: { user_id: req.auth!.app_user_id, ...data },
    update: data,
    select: PROFILE_SELECT,
  });
  res.json(toResponse(profile));
});

export default router;
