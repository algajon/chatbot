import { Injectable } from "@nestjs/common";
import {
  buildInstagramOutboundTextMessage,
  buildWhatsAppOutboundTextMessage,
} from "@meta-chatbot/channel-adapters";
import { getEnv } from "@meta-chatbot/config";
import { ensureNonEmptyString, type RuntimeChannelType } from "@meta-chatbot/core";
import { createLogger, serializeError } from "@meta-chatbot/logger";

type SendTextMessageInput = {
  channel: RuntimeChannelType;
  recipientId: string;
  text: string;
};

type SendTextMessageResult = {
  channelMessageId?: string;
  rawResponse: Record<string, unknown>;
};

class RetryableHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
  }
}

@Injectable()
export class MetaOutboundMessageService {
  private readonly env = getEnv();
  private readonly logger = createLogger("worker-meta-outbound");

  async sendTextMessage(
    input: SendTextMessageInput,
  ): Promise<SendTextMessageResult> {
    const outboundRequest = this.buildOutboundRequest(input);
    const url = new URL(outboundRequest.endpointPath, "https://graph.facebook.com");

    const rawResponse = await this.postJsonWithRetry(
      url.toString(),
      outboundRequest.accessToken,
      outboundRequest.payload,
      input.channel,
      input.recipientId,
    );

    return {
      channelMessageId: extractChannelMessageId(input.channel, rawResponse),
      rawResponse,
    };
  }

  private buildOutboundRequest(input: SendTextMessageInput) {
    if (input.channel === "whatsapp") {
      if (!this.env.WHATSAPP_ACCESS_TOKEN || !this.env.WHATSAPP_PHONE_NUMBER_ID) {
        throw new Error(
          "WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be configured.",
        );
      }

      return buildWhatsAppOutboundTextMessage({
        graphVersion: this.env.META_GRAPH_VERSION,
        accessToken: this.env.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: this.env.WHATSAPP_PHONE_NUMBER_ID,
        recipientId: input.recipientId,
        text: input.text,
      });
    }

    if (!this.env.INSTAGRAM_PAGE_ACCESS_TOKEN || !this.env.INSTAGRAM_PAGE_ID) {
      throw new Error(
        "INSTAGRAM_PAGE_ACCESS_TOKEN and INSTAGRAM_PAGE_ID must be configured.",
      );
    }

    return buildInstagramOutboundTextMessage({
      graphVersion: this.env.META_GRAPH_VERSION,
      accessToken: this.env.INSTAGRAM_PAGE_ACCESS_TOKEN,
      pageId: this.env.INSTAGRAM_PAGE_ID,
      recipientId: input.recipientId,
      text: input.text,
    });
  }

  private async postJsonWithRetry(
    url: string,
    accessToken: string,
    payload: Record<string, unknown>,
    channel: RuntimeChannelType,
    recipientId: string,
  ): Promise<Record<string, unknown>> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.env.EXTERNAL_HTTP_TIMEOUT_MS,
      );

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        const responseText = await response.text();
        const responseJson = safeJsonParse(responseText);

        if (!response.ok) {
          if (response.status >= 500 || response.status === 429) {
            throw new RetryableHttpError(
              `Meta Graph API returned ${response.status}.`,
              response.status,
              responseText,
            );
          }

          throw new Error(
            `Meta Graph API request failed with status ${response.status}: ${responseText}`,
          );
        }

        this.logger.info(
          {
            channel,
            recipientId,
            attempt,
          },
          "Outbound Meta message sent successfully.",
        );

        return responseJson;
      } catch (error) {
        lastError = error;

        this.logger.warn(
          {
            channel,
            recipientId,
            attempt,
            error: serializeError(error),
          },
          "Outbound Meta message attempt failed.",
        );

        if (attempt >= 3 || !isRetryable(error)) {
          break;
        }

        await delay(500 * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Unknown outbound send failure.");
  }
}

function extractChannelMessageId(
  channel: RuntimeChannelType,
  payload: Record<string, unknown>,
): string | undefined {
  if (channel === "whatsapp") {
    const messages = Array.isArray(payload.messages)
      ? (payload.messages as Array<Record<string, unknown>>)
      : [];

    return ensureNonEmptyString(messages[0]?.id);
  }

  return ensureNonEmptyString(payload.message_id);
}

function safeJsonParse(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof RetryableHttpError) {
    return true;
  }

  return error instanceof DOMException && error.name === "AbortError";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
