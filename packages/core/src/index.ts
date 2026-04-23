import { createHash } from "node:crypto";
import { z } from "zod";

export const channelTypeSchema = z.enum(["whatsapp", "instagram"]);
export type RuntimeChannelType = z.infer<typeof channelTypeSchema>;

export const normalizedMessageTypeSchema = z.enum([
  "text",
  "image",
  "video",
  "audio",
  "interactive",
  "unknown",
]);
export type NormalizedMessageType = z.infer<typeof normalizedMessageTypeSchema>;

export const normalizedInboundEventMessageSchema = z.object({
  type: normalizedMessageTypeSchema,
  text: z.string().optional(),
  mediaUrl: z.string().optional(),
  mediaMimeType: z.string().optional(),
  interactivePayload: z.record(z.string(), z.unknown()).optional(),
});
export type NormalizedInboundEventMessage = z.infer<
  typeof normalizedInboundEventMessageSchema
>;

export const normalizedInboundEventSchema = z.object({
  eventId: z.string().min(1),
  channelMessageId: z.string().min(1),
  channel: channelTypeSchema,
  senderId: z.string().min(1),
  recipientId: z.string().min(1),
  externalUserKey: z.string().min(1),
  timestamp: z.string().datetime(),
  message: normalizedInboundEventMessageSchema,
  profile: z
    .object({
      displayName: z.string().optional(),
    })
    .optional(),
  raw: z.unknown(),
});
export type NormalizedInboundEvent = z.infer<typeof normalizedInboundEventSchema>;

export type ConversationTurn = {
  role: "user" | "assistant";
  text: string;
};

export const queueNames = {
  inboundEvents: "inbound-events",
} as const;

export const inboundEventJobName = "process-inbound-event";

export function createDeterministicId(...parts: unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex");
}

export function toIsoTimestamp(value: string | number | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "number") {
    return new Date(value).toISOString();
  }

  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    const timestamp = value.length <= 10 ? numeric * 1000 : numeric;
    return new Date(timestamp).toISOString();
  }

  return new Date(value).toISOString();
}

export function ensureNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
