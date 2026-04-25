import { describe, expect, it } from "vitest";
import {
  jewelryCatalogSchema,
  searchJewelryCatalog,
} from "../src";

const catalog = jewelryCatalogSchema.parse({
  store: {
    name: "Argjendari Test",
    defaultLanguage: "sq-AL",
    currency: "ALL",
  },
  products: [
    {
      sku: "UNM-14K-LOW",
      title: "Unaze per meshkuj 14 karat ekonomike",
      description: "Model i thjeshte dhe ekonomik me ar te verdhe.",
      category: "unaze",
      targetAudience: "meshkuj",
      karat: 14,
      material: "ar i verdhe",
      weightGrams: 5.1,
      price: {
        amount: 45000,
        display: "45,000 ALL",
      },
      availability: "in_stock",
      tags: ["unaze", "meshkuj", "ekonomike"],
      synonyms: ["unaze te lira per meshkuj"],
      styleNotes: ["klasike"],
      images: [],
    },
    {
      sku: "UNM-22K-001",
      title: "Unaze klasike 22 karat per meshkuj",
      description: "Model klasik me ar te verdhe per meshkuj.",
      category: "unaze",
      targetAudience: "meshkuj",
      karat: 22,
      material: "ar i verdhe",
      weightGrams: 7.2,
      price: {
        amount: 85000,
        display: "85,000 ALL",
      },
      availability: "in_stock",
      tags: ["unaze", "22 karat", "meshkuj"],
      synonyms: ["unaze per burra 22k"],
      styleNotes: ["klasike"],
      images: [],
    },
    {
      sku: "UNM-22K-002",
      title: "Unaze luksoze 22 karat per meshkuj",
      description: "Model luksoz me punim te rende dhe pamje premium.",
      category: "unaze",
      targetAudience: "meshkuj",
      karat: 22,
      material: "ar i verdhe",
      weightGrams: 9.8,
      price: {
        amount: 140000,
        display: "140,000 ALL",
      },
      availability: "in_stock",
      tags: ["unaze", "22 karat", "meshkuj", "luksoze"],
      synonyms: ["unaze ma te shtrejta per meshkuj"],
      styleNotes: ["premium"],
      images: [],
    },
    {
      sku: "BYF-925-001",
      title: "Byzylyk argjendi per femra",
      description: "Byzylyk elegant nga argjendi 925.",
      category: "byzylyke",
      targetAudience: "femra",
      material: "argjend",
      weightGrams: 4.1,
      price: {
        amount: 12500,
        display: "12,500 ALL",
      },
      availability: "in_stock",
      tags: ["byzylyk", "argjend", "femra"],
      synonyms: [],
      styleNotes: ["elegant"],
      images: [],
    },
  ],
});

describe("@meta-chatbot/catalog", () => {
  it("finds an exact Albanian match for a mens 22 karat ring query", () => {
    const result = searchJewelryCatalog({
      query: "a keni unaze 22 karat te meshkujve",
      catalog,
    });

    expect(result.filters.category).toBe("unaze");
    expect(result.filters.targetAudience).toBe("meshkuj");
    expect(result.filters.karat).toBe(22);
    expect(result.exactMatches[0]?.product.sku).toBe("UNM-22K-001");
  });

  it("suggests the silver bracelet for a womens silver bracelet query", () => {
    const result = searchJewelryCatalog({
      query: "po kerkoj byzylyk argjendi per femra",
      catalog,
    });

    expect(result.filters.category).toBe("byzylyke");
    expect(result.filters.targetAudience).toBe("femra");
    expect(result.filters.material).toBe("argjend");
    expect(result.suggestedMatches[0]?.product.sku).toBe("BYF-925-001");
  });

  it("matches a broad mens ring query written as 'Unaz per Meshkuj'", () => {
    const result = searchJewelryCatalog({
      query: "Unaz per Meshkuj",
      catalog,
    });

    expect(result.filters.category).toBe("unaze");
    expect(result.filters.targetAudience).toBe("meshkuj");
    expect(result.suggestedMatches[0]?.product.category).toBe("unaze");
  });

  it("ranks more expensive mens rings first for a loosely typed Albanian query", () => {
    const result = searchJewelryCatalog({
      query: "unaz ma t shtrejta per meshkuj",
      catalog,
    });

    expect(result.pricePreference).toBe("higher");
    expect(result.filters.category).toBe("unaze");
    expect(result.filters.targetAudience).toBe("meshkuj");
    expect(result.suggestedMatches[0]?.product.sku).toBe("UNM-22K-002");
  });

  it("ranks cheaper rings first when the customer asks for lower prices", () => {
    const result = searchJewelryCatalog({
      query: "unaza me te lira",
      catalog,
    });

    expect(result.pricePreference).toBe("lower");
    expect(result.filters.category).toBe("unaze");
    expect(result.suggestedMatches[0]?.product.sku).toBe("UNM-14K-LOW");
  });

  it("surfaces pricier jewelry for a broad 'more expensive' request", () => {
    const result = searchJewelryCatalog({
      query: "dua dicka me te shtrenjte",
      catalog,
    });

    expect(result.pricePreference).toBe("higher");
    expect(result.suggestedMatches[0]?.product.sku).toBe("UNM-22K-002");
  });
});
