import { describe, expect, it } from "vitest";
import {
  createDeterministicId,
  normalizedInboundEventSchema,
  toIsoTimestamp,
} from "../src";

describe("@meta-chatbot/core", () => {
  it("creates deterministic IDs for the same payload", () => {
    const first = createDeterministicId("whatsapp", { id: "123" });
    const second = createDeterministicId("whatsapp", { id: "123" });

    expect(first).toBe(second);
  });

  it("converts unix-second timestamps to ISO strings", () => {
    expect(toIsoTimestamp("1713897600")).toBe("2024-04-23T18:40:00.000Z");
  });

  it("validates normalized inbound events", () => {
    const parsed = normalizedInboundEventSchema.parse({
      eventId: "whatsapp:wamid.123",
      channelMessageId: "wamid.123",
      channel: "whatsapp",
      senderId: "123456789",
      recipientId: "987654321",
      externalUserKey: "whatsapp:123456789",
      timestamp: "2026-04-23T12:00:00.000Z",
      message: {
        type: "text",
        text: "hello",
      },
      raw: {
        hello: "world",
      },
    });

    expect(parsed.message.text).toBe("hello");
  });
});
