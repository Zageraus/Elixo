import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import authRoutes from "./routes/auth.routes.js";
import appointmentsRoutes from "./routes/appointments.routes.js";
import reportsRoutes from "./routes/reports.routes.js";
import prescriptionsRoutes from "./routes/prescriptions.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import paymentsRoutes from "./routes/payments.routes.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

app.get("/health", (_req, res) => res.json({ status: "ok", service: "healthchain-backend" }));

app.use("/api/auth", authRoutes);
app.use("/api/appointments", appointmentsRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/prescriptions", prescriptionsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentsRoutes);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`HealthChain backend listening on :${PORT}`));
