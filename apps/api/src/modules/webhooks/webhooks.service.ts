import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  normalizeInboundEvents,
  verifyMetaSignature,
  verifyMetaWebhookChallenge,
} from "@meta-chatbot/channel-adapters";
import { getEnv } from "@meta-chatbot/config";
import {
  createDeterministicId,
  type RuntimeChannelType,
} from "@meta-chatbot/core";
import {
  ChannelType,
  Prisma,
  PrismaService,
} from "@meta-chatbot/db";
import { createLogger, serializeError } from "@meta-chatbot/logger";
import {
  buildInboundJobId,
  closeQueueConnection,
  createInboundEventsQueue,
  inboundEventJobName,
} from "@meta-chatbot/queue";

type HandleIncomingWebhookInput = {
  channel: RuntimeChannelType;
  payload: unknown;
  rawBody: Buffer;
  signatureHeader?: string | string[];
};

@Injectable()
export class WebhooksService implements OnModuleDestroy {
  private readonly env = getEnv();
  private readonly logger = createLogger("api-webhooks");
  private readonly inboundQueue = createInboundEventsQueue();

  constructor(private readonly prisma: PrismaService) {}

  verifyChallengeResponse(query: Record<string, string | undefined>): string {
    const expectedToken = this.env.META_VERIFY_TOKEN;
    if (!expectedToken) {
      throw new ServiceUnavailableException(
        "META_VERIFY_TOKEN is not configured.",
      );
    }

    const challenge = verifyMetaWebhookChallenge(query, expectedToken);
    if (!challenge) {
      throw new UnauthorizedException("Webhook verification failed.");
    }

    return challenge;
  }

  async handleIncomingWebhook(
    input: HandleIncomingWebhookInput,
  ): Promise<Record<string, unknown>> {
    if (!this.env.META_APP_SECRET) {
      throw new ServiceUnavailableException("META_APP_SECRET is not configured.");
    }

    const signatureValid = verifyMetaSignature({
      appSecret: this.env.META_APP_SECRET,
      rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
    });

    if (!signatureValid) {
      throw new UnauthorizedException("Invalid Meta webhook signature.");
    }

    const normalizedEvents = normalizeInboundEvents(input.channel, input.payload);
    if (normalizedEvents.length === 0) {
      await this.persistIgnoredWebhook(input.channel, input.payload);
      return {
        status: "ignored",
        channel: input.channel,
        queued: 0,
        duplicates: 0,
        normalizedEvents: 0,
      };
    }

    let queued = 0;
    let duplicates = 0;

    for (const event of normalizedEvents) {
      try {
        const webhookEvent = await this.prisma.webhookEventLog.create({
          data: {
            eventId: event.eventId,
            channel: this.toPrismaChannel(input.channel),
            signatureValid,
            payload: input.payload as Prisma.InputJsonValue,
            normalizedEvents: [event] as Prisma.InputJsonValue,
            status: "queued",
          },
        });

        await this.inboundQueue.add(
          inboundEventJobName,
          {
            webhookEventLogId: webhookEvent.id,
            normalizedEvent: event,
          },
          {
            jobId: buildInboundJobId(event),
          },
        );

        queued += 1;
      } catch (error) {
        if (this.isUniqueConstraintError(error)) {
          duplicates += 1;
          continue;
        }

        this.logger.error(
          {
            channel: input.channel,
            eventId: event.eventId,
            error: serializeError(error),
          },
          "Failed to persist or queue inbound webhook event.",
        );
        throw error;
      }
    }

    this.logger.info(
      {
        channel: input.channel,
        normalizedEvents: normalizedEvents.length,
        queued,
        duplicates,
      },
      "Accepted inbound Meta webhook payload.",
    );

    return {
      status: "accepted",
      channel: input.channel,
      normalizedEvents: normalizedEvents.length,
      queued,
      duplicates,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.inboundQueue.close();
    await closeQueueConnection();
  }

  private async persistIgnoredWebhook(
    channel: RuntimeChannelType,
    payload: unknown,
  ): Promise<void> {
    const eventId = `${channel}:noop:${createDeterministicId(channel, payload)}`;

    try {
      await this.prisma.webhookEventLog.create({
        data: {
          eventId,
          channel: this.toPrismaChannel(channel),
          signatureValid: true,
          payload: payload as Prisma.InputJsonValue,
          status: "ignored",
        },
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        this.logger.warn(
          {
            channel,
            error: serializeError(error),
          },
          "Failed to persist ignored webhook payload.",
        );
      }
    }
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    );
  }

  private toPrismaChannel(channel: RuntimeChannelType): ChannelType {
    return channel === "whatsapp" ? ChannelType.WHATSAPP : ChannelType.INSTAGRAM;
  }
}
