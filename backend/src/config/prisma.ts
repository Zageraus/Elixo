import { Prisma, PrismaClient } from "@prisma/client";

/**
 * The single Prisma ORM client. Every table read and write in the backend
 * goes through it; supabase-js is only used for file storage and for
 * Supabase Auth (password login), which are not table queries.
 *
 * Prisma connects as the database owner, so Postgres row-level security
 * does not filter its queries. Each route therefore checks access itself
 * (see the `where` clauses built from req.auth); the RLS policies in
 * db/migrations/004_rls_policies.sql stay as a second line of defence for
 * any client that connects with a user token.
 */
export const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });

/**
 * DATABASE_URL with more forgiving timeouts unless the URL sets its own.
 * Opening a TLS session through the Supabase pooler takes several round
 * trips, which can exceed Prisma's 5-second default on a slow network.
 */
function databaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "30");
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "30");
    return url.toString();
  } catch {
    return raw;
  }
}

// block_number is a BIGINT; let it serialize to JSON as a plain number.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

/**
 * Runs `fn` inside one database transaction. Everything in it commits
 * together or rolls back together. It also sets app.current_user_id for the
 * transaction, which fn_audit_trigger (migration 002) records as the user
 * who made each change in audit_logs.
 */
export function withAuditUser<T>(userId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`select set_config('app.current_user_id', ${userId}, true)`;
    return fn(tx);
  });
}

/** Prisma returns NUMERIC columns as Decimal; the API sends plain numbers. */
export function toNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** Postgres SQLSTATE of an error raised inside a raw query or procedure call. */
export function sqlState(e: unknown): string | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2010") {
    const code = (e.meta as { code?: string } | undefined)?.code;
    return typeof code === "string" ? code : null;
  }
  return null;
}
