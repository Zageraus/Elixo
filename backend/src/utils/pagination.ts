import { Request } from "express";
import { z } from "zod";

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(10),
});

export interface PageParams {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

/** Reads ?page=&page_size= (defaults 1 and 10, page size capped at 100). */
export function parsePage(req: Request): PageParams {
  const parsed = pageSchema.safeParse(req.query);
  const { page, page_size } = parsed.success ? parsed.data : { page: 1, page_size: 10 };
  return { page, pageSize: page_size, skip: (page - 1) * page_size, take: page_size };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export function paginated<T>(items: T[], total: number, { page, pageSize }: PageParams): Paginated<T> {
  return { items, total, page, page_size: pageSize, total_pages: Math.max(1, Math.ceil(total / pageSize)) };
}
