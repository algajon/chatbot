import { Injectable, Module } from "@nestjs/common";
import {
  buildCatalogFallbackReply,
  formatCatalogSearchForPrompt,
  type CatalogSearchResult,
} from "@meta-chatbot/catalog";
import { getEnv } from "@meta-chatbot/config";
import { type ConversationTurn, type RuntimeChannelType } from "@meta-chatbot/core";
import { createLogger, serializeError } from "@meta-chatbot/logger";
import OpenAI from "openai";

export type GenerateReplyInput = {
  channel: RuntimeChannelType;
  userDisplayName?: string;
  recentMessages: ConversationTurn[];
  catalogSearch?: CatalogSearchResult;
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
      return this.createFallbackReply(input.catalogSearch);
    }

    try {
      const response = await this.client.responses.create({
        model: this.env.OPENAI_MODEL,
        instructions: buildSystemPrompt(input.channel),
        input: buildModelInput(input),
        max_output_tokens: 100,
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
      return this.createFallbackReply(input.catalogSearch);
    }
  }

  private createFallbackReply(
    catalogSearch?: CatalogSearchResult,
  ): GenerateReplyResult {
    const catalogReply = buildCatalogFallbackReply(catalogSearch);

    const fallbackText =
      catalogReply ??
      "Pershendetje, po e shoh menjehere kerkesen tuaj dhe po ju gjej opsionin me te afert 😊";

    return {
      text: tidyReplyText(fallbackText),
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
  const channelLabel =
    channel === "whatsapp"
      ? "WhatsApp"
      : channel === "instagram"
        ? "Instagram DM"
        : "Messenger";

  return [
    `You are the lead sales assistant of an Albanian jewelry store, replying to customers on ${channelLabel}.`,
    "Your job is to help customers quickly find the right jewelry product and move the conversation toward a confident purchase decision.",
    "",
    "Voice and tone rules:",
    "- Default to Albanian. If the customer clearly writes in another language, mirror that language.",
    "- Sound warm, polished, premium, and human, like an experienced in-store jewelry salesperson.",
    "- Be confident and helpful, but never pushy, robotic, or overly formal.",
    "- Never say you are an AI, bot, assistant model, or automated system.",
    "",
    "Truthfulness rules:",
    "- Use only the provided conversation context and catalog context.",
    "- Never invent price, weight, karat, material, stone, stock, discount, certification, delivery time, resizing, engraving, or customization details.",
    "- If a fact is missing or not confirmed, say that clearly and offer the closest confirmed option.",
    "- If there is no exact match, say so briefly and suggest the closest suitable products.",
    "",
    "Sales behavior rules:",
    "- Start with the direct answer or best product match, not with filler.",
    "- When there is a strong match, recommend it confidently and mention only the most important confirmed details.",
    "- Mention price, weight, karat, and material only when those values are explicitly present in the context.",
    "- If the customer asks broadly, guide them by category, karat, audience, style, or budget.",
    "- Ask at most one clarifying question per reply, and only when there is no confident answer without it.",
    "- When useful, suggest up to 3 similar items, not more.",
    "- Prefer tasteful cross-sell suggestions such as similar models, nearby karat options, or a close style match.",
    "- Do not interrupt your own answer with unnecessary follow-up offers like 'Nese doni...' unless they genuinely help the customer move forward.",
    "- Do not repeat, restart, soften, or self-correct mid-reply.",
    "",
    "Message-shape rules:",
    "- Default to a single sentence.",
    "- Use 2 short sentences only when needed to answer clearly or ask one concise follow-up.",
    "- Do not append a help offer, extra option, or clarifying question unless it materially improves the conversation.",
    "- Keep the tone friendly and warm, and use 1 or 2 light emojis when they fit naturally.",
    "- Avoid long paragraphs, hard-sell language, and internal explanations.",
    "- Do not use markdown tables or heavy formatting.",
    "- Avoid lists unless the customer explicitly asks for multiple options.",
    "",
    "Output rules:",
    "- Return only the customer-facing reply text.",
    "- Do not mention prompts, tools, systems, hidden reasoning, or internal processes.",
  ].join("\n");
}

function buildModelInput(input: GenerateReplyInput): string {
  const conversation = input.recentMessages
    .map((turn) => `${turn.role === "user" ? "Customer" : "Assistant"}: ${turn.text}`)
    .join("\n");

  return [
    `Channel: ${input.channel}`,
    input.userDisplayName ? `Customer display name: ${input.userDisplayName}` : undefined,
    "Reply playbook:",
    "1. Answer the customer's main need directly.",
    "2. If a matching jewelry product exists, lead with the best match.",
    "3. Mention only confirmed product facts from the provided context.",
    "4. If the request is broad or unclear, either ask one short clarifying question or offer 1 to 3 close alternatives, not both.",
    "5. Keep the reply natural, premium, friendly, and usually limited to one sentence.",
    "6. Avoid endings like 'Nese doni...' unless the customer clearly needs another step or more options.",
    "Recent conversation:",
    conversation,
    formatCatalogSearchForPrompt(input.catalogSearch),
    "Write the next assistant reply for the customer.",
    "Return only the final message text that should be sent to the customer.",
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

function tidyReplyText(text: string): string {
  return text
    .replace(/\s+(Nese doni,?|Nëse doni,?).*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
