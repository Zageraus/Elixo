import { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { sqlState } from "../config/prisma.js";

/**
 * Last-resort error handler. Route handlers may simply throw (Express 4 is
 * patched by express-async-errors to forward rejected promises here), and
 * database errors are turned into a clear status code instead of a 500.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return res.status(409).json({ error: "A record with these details already exists." });
      case "P2003":
        return res.status(409).json({ error: "This change refers to a record that doesn't exist." });
      case "P2025":
        return res.status(404).json({ error: "Record not found." });
    }
    // Errors raised by triggers, CHECK constraints and stored procedures.
    const state = sqlState(err);
    const raw = (err.meta as { message?: string } | undefined)?.message ?? err.message;
    const message = raw.replace(/^ERROR:\s*/, "");
    if (state === "23505") return res.status(409).json({ error: message });
    if (state && /^(22|23|P0)/.test(state)) return res.status(400).json({ error: message });
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    console.error(err);
    return res.status(503).json({ error: "The database is unavailable. Please try again shortly." });
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}
