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
      sku: "UNM-22K-001",
      title: "Unaze klasike 22 karat per meshkuj",
      description: "Model klasik me ar te verdhe per meshkuj.",
      category: "unaze",
      targetAudience: "meshkuj",
      karat: 22,
      material: "ar i verdhe",
      weightGrams: 7.2,
      price: {
        display: "85,000 ALL",
      },
      availability: "in_stock",
      tags: ["unaze", "22 karat", "meshkuj"],
      synonyms: ["unaze per burra 22k"],
      styleNotes: ["klasike"],
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
    expect(result.suggestedMatches[0]?.product.sku).toBe("UNM-22K-001");
  });
});
