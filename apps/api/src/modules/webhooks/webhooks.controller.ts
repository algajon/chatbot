import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import type { RuntimeChannelType } from "@meta-chatbot/core";
import { WebhooksService } from "./webhooks.service";

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

@Controller("webhooks/meta")
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get("verify")
  verifyGeneric(
    @Query() query: Record<string, string | undefined>,
    @Res() response: Response,
  ): void {
    response
      .status(200)
      .send(this.webhooksService.verifyChallengeResponse(query));
  }

  @Get(":channel")
  verifyPerChannel(
    @Param("channel") channel: string,
    @Query() query: Record<string, string | undefined>,
    @Res() response: Response,
  ): void {
    this.assertChannel(channel);
    response
      .status(200)
      .send(this.webhooksService.verifyChallengeResponse(query));
  }

  @Post("whatsapp")
  async handleWhatsApp(
    @Req() request: RawBodyRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.handleInboundWebhook("whatsapp", request, body);
  }

  @Post("instagram")
  async handleInstagram(
    @Req() request: RawBodyRequest,
    @Body() body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.handleInboundWebhook("instagram", request, body);
  }

  private async handleInboundWebhook(
    channel: RuntimeChannelType,
    request: RawBodyRequest,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    return this.webhooksService.handleIncomingWebhook({
      channel,
      payload: body,
      rawBody: request.rawBody ?? Buffer.from(JSON.stringify(body)),
      signatureHeader: request.headers["x-hub-signature-256"],
    });
  }

  private assertChannel(channel: string): asserts channel is RuntimeChannelType {
    if (channel !== "whatsapp" && channel !== "instagram") {
      throw new Error(`Unsupported channel: ${channel}`);
    }
  }
}
