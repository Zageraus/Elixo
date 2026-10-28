import "dotenv/config";
import express from "express";
// Forwards errors thrown in async route handlers to the error handler below.
import "express-async-errors";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.routes.js";
import appointmentsRoutes from "./routes/appointments.routes.js";
import reportsRoutes from "./routes/reports.routes.js";
import prescriptionsRoutes from "./routes/prescriptions.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import paymentsRoutes from "./routes/payments.routes.js";
import notificationsRoutes from "./routes/notifications.routes.js";
import patientsRoutes from "./routes/patients.routes.js";
import { errorHandler } from "./middleware/errors.js";
import { prisma } from "./config/prisma.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

app.get("/health", async (_req, res) => {
  await prisma.$queryRaw`select 1`;
  res.json({ status: "ok", service: "healthchain-backend", database: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/appointments", appointmentsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/prescriptions", prescriptionsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/patients", patientsRoutes);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`HealthChain backend listening on :${PORT}`));
