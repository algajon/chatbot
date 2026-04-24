import { Injectable } from "@nestjs/common";
import { OpenAiResponseService } from "@meta-chatbot/ai";
import {
  getTopCatalogProduct,
  loadJewelryCatalog,
  resolveCatalogImageUrl,
  searchJewelryCatalog,
  type CatalogSearchResult,
} from "@meta-chatbot/catalog";
import { getEnv } from "@meta-chatbot/config";
import {
  createDeterministicId,
  type ConversationTurn,
  type NormalizedInboundEvent,
} from "@meta-chatbot/core";
import {
  ChannelType,
  ConversationStatus,
  MessageDirection,
  MessageType,
  Prisma,
  PrismaService,
  type Message,
} from "@meta-chatbot/db";
import { createLogger, serializeError } from "@meta-chatbot/logger";
import { type InboundEventJobPayload } from "@meta-chatbot/queue";
import { MetaOutboundMessageService } from "./meta-outbound.service";

@Injectable()
export class ConversationOrchestratorService {
  private readonly env = getEnv();
  private readonly logger = createLogger("worker-orchestrator");

  constructor(
    private readonly prisma: PrismaService,
    private readonly openAiResponseService: OpenAiResponseService,
    private readonly metaOutboundMessageService: MetaOutboundMessageService,
  ) {}

  async processInboundEvent(payload: InboundEventJobPayload): Promise<void> {
    const outboundIdempotencyKey = this.buildOutboundIdempotencyKey(
      payload.normalizedEvent,
    );

    try {
      const existingWebhookEvent = await this.prisma.webhookEventLog.findUnique({
        where: {
          id: payload.webhookEventLogId,
        },
      });

      if (!existingWebhookEvent) {
        throw new Error(
          `Webhook event log ${payload.webhookEventLogId} no longer exists.`,
        );
      }

      if (existingWebhookEvent.status === "completed") {
        return;
      }

      const existingOutboundMessage = await this.prisma.message.findUnique({
        where: {
          idempotencyKey: outboundIdempotencyKey,
        },
      });

      if (existingOutboundMessage) {
        await this.markWebhookCompleted(payload.webhookEventLogId);
        return;
      }

      const conversationContext = await this.prepareConversation(payload);
      const catalogSearch = this.tryBuildCatalogSearch(payload.normalizedEvent);
      const imageUrl = this.tryBuildCatalogImageUrl(catalogSearch);
      const aiReply = await this.openAiResponseService.generateReply({
        channel: payload.normalizedEvent.channel,
        userDisplayName: conversationContext.userDisplayName,
        recentMessages: conversationContext.recentMessages,
        catalogSearch,
      });

      const outboundResponse = await this.metaOutboundMessageService.sendTextMessage({
        channel: payload.normalizedEvent.channel,
        recipientId: payload.normalizedEvent.senderId,
        text: aiReply.text,
        imageUrl,
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.message.create({
          data: {
            conversationId: conversationContext.conversationId,
            direction: MessageDirection.OUTBOUND,
            idempotencyKey: outboundIdempotencyKey,
            channelMessageId:
              outboundResponse.channelMessageId ??
              `synthetic:${createDeterministicId(
                "outbound",
                payload.normalizedEvent.eventId,
              )}`,
            messageType: MessageType.TEXT,
            text: aiReply.text,
            rawPayload: outboundResponse.rawResponse as Prisma.InputJsonValue,
            status: aiReply.usedFallback ? "fallback-sent" : "sent",
          },
        });

        await tx.conversation.update({
          where: {
            id: conversationContext.conversationId,
          },
          data: {
            lastMessageAt: new Date(),
          },
        });

        await tx.webhookEventLog.update({
          where: {
            id: payload.webhookEventLogId,
          },
          data: {
            status: "completed",
            processedAt: new Date(),
            errorMessage: null,
          },
        });
      });

      this.logger.info(
        {
          channel: payload.normalizedEvent.channel,
          eventId: payload.normalizedEvent.eventId,
          conversationId: conversationContext.conversationId,
        },
        "Inbound event processed successfully.",
      );
    } catch (error) {
      await this.prisma.webhookEventLog.update({
        where: {
          id: payload.webhookEventLogId,
        },
        data: {
          status: "failed",
          errorMessage: normalizeErrorMessage(error),
        },
      });

      this.logger.error(
        {
          eventId: payload.normalizedEvent.eventId,
          channel: payload.normalizedEvent.channel,
          error: serializeError(error),
        },
        "Inbound event processing failed.",
      );
      throw error;
    }
  }

  private async prepareConversation(payload: InboundEventJobPayload): Promise<{
    conversationId: string;
    userDisplayName?: string;
    recentMessages: ConversationTurn[];
  }> {
    const event = payload.normalizedEvent;
    const channelType = this.toPrismaChannel(event.channel);
    const inboundText = buildInboundMessageText(event);

    return this.prisma.$transaction(async (tx) => {
      const channel = await tx.channel.upsert({
        where: {
          type_metaAccountId: {
            type: channelType,
            metaAccountId: event.recipientId,
          },
        },
        update: {
          appId: this.env.META_APP_ID ?? undefined,
          pageId:
            event.channel === "instagram"
              ? this.env.INSTAGRAM_PAGE_ID ?? undefined
              : event.channel === "messenger"
                ? this.env.MESSENGER_PAGE_ID ?? undefined
                : undefined,
        },
        create: {
          type: channelType,
          metaAccountId: event.recipientId,
          pageId:
            event.channel === "instagram"
              ? this.env.INSTAGRAM_PAGE_ID ?? undefined
              : event.channel === "messenger"
                ? this.env.MESSENGER_PAGE_ID ?? undefined
                : undefined,
          appId: this.env.META_APP_ID ?? undefined,
        },
      });

      const user = await tx.user.upsert({
        where: {
          externalUserKey: event.externalUserKey,
        },
        update: {
          displayName: event.profile?.displayName ?? undefined,
          phoneNumber: event.channel === "whatsapp" ? event.senderId : undefined,
          instagramPsid: event.channel === "instagram" ? event.senderId : undefined,
          messengerPsid: event.channel === "messenger" ? event.senderId : undefined,
        },
        create: {
          externalUserKey: event.externalUserKey,
          displayName: event.profile?.displayName ?? undefined,
          phoneNumber: event.channel === "whatsapp" ? event.senderId : undefined,
          instagramPsid: event.channel === "instagram" ? event.senderId : undefined,
          messengerPsid: event.channel === "messenger" ? event.senderId : undefined,
        },
      });

      let conversation = await tx.conversation.findFirst({
        where: {
          userId: user.id,
          channelId: channel.id,
          status: {
            in: [ConversationStatus.OPEN, ConversationStatus.HANDOFF],
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      });

      if (!conversation) {
        conversation = await tx.conversation.create({
          data: {
            userId: user.id,
            channelId: channel.id,
            status: ConversationStatus.OPEN,
            lastMessageAt: new Date(event.timestamp),
          },
        });
      }

      const existingInboundMessage = await tx.message.findUnique({
        where: {
          channelMessageId: event.channelMessageId,
        },
      });

      if (!existingInboundMessage) {
        await tx.message.create({
          data: {
            conversationId: conversation.id,
            direction: MessageDirection.INBOUND,
            idempotencyKey: `inbound:${event.eventId}`,
            channelMessageId: event.channelMessageId,
            messageType: this.toPrismaMessageType(event.message.type),
            text: inboundText,
            rawPayload: event.raw as Prisma.InputJsonValue,
            status: "received",
            createdAt: new Date(event.timestamp),
          },
        });
      }

      await tx.conversation.update({
        where: {
          id: conversation.id,
        },
        data: {
          lastMessageAt: new Date(event.timestamp),
        },
      });

      await tx.webhookEventLog.update({
        where: {
          id: payload.webhookEventLogId,
        },
        data: {
          conversationId: conversation.id,
          status: "processing",
        },
      });

      const recentMessages = await tx.message.findMany({
        where: {
          conversationId: conversation.id,
          direction: {
            in: [MessageDirection.INBOUND, MessageDirection.OUTBOUND],
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 12,
      });

      return {
        conversationId: conversation.id,
        userDisplayName: user.displayName ?? undefined,
        recentMessages: buildConversationTurns(recentMessages.reverse()),
      };
    });
  }

  private async markWebhookCompleted(webhookEventLogId: string): Promise<void> {
    await this.prisma.webhookEventLog.update({
      where: {
        id: webhookEventLogId,
      },
      data: {
        status: "completed",
        processedAt: new Date(),
        errorMessage: null,
      },
    });
  }

  private toPrismaChannel(channel: NormalizedInboundEvent["channel"]): ChannelType {
    switch (channel) {
      case "whatsapp":
        return ChannelType.WHATSAPP;
      case "instagram":
        return ChannelType.INSTAGRAM;
      case "messenger":
        return ChannelType.MESSENGER;
    }
  }

  private toPrismaMessageType(type: NormalizedInboundEvent["message"]["type"]): MessageType {
    switch (type) {
      case "text":
        return MessageType.TEXT;
      case "image":
        return MessageType.IMAGE;
      case "video":
        return MessageType.VIDEO;
      case "audio":
        return MessageType.AUDIO;
      case "interactive":
        return MessageType.INTERACTIVE;
      default:
        return MessageType.UNKNOWN;
    }
  }

  private buildOutboundIdempotencyKey(event: NormalizedInboundEvent): string {
    return `outbound:${event.eventId}`;
  }

  private tryBuildCatalogSearch(
    event: NormalizedInboundEvent,
  ): CatalogSearchResult | undefined {
    const query = event.message.text?.trim();
    if (!query) {
      return undefined;
    }

    try {
      const catalog = loadJewelryCatalog(this.env.CATALOG_FILE_PATH);
      return searchJewelryCatalog({
        query,
        catalog,
      });
    } catch (error) {
      this.logger.warn(
        {
          channel: event.channel,
          eventId: event.eventId,
          error: serializeError(error),
        },
        "Catalog lookup failed. Continuing without product context.",
      );
      return undefined;
    }
  }

  private tryBuildCatalogImageUrl(
    catalogSearch: CatalogSearchResult | undefined,
  ): string | undefined {
    const product = getTopCatalogProduct(catalogSearch);
    if (!product) {
      return undefined;
    }

    const baseUrl = this.resolvePublicBaseUrl();
    if (!baseUrl) {
      return undefined;
    }

    return resolveCatalogImageUrl({
      product,
      baseUrl,
    });
  }

  private resolvePublicBaseUrl(): string | undefined {
    if (this.env.PUBLIC_BASE_URL) {
      return this.env.PUBLIC_BASE_URL;
    }

    if (this.env.NODE_ENV !== "production") {
      return `http://localhost:${this.env.PORT}`;
    }

    this.logger.warn(
      "PUBLIC_BASE_URL is not configured. Catalog images will not be sent in production.",
    );
    return undefined;
  }
}

function buildConversationTurns(messages: Message[]): ConversationTurn[] {
  return messages
    .map((message) => ({
      role:
        message.direction === MessageDirection.INBOUND ? ("user" as const) : ("assistant" as const),
      text:
        message.text ??
        (message.messageType === MessageType.IMAGE
          ? "[Image message]"
          : message.messageType === MessageType.VIDEO
            ? "[Video message]"
            : message.messageType === MessageType.AUDIO
              ? "[Audio message]"
              : message.messageType === MessageType.INTERACTIVE
                ? "[Interactive message]"
                : "[Unsupported message]"),
    }))
    .filter((message) => message.text.length > 0);
}

function buildInboundMessageText(event: NormalizedInboundEvent): string {
  if (event.message.text) {
    return event.message.text;
  }

  switch (event.message.type) {
    case "image":
      return "[Image message]";
    case "video":
      return "[Video message]";
    case "audio":
      return "[Audio message]";
    case "interactive":
      return "[Interactive message]";
    default:
      return "[Unsupported message]";
  }
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 2_000);
  }

  return "Unknown processing failure.";
}
