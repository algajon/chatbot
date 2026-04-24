import { createHmac, timingSafeEqual } from "node:crypto";
import {
  compactObject,
  createDeterministicId,
  ensureNonEmptyString,
  normalizedInboundEventSchema,
  toIsoTimestamp,
  type NormalizedInboundEvent,
  type NormalizedInboundEventMessage,
  type RuntimeChannelType,
} from "@meta-chatbot/core";

type MetaWebhookQuery = {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
};

type OutboundRequest = {
  channel: RuntimeChannelType;
  endpointPath: string;
  accessToken: string;
  payload: Record<string, unknown>;
};

export function verifyMetaSignature(params: {
  appSecret: string;
  rawBody: Buffer | string;
  signatureHeader?: string | string[];
}): boolean {
  const header = Array.isArray(params.signatureHeader)
    ? params.signatureHeader[0]
    : params.signatureHeader;

  if (!header) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", params.appSecret)
    .update(params.rawBody)
    .digest("hex")}`;

  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(header, "utf8");

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function verifyMetaWebhookChallenge(
  query: MetaWebhookQuery,
  expectedToken?: string,
): string | null {
  if (
    query["hub.mode"] !== "subscribe" ||
    !expectedToken ||
    query["hub.verify_token"] !== expectedToken
  ) {
    return null;
  }

  return query["hub.challenge"] ?? null;
}

export function normalizeInboundEvents(
  channel: RuntimeChannelType,
  payload: unknown,
): NormalizedInboundEvent[] {
  switch (channel) {
    case "whatsapp":
      return normalizeWhatsAppEvents(payload);
    case "instagram":
      return normalizeInstagramEvents(payload);
    case "messenger":
      return normalizeMessengerEvents(payload);
  }
}

export function normalizeWhatsAppEvents(payload: unknown): NormalizedInboundEvent[] {
  const source = payload as {
    entry?: Array<{
      id?: string;
      changes?: Array<{
        field?: string;
        value?: {
          metadata?: {
            phone_number_id?: string;
          };
          contacts?: Array<{
            wa_id?: string;
            profile?: {
              name?: string;
            };
          }>;
          messages?: Array<Record<string, any>>;
        };
      }>;
    }>;
  };

  const events: NormalizedInboundEvent[] = [];

  for (const entry of source.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") {
        continue;
      }

      const value = change.value;
      if (!value?.messages?.length) {
        continue;
      }

      const contactsByWaId = new Map(
        (value.contacts ?? [])
          .map((contact) => [
            ensureNonEmptyString(contact.wa_id),
            ensureNonEmptyString(contact.profile?.name),
          ])
          .filter(([waId]) => Boolean(waId)) as Array<[string, string | undefined]>,
      );

      for (const message of value.messages) {
        const senderId = ensureNonEmptyString(message.from);
        const messageId = ensureNonEmptyString(message.id);
        const recipientId =
          ensureNonEmptyString(value.metadata?.phone_number_id) ??
          ensureNonEmptyString(entry.id);

        if (!senderId || !messageId || !recipientId) {
          continue;
        }

        const normalized = normalizedInboundEventSchema.parse({
          eventId: `whatsapp:${messageId}`,
          channelMessageId: messageId,
          channel: "whatsapp",
          senderId,
          recipientId,
          externalUserKey: `whatsapp:${senderId}`,
          timestamp: toIsoTimestamp(message.timestamp ?? Date.now()),
          message: buildWhatsAppMessage(message),
          profile: compactObject({
            displayName: contactsByWaId.get(senderId),
          }),
          raw: compactObject({
            entryId: entry.id,
            changeField: change.field,
            message,
          }),
        });

        events.push(normalized);
      }
    }
  }

  return events;
}

export function normalizeInstagramEvents(payload: unknown): NormalizedInboundEvent[] {
  return normalizePageChannelEvents("instagram", payload);
}

export function normalizeMessengerEvents(payload: unknown): NormalizedInboundEvent[] {
  return normalizePageChannelEvents("messenger", payload);
}

export function buildInstagramOutboundTextMessage(params: {
  graphVersion: string;
  accessToken: string;
  pageId: string;
  recipientId: string;
  text: string;
}): OutboundRequest {
  return buildPageOutboundTextMessage("instagram", params);
}

export function buildMessengerOutboundTextMessage(params: {
  graphVersion: string;
  accessToken: string;
  pageId: string;
  recipientId: string;
  text: string;
}): OutboundRequest {
  return buildPageOutboundTextMessage("messenger", params);
}

function normalizePageChannelEvents(
  channel: Extract<RuntimeChannelType, "instagram" | "messenger">,
  payload: unknown,
): NormalizedInboundEvent[] {
  const source = payload as {
    entry?: Array<{
      id?: string;
      messaging?: Array<Record<string, any>>;
    }>;
  };

  const events: NormalizedInboundEvent[] = [];

  for (const entry of source.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const senderId = ensureNonEmptyString(event.sender?.id);
      const recipientId =
        ensureNonEmptyString(event.recipient?.id) ?? ensureNonEmptyString(entry.id);

      if (!senderId || !recipientId) {
        continue;
      }

      const timestamp = toIsoTimestamp(event.timestamp ?? Date.now());

      if (event.message?.mid) {
        const messageId = ensureNonEmptyString(event.message.mid);
        if (!messageId) {
          continue;
        }

        events.push(
          normalizedInboundEventSchema.parse({
            eventId: `${channel}:${messageId}`,
            channelMessageId: messageId,
            channel,
            senderId,
            recipientId,
            externalUserKey: `${channel}:${senderId}`,
            timestamp,
            message: buildInstagramMessage(event.message),
            raw: compactObject({
              entryId: entry.id,
              event,
            }),
          }),
        );

        continue;
      }

      if (event.postback) {
        const syntheticMessageId = createDeterministicId(
          `${channel}-postback`,
          senderId,
          recipientId,
          event.timestamp,
          event.postback.payload,
        );

        events.push(
          normalizedInboundEventSchema.parse({
            eventId: `${channel}:${syntheticMessageId}`,
            channelMessageId: syntheticMessageId,
            channel,
            senderId,
            recipientId,
            externalUserKey: `${channel}:${senderId}`,
            timestamp,
            message: {
              type: "interactive",
              text:
                ensureNonEmptyString(event.postback.title) ??
                ensureNonEmptyString(event.postback.payload),
              interactivePayload: compactObject({
                payload: ensureNonEmptyString(event.postback.payload),
                title: ensureNonEmptyString(event.postback.title),
              }),
            },
            raw: compactObject({
              entryId: entry.id,
              event,
            }),
          }),
        );
      }
    }
  }

  return events;
}

export function buildWhatsAppOutboundTextMessage(params: {
  graphVersion: string;
  accessToken: string;
  phoneNumberId: string;
  recipientId: string;
  text: string;
}): OutboundRequest {
  return {
    channel: "whatsapp",
    endpointPath: `/${params.graphVersion}/${params.phoneNumberId}/messages`,
    accessToken: params.accessToken,
    payload: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.recipientId,
      type: "text",
      text: {
        preview_url: false,
        body: params.text,
      },
    },
  };
}

export function buildWhatsAppOutboundImageMessage(params: {
  graphVersion: string;
  accessToken: string;
  phoneNumberId: string;
  recipientId: string;
  imageUrl: string;
  caption?: string;
}): OutboundRequest {
  return {
    channel: "whatsapp",
    endpointPath: `/${params.graphVersion}/${params.phoneNumberId}/messages`,
    accessToken: params.accessToken,
    payload: compactObject({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: params.recipientId,
      type: "image",
      image: compactObject({
        link: params.imageUrl,
        caption: ensureNonEmptyString(params.caption),
      }),
    }),
  };
}

function buildPageOutboundTextMessage(
  channel: Extract<RuntimeChannelType, "instagram" | "messenger">,
  params: {
  graphVersion: string;
  accessToken: string;
  pageId: string;
  recipientId: string;
  text: string;
},
): OutboundRequest {
  return {
    channel,
    endpointPath: `/${params.graphVersion}/${params.pageId}/messages`,
    accessToken: params.accessToken,
    payload: {
      recipient: {
        id: params.recipientId,
      },
      messaging_type: "RESPONSE",
      message: {
        text: params.text,
      },
    },
  };
}

function buildWhatsAppMessage(message: Record<string, any>): NormalizedInboundEventMessage {
  const type = ensureNonEmptyString(message.type) ?? "unknown";

  switch (type) {
    case "text":
      return {
        type: "text",
        text: ensureNonEmptyString(message.text?.body),
      };
    case "image":
      return {
        type: "image",
        text: ensureNonEmptyString(message.image?.caption),
        mediaMimeType: ensureNonEmptyString(message.image?.mime_type),
        interactivePayload: compactObject({
          mediaId: ensureNonEmptyString(message.image?.id),
        }),
      };
    case "video":
      return {
        type: "video",
        mediaMimeType: ensureNonEmptyString(message.video?.mime_type),
        interactivePayload: compactObject({
          mediaId: ensureNonEmptyString(message.video?.id),
        }),
      };
    case "audio":
      return {
        type: "audio",
        mediaMimeType: ensureNonEmptyString(message.audio?.mime_type),
        interactivePayload: compactObject({
          mediaId: ensureNonEmptyString(message.audio?.id),
        }),
      };
    case "interactive":
      return {
        type: "interactive",
        text:
          ensureNonEmptyString(message.interactive?.button_reply?.title) ??
          ensureNonEmptyString(message.interactive?.list_reply?.title),
        interactivePayload: compactObject({
          buttonReplyId: ensureNonEmptyString(message.interactive?.button_reply?.id),
          listReplyId: ensureNonEmptyString(message.interactive?.list_reply?.id),
          listReplyTitle: ensureNonEmptyString(message.interactive?.list_reply?.title),
          buttonReplyTitle: ensureNonEmptyString(
            message.interactive?.button_reply?.title,
          ),
        }),
      };
    default:
      return {
        type: "unknown",
        text: ensureNonEmptyString(message.text?.body),
      };
  }
}

function buildInstagramMessage(message: Record<string, any>): NormalizedInboundEventMessage {
  const text = ensureNonEmptyString(message.text);
  const attachment = Array.isArray(message.attachments)
    ? message.attachments[0]
    : undefined;
  const attachmentType = ensureNonEmptyString(attachment?.type);

  if (text) {
    return {
      type: "text",
      text,
    };
  }

  if (attachmentType === "image") {
    return {
      type: "image",
      mediaUrl: ensureNonEmptyString(attachment?.payload?.url),
    };
  }

  if (attachmentType === "video") {
    return {
      type: "video",
      mediaUrl: ensureNonEmptyString(attachment?.payload?.url),
    };
  }

  if (attachmentType === "audio") {
    return {
      type: "audio",
      mediaUrl: ensureNonEmptyString(attachment?.payload?.url),
    };
  }

  return {
    type: "unknown",
  };
}
