import { Module } from "@nestjs/common";
import { DatabaseModule } from "@meta-chatbot/db";
import { HealthModule } from "./modules/health/health.module";
import { WebhooksModule } from "./modules/webhooks/webhooks.module";

@Module({
  imports: [DatabaseModule, HealthModule, WebhooksModule],
})
export class AppModule {}
