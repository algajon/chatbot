import { Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";

const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

@Controller("catalog-assets")
export class CatalogAssetsController {
  @Get(":filename")
  getAsset(
    @Param("filename") filename: string,
    @Res() response: Response,
  ): void {
    const safeName = path.basename(filename);
    if (safeName !== filename) {
      throw new NotFoundException("Asset not found.");
    }

    const extension = path.extname(safeName).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      throw new NotFoundException("Asset not found.");
    }

    const assetPath = path.resolve(process.cwd(), "data", safeName);
    if (!existsSync(assetPath)) {
      throw new NotFoundException("Asset not found.");
    }

    response.sendFile(assetPath);
  }
}
