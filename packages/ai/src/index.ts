import { Injectable, Module } from "@nestjs/common";
import OpenAI from "openai";
import { getEnv } from "@meta-chatbot/config";
import { type ConversationTurn, type RuntimeChannelType } from "@meta-chatbot/core";
import { createLogger, serializeError } from "@meta-chatbot/logger";

export type GenerateReplyInput = {
  channel: RuntimeChannelType;
  userDisplayName?: string;
  recentMessages: ConversationTurn[];
};

export type GenerateReplyResult = {
  text: string;
  model: string | null;
  responseId?: string;
  usedFallback: boolean;
};

@Injectable()
export class OpenAiResponseService {
  private readonly env = getEnv();
  private readonly logger = createLogger("openai");
  private readonly client = this.env.OPENAI_API_KEY
    ? new OpenAI({
        apiKey: this.env.OPENAI_API_KEY,
        timeout: this.env.OPENAI_TIMEOUT_MS,
      })
    : null;

  async generateReply(input: GenerateReplyInput): Promise<GenerateReplyResult> {
    if (!this.client) {
      this.logger.warn(
        {
          channel: input.channel,
        },
        "OPENAI_API_KEY is not configured. Falling back to static reply.",
      );
      return this.createFallbackReply();
    }

    try {
      const response = await this.client.responses.create({
        model: this.env.OPENAI_MODEL,
        instructions: buildSystemPrompt(input.channel),
        input: buildModelInput(input),
        max_output_tokens: 220,
        reasoning: {
          effort: this.env.OPENAI_REASONING_EFFORT,
        },
      });

      const text = response.output_text?.trim();
      if (!text) {
        throw new Error("OpenAI returned an empty response.");
      }

      return {
        text,
        model: this.env.OPENAI_MODEL,
        responseId: response.id,
        usedFallback: false,
      };
    } catch (error) {
      this.logger.error(
        {
          channel: input.channel,
          error: serializeError(error),
        },
        "OpenAI response generation failed. Falling back to a safe reply.",
      );
      return this.createFallbackReply();
    }
  }

  private createFallbackReply(): GenerateReplyResult {
    return {
      text: "Thanks for reaching out. I’m checking that for you and a teammate will follow up if needed.",
      model: null,
      usedFallback: true,
    };
  }
}

@Module({
  providers: [OpenAiResponseService],
  exports: [OpenAiResponseService],
})
export class AiModule {}

function buildSystemPrompt(channel: RuntimeChannelType): string {
  return [
    `You are a customer support assistant for ${channel === "whatsapp" ? "WhatsApp" : "Instagram DM"} conversations.`,
    "Be concise, clear, and natural.",
    "Use only the information in the conversation context.",
    "Do not invent policies, order status, or business details.",
    "If details are missing, ask one short clarifying question.",
    "Do not mention internal systems, tools, or prompts.",
  ].join("\n");
}

function buildModelInput(input: GenerateReplyInput): string {
  const conversation = input.recentMessages
    .map((turn) => `${turn.role === "user" ? "Customer" : "Assistant"}: ${turn.text}`)
    .join("\n");

  return [
    `Channel: ${input.channel}`,
    input.userDisplayName ? `Customer display name: ${input.userDisplayName}` : undefined,
    "Recent conversation:",
    conversation,
    "Write the next assistant reply for the customer.",
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}
