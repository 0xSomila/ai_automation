/**
 * The shared tool library. The Core defines every tool once; each pack lists
 * which it uses. Executors read the client config + vertical pack, so one
 * implementation serves all verticals.
 *
 * Rules that hold for every executor (CLAUDE.md):
 *  - never trust the model's arguments,
 *  - always re-validate against live availability before writing,
 *  - always timezone-aware,
 *  - always log the call and its outcome.
 *
 * See BUILD.md section 7.
 */
import type { ClientConfig } from "../config/loader.js";
import type { VerticalPack } from "../pack.js";
import type { BookingBackend } from "../booking/adapter.js";

export const TOOL_NAMES = [
  "answer_faq",
  "qualify",
  "check_availability",
  "create_booking",
  "reschedule",
  "cancel",
  "join_waitlist",
  "take_order",
  "capture_lead",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Context every executor gets. */
export interface ToolContext {
  config: ClientConfig;
  pack: VerticalPack;
  backend: BookingBackend;
  businessId: string;
  customerId: string;
  customerPhone: string;
}

export interface ToolResult {
  ok: boolean;
  /** Structured data returned to the model. */
  data?: unknown;
  /** A customer-safe message on failure, if the caller wants to surface it. */
  customerMessage?: string;
}

export type ToolExecutor = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<ToolResult>;

/**
 * Anthropic tool schemas. Only the tools a pack lists are passed to the model.
 * Keep descriptions tight; the pack's prompt fragment adds vertical framing.
 */
export const TOOL_SCHEMAS: Record<ToolName, { description: string; input_schema: object }> = {
  answer_faq: {
    description: "Answer a question from the business config: services, prices, hours, policies.",
    input_schema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] },
  },
  qualify: {
    description: "Capture intent, service, party size and urgency from the customer.",
    input_schema: {
      type: "object",
      properties: {
        intent: { type: "string" },
        service: { type: "string" },
        party: { type: "integer" },
        urgency: { type: "string" },
      },
      required: ["intent"],
    },
  },
  check_availability: {
    description:
      "Return open times for a date. Never invent availability; this is the only source.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD in the business timezone" },
        service: { type: "string" },
        party: { type: "integer" },
        staff: { type: "string" },
      },
      required: ["date"],
    },
  },
  create_booking: {
    description: "Commit an engagement after re-validating the slot. Returns a reference.",
    input_schema: {
      type: "object",
      properties: {
        service: { type: "string" },
        startsAt: { type: "string", description: "ISO 8601 with offset" },
        party: { type: "integer" },
        staff: { type: "string" },
        name: { type: "string" },
      },
      required: ["service", "startsAt"],
    },
  },
  reschedule: {
    description: "Move an existing engagement to a new time, after re-validating it.",
    input_schema: {
      type: "object",
      properties: { reference: { type: "string" }, newStartsAt: { type: "string" } },
      required: ["reference", "newStartsAt"],
    },
  },
  cancel: {
    description: "Cancel an existing engagement by reference.",
    input_schema: {
      type: "object",
      properties: { reference: { type: "string" } },
      required: ["reference"],
    },
  },
  join_waitlist: {
    description: "Add the customer to the waitlist for a full date or slot.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string" }, party: { type: "integer" }, service: { type: "string" } },
      required: ["date"],
    },
  },
  take_order: {
    description: "Capture a takeaway or catering order; lines are written to the engagement payload.",
    input_schema: {
      type: "object",
      properties: {
        lines: { type: "array", items: { type: "object" } },
        pickupAt: { type: "string" },
      },
      required: ["lines"],
    },
  },
  capture_lead: {
    description: "Log an enquiry with no immediate booking, for follow-up.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string" }, contact: { type: "string" } },
      required: ["summary"],
    },
  },
};

/**
 * Executors. Each is defined once and reads ctx to behave per vertical.
 * These are wired stubs: the control flow is real, the backend writes are TODO.
 */
export const EXECUTORS: Record<ToolName, ToolExecutor> = {
  answer_faq: async (args, ctx) => {
    // Answer from ctx.config (services, prices, hours, policies). No backend call.
    return { ok: true, data: { topic: args.topic, config: pickFaqFacts(ctx.config) } };
  },

  qualify: async (args) => {
    return { ok: true, data: { captured: args } };
  },

  check_availability: async (args, ctx) => {
    const slots = await ctx.pack.computeAvailability({
      config: ctx.config,
      backend: ctx.backend,
      date: String(args.date),
      service: args.service ? String(args.service) : undefined,
      party: typeof args.party === "number" ? args.party : undefined,
      staff: args.staff ? String(args.staff) : undefined,
    });
    return { ok: true, data: { slots } };
  },

  create_booking: async (_args, _ctx) => {
    // TODO(build): re-validate the requested slot against live availability,
    // then ctx.backend.create(...), then persist to engagements with a reference.
    throw new Error("create_booking executor not yet implemented");
  },

  reschedule: async () => {
    throw new Error("reschedule executor not yet implemented");
  },

  cancel: async () => {
    throw new Error("cancel executor not yet implemented");
  },

  join_waitlist: async () => {
    throw new Error("join_waitlist executor not yet implemented");
  },

  take_order: async () => {
    throw new Error("take_order executor not yet implemented");
  },

  capture_lead: async () => {
    throw new Error("capture_lead executor not yet implemented");
  },
};

function pickFaqFacts(config: ClientConfig) {
  return {
    name: config.name,
    location: config.location,
    hours: config.hours,
    services: config.services,
    menuLink: config.menuLink,
    policies: config.policies,
  };
}

/** Build the Anthropic tools array from the pack's tool list. */
export function toolsForPack(toolNames: ToolName[]) {
  return toolNames.map((name) => ({
    name,
    description: TOOL_SCHEMAS[name].description,
    input_schema: TOOL_SCHEMAS[name].input_schema,
  }));
}
