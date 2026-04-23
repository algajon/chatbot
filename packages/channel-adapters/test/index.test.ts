import { describe, expect, it } from "vitest";
import {
  normalizeInstagramEvents,
  normalizeMessengerEvents,
  normalizeWhatsAppEvents,
} from "../src";

describe("@meta-chatbot/channel-adapters", () => {
  it("normalizes WhatsApp text messages", () => {
    const events = normalizeWhatsAppEvents({
      entry: [
        {
          id: "biz-account",
          changes: [
            {
              field: "messages",
              value: {
                metadata: {
                  phone_number_id: "phone-number-id",
                },
                contacts: [
                  {
                    wa_id: "15551234567",
                    profile: {
                      name: "Alex",
                    },
                  },
                ],
                messages: [
                  {
                    from: "15551234567",
                    id: "wamid.abc",
                    timestamp: "1713897600",
                    type: "text",
                    text: {
                      body: "Hello there",
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventId: "whatsapp:wamid.abc",
      channel: "whatsapp",
      senderId: "15551234567",
      recipientId: "phone-number-id",
      message: {
        type: "text",
        text: "Hello there",
      },
      profile: {
        displayName: "Alex",
      },
    });
  });

  it("normalizes Instagram text messages", () => {
    const events = normalizeInstagramEvents({
      entry: [
        {
          id: "page-id",
          messaging: [
            {
              sender: {
                id: "instagram-user-id",
              },
              recipient: {
                id: "instagram-business-id",
              },
              timestamp: 1713897600000,
              message: {
                mid: "mid.abc",
                text: "Need help with an order",
              },
            },
          ],
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventId: "instagram:mid.abc",
      channel: "instagram",
      senderId: "instagram-user-id",
      recipientId: "instagram-business-id",
      message: {
        type: "text",
        text: "Need help with an order",
      },
    });
  });

  it("normalizes Messenger postbacks as interactive events", () => {
    const events = normalizeMessengerEvents({
      entry: [
        {
          id: "page-id",
          messaging: [
            {
              sender: {
                id: "messenger-user-id",
              },
              recipient: {
                id: "page-id",
              },
              timestamp: 1713897600000,
              postback: {
                title: "Track order",
                payload: "TRACK_ORDER",
              },
            },
          ],
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      channel: "messenger",
      senderId: "messenger-user-id",
      recipientId: "page-id",
      externalUserKey: "messenger:messenger-user-id",
      message: {
        type: "interactive",
        text: "Track order",
        interactivePayload: {
          payload: "TRACK_ORDER",
          title: "Track order",
        },
      },
    });
    expect(events[0]?.eventId.startsWith("messenger:")).toBe(true);
  });
});
