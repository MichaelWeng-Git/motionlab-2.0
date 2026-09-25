import { z } from "zod";

// The client downsizes meal photos to a 640 px JPEG before upload. Two MiB is
// ample for that payload while preventing an unbounded JSON/base64 allocation.
export const MAX_FUEL_REQUEST_BYTES = 2 * 1024 * 1024;

const FuelRequestSchema = z.object({
  image: z
    .string()
    .max(MAX_FUEL_REQUEST_BYTES)
    .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
}).strict();

const finiteNumber = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((value) => Number(value))
  .refine((value) => Number.isFinite(value));

const boundedWholeNumber = (max: number) => finiteNumber.transform((value) =>
  Math.max(0, Math.min(max, Math.round(value)))
);

const FuelModelOutputSchema = z.object({
  isFood: z.boolean(),
  dish: z.string().trim().min(1).max(80).transform((value) => value.slice(0, 24).trim()),
  protein: boundedWholeNumber(300),
  carbs: boundedWholeNumber(300),
  fat: boundedWholeNumber(300),
  kcal: boundedWholeNumber(5000),
  confidence: z.enum(["high", "medium", "low"]),
}).strict();

export type FuelModelOutput = z.output<typeof FuelModelOutputSchema>;

export type FuelRequestResult =
  | { ok: true; image: string }
  // oversize is answered by lib/api-guard with a 413 before we ever parse
  | { ok: false; error: "invalid-request"; status: 400 };

/**
 * Validate an already-parsed body.
 *
 * lib/api-guard streams and size-caps every paid route's body, and a Request
 * body can only be read once — so the route hands the parsed value here rather
 * than re-reading the stream. MAX_FUEL_REQUEST_BYTES is the guard's ceiling for
 * this route as well as the schema's, so an oversized photo is still a 413.
 */
export function readFuelBody(raw: unknown): FuelRequestResult {
  const parsed = FuelRequestSchema.safeParse(raw);
  return parsed.success
    ? { ok: true, image: parsed.data.image }
    : { ok: false, error: "invalid-request", status: 400 };
}

export function parseFuelModelOutput(raw: unknown): FuelModelOutput | null {
  const parsed = FuelModelOutputSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
