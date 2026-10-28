import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth } from "../middleware/auth.js";

// Every query is limited to the signed-in user's own notifications.
const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const items = await prisma.notifications.findMany({
    where: { user_id: req.auth!.app_user_id },
    select: { id: true, type: true, message: true, is_read: true, created_at: true },
    orderBy: { created_at: "desc" },
    take: 50,
  });
  res.json(items);
});

router.patch("/read-all", async (req, res) => {
  await prisma.notifications.updateMany({
    where: { user_id: req.auth!.app_user_id, is_read: false },
    data: { is_read: true },
  });
  res.json({ ok: true });
});

router.patch("/:id/read", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: "Invalid notification ID." });
  await prisma.notifications.updateMany({
    where: { id: id.data, user_id: req.auth!.app_user_id },
    data: { is_read: true },
  });
  res.json({ ok: true });
});

export default router;
