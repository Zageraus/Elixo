import { Router } from "express";
import { z } from "zod";
import { supabaseForRequest } from "../config/supabase.js";
import { requireAuth } from "../middleware/auth.js";

// Uses the RLS-scoped client: p_notifications_owner limits every query to
// the signed-in user's own notifications.
const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const db = supabaseForRequest(req.rawJwt!);
  const { data, error } = await db
    .from("notifications")
    .select("id, type, message, is_read, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.patch("/read-all", async (req, res) => {
  const db = supabaseForRequest(req.rawJwt!);
  const { error } = await db.from("notifications").update({ is_read: true }).eq("is_read", false);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

router.patch("/:id/read", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Invalid notification ID." });
  const db = supabaseForRequest(req.rawJwt!);
  const { error } = await db.from("notifications").update({ is_read: true }).eq("id", id.data);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
