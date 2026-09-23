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
  | { ok: false; error: "payload-too-large"; status: 413 }
  | { ok: false; error: "invalid-request"; status: 400 };

export async function readFuelRequest(req: Request): Promise<FuelRequestResult> {
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_FUEL_REQUEST_BYTES) {
      return { ok: false, error: "payload-too-large", status: 413 };
    }
  }

  if (!req.body) return { ok: false, error: "invalid-request", status: 400 };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_FUEL_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, error: "payload-too-large", status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: "invalid-request", status: 400 };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes));
    const parsed = FuelRequestSchema.safeParse(raw);
    return parsed.success
      ? { ok: true, image: parsed.data.image }
      : { ok: false, error: "invalid-request", status: 400 };
  } catch {
    return { ok: false, error: "invalid-request", status: 400 };
  }
}

export function parseFuelModelOutput(raw: unknown): FuelModelOutput | null {
  const parsed = FuelModelOutputSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
