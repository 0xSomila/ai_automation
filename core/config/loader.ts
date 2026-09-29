/**
 * Client config loader and validator.
 *
 * A client config is pure business data: name, hours, services or menu, prices
 * (ZAR), policies, resources, channel number. It carries no vertical logic and
 * no code. This module is the base schema shared by every vertical; a pack may
 * refine `services`/`menu`/`resources` shapes via its own validation.
 *
 * See BUILD.md sections 2 and 15, and CLAUDE.md.
 */
import { z } from "zod";

/** Opening hours per weekday. Times are local (Africa/Johannesburg), "HH:mm". */
const hoursSchema = z.record(
  z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
  z.array(z.object({ open: z.string(), close: z.string(), label: z.string().optional() })),
);

const serviceSchema = z.object({
  name: z.string(),
  durationMin: z.number().int().positive().optional(),
  priceZar: z.number().nonnegative().optional(),
  staff: z.array(z.string()).optional(), // salon: who performs this service
});

const resourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["practitioner", "table", "staff", "provider"]),
  capacity: z.number().int().positive().default(1), // covers for a table
});

export const clientConfigSchema = z.object({
  slug: z.string().min(1),
  vertical: z.enum(["practitioner", "restaurant", "salon", "service"]),
  name: z.string().min(1),
  location: z.string().optional(),
  timezone: z.string().default("Africa/Johannesburg"),

  channelPhoneId: z.string().min(1), // WhatsApp phone number id this business answers on

  hours: hoursSchema.optional(),
  services: z.array(serviceSchema).optional(),
  menuLink: z.string().url().optional(),
  resources: z.array(resourceSchema).optional(),

  policies: z
    .object({
      cancellation: z.string().optional(),
      medicalAid: z.string().optional(),
      referral: z.string().optional(),
      partySizeLimit: z.number().int().positive().optional(),
    })
    .partial()
    .optional(),

  booking: z.object({
    backend: z.string(), // e.g. "google_calendar"
    config: z.record(z.unknown()).default({}),
  }),

  // Free-form vertical extras validated by the pack, kept out of Core logic.
  extras: z.record(z.unknown()).optional(),
});

export type ClientConfig = z.infer<typeof clientConfigSchema>;

export function validateConfig(raw: unknown): ClientConfig {
  return clientConfigSchema.parse(raw);
}

/** Load and validate a config object. Throws with a readable message on failure. */
export function loadConfig(raw: unknown, source = "<config>"): ClientConfig {
  const result = clientConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid client config (${source}):\n${issues}`);
  }
  return result.data;
}
