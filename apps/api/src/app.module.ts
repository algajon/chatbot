import { Module } from "@nestjs/common";
import { DatabaseModule } from "@meta-chatbot/db";
import { CatalogAssetsModule } from "./modules/catalog-assets/catalog-assets.module";
import { HealthModule } from "./modules/health/health.module";
import { WebhooksModule } from "./modules/webhooks/webhooks.module";

@Module({
  imports: [DatabaseModule, CatalogAssetsModule, HealthModule, WebhooksModule],
})
export class AppModule {}
