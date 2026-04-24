import { Module } from "@nestjs/common";
import { CatalogAssetsController } from "./catalog-assets.controller";

@Module({
  controllers: [CatalogAssetsController],
})
export class CatalogAssetsModule {}
