import { z } from "zod";
import { normalizePhone } from "@/lib/phone";

/** Shared zod pieces. Messages are keys of the "errors" namespace. */
export const zName = z.string().trim().min(2, "tooShort").max(160, "tooLong");
export const zPhone = z
  .string()
  .trim()
  .refine((v) => !!normalizePhone(v), "phoneInvalid")
  .transform((v) => normalizePhone(v)!);
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateInvalid");
export const zOptionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "dateInvalid");
export const zUuid = z.string().uuid("invalid");
export const zOptionalText = (max = 2000) =>
  z
    .string()
    .max(max, "tooLong")
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null));
export const zMoney = z.coerce.number({ message: "numberInvalid" }).min(0, "numberInvalid").max(100_000_000, "numberInvalid");
export const zColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "invalid");
export const zTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "invalid");
