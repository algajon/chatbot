import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const jewelryCategorySchema = z.enum([
  "unaze",
  "byzylyke",
  "qafore",
  "zinxhire",
  "varese",
  "vathe",
  "komplete",
  "ore",
  "tjeter",
]);
export type JewelryCategory = z.infer<typeof jewelryCategorySchema>;

export const targetAudienceSchema = z.enum(["meshkuj", "femra", "unisex", "femije"]);
export type TargetAudience = z.infer<typeof targetAudienceSchema>;

export const availabilitySchema = z.enum(["in_stock", "limited", "out_of_stock", "made_to_order"]);
export type Availability = z.infer<typeof availabilitySchema>;

export const catalogImageSchema = z.object({
  ref: z.string().min(1),
  altText: z.string().min(1),
});
export type CatalogImage = z.infer<typeof catalogImageSchema>;

export const jewelryProductSchema = z.object({
  sku: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  category: jewelryCategorySchema,
  targetAudience: targetAudienceSchema,
  karat: z.number().int().positive().optional(),
  material: z.string().min(1),
  stone: z.string().min(1).optional(),
  weightGrams: z.number().positive().optional(),
  price: z.object({
    amount: z.number().nonnegative().optional(),
    currency: z.string().min(1).default("ALL"),
    display: z.string().min(1),
  }),
  availability: availabilitySchema.default("in_stock"),
  tags: z.array(z.string().min(1)).default([]),
  synonyms: z.array(z.string().min(1)).default([]),
  styleNotes: z.array(z.string().min(1)).default([]),
  images: z.array(catalogImageSchema).default([]),
});
export type JewelryProduct = z.infer<typeof jewelryProductSchema>;

export const jewelryCatalogSchema = z.object({
  store: z.object({
    name: z.string().min(1),
    defaultLanguage: z.string().min(1).default("sq-AL"),
    currency: z.string().min(1).default("ALL"),
    notes: z.string().min(1).optional(),
  }),
  products: z.array(jewelryProductSchema).min(1),
});
export type JewelryCatalog = z.infer<typeof jewelryCatalogSchema>;

export type CatalogFilters = {
  category?: JewelryCategory;
  targetAudience?: TargetAudience;
  karat?: number;
  material?: string;
  stone?: string;
};

export type CatalogPricePreference = "higher" | "lower";

export type CatalogSearchMatch = {
  product: JewelryProduct;
  score: number;
  exactFilterMatch: boolean;
  matchedFields: string[];
};

export type CatalogSearchResult = {
  storeName: string;
  storeCurrency: string;
  storeNotes?: string;
  query: string;
  normalizedQuery: string;
  filters: CatalogFilters;
  pricePreference?: CatalogPricePreference;
  exactMatches: CatalogSearchMatch[];
  suggestedMatches: CatalogSearchMatch[];
};

type CachedCatalog = {
  mtimeMs: number;
  catalog: JewelryCatalog;
};

type QueryAnalysis = {
  normalizedQuery: string;
  rawTokens: string[];
  tokens: string[];
  filters: CatalogFilters;
  pricePreference?: CatalogPricePreference;
};

const catalogCache = new Map<string, CachedCatalog>();

const CATEGORY_KEYWORDS: Record<JewelryCategory, string[]> = {
  unaze: ["unaz", "unaze", "unaza", "ring", "rings"],
  byzylyke: ["byzylyk", "byzylyke", "bracelet", "bracelets"],
  qafore: ["qafore", "necklace", "necklaces"],
  zinxhire: ["zinxhir", "zinxhire", "chain", "chains"],
  varese: ["varese", "varse", "pendant", "pendants"],
  vathe: ["vathe", "vath", "earring", "earrings"],
  komplete: ["komplet", "komplete", "set", "sets"],
  ore: ["ore", "watch", "watches"],
  tjeter: [],
};

const AUDIENCE_KEYWORDS: Record<TargetAudience, string[]> = {
  meshkuj: ["meshkuj", "meshkujve", "meshkujsh", "burra", "burrash", "mens", "men"],
  femra: ["femra", "grave", "gra", "zonja", "ladies", "women", "womens"],
  unisex: ["unisex"],
  femije: ["femije", "femijesh", "kids", "children"],
};

const MATERIAL_KEYWORDS = {
  "ar i verdhe": ["ar i verdhe", "ari verdhe", "gold", "yellow gold", "flori"],
  "ar i bardhe": ["ar i bardhe", "ari bardhe", "white gold"],
  argjend: ["argjend", "silver"],
  platin: ["platin", "platinum"],
} as const;

const STONE_KEYWORDS = [
  "diamant",
  "diamante",
  "zirkon",
  "safir",
  "rubin",
  "smerald",
  "perle",
] as const;

const QUERY_STOPWORDS = new Set(
  [
    "a",
    "apo",
    "edhe",
    "dua",
    "du",
    "duhna",
    "do",
    "deshiroj",
    "deshirojme",
    "po",
    "kerkoj",
    "kerkoi",
    "kerkova",
    "kerkojna",
    "kam",
    "keni",
    "jeni",
    "na",
    "nje",
    "nj",
    "ndonje",
    "dicka",
    "diqka",
    "pak",
    "ca",
    "me",
    "ma",
    "te",
    "per",
    "prej",
    "tek",
    "si",
    "qe",
    "ose",
    "edhe",
    "nese",
    "ju",
    "mua",
    "m",
    "i",
    "e",
    "t",
    "vec",
    "vetem",
  ].map((token) => normalizeSearchText(token)),
);

const HIGHER_PRICE_ROOTS = [
  "shtrenjt",
  "shtrejt",
  "kushtuesh",
  "luksoz",
  "ekskluziv",
  "premium",
] as const;

const LOWER_PRICE_ROOTS = [
  "lir",
  "ekonom",
  "buxhet",
  "budget",
  "ofert",
  "zbrit",
] as const;

export function resolveCatalogFilePath(filePath?: string): string {
  return path.resolve(process.cwd(), filePath ?? "data/argjendari-catalog.al.json");
}

export function loadJewelryCatalog(filePath?: string): JewelryCatalog {
  const resolvedPath = resolveCatalogFilePath(filePath);
  const stats = statSync(resolvedPath);
  const cached = catalogCache.get(resolvedPath);

  if (cached && cached.mtimeMs === stats.mtimeMs) {
    return cached.catalog;
  }

  const raw = readFileSync(resolvedPath, "utf8");
  const parsed = jewelryCatalogSchema.parse(JSON.parse(raw) as unknown);

  catalogCache.set(resolvedPath, {
    mtimeMs: stats.mtimeMs,
    catalog: parsed,
  });

  return parsed;
}

export function clearCatalogCacheForTests(): void {
  catalogCache.clear();
}

export function searchJewelryCatalog(params: {
  query: string;
  catalog: JewelryCatalog;
  limit?: number;
}): CatalogSearchResult {
  const limit = params.limit ?? 3;
  const analysis = analyzeQuery(params.query);

  const matches = rankMatches(
    params.catalog.products
    .map((product) => scoreProduct(product, analysis))
    .filter((match): match is CatalogSearchMatch => Boolean(match)),
    analysis.pricePreference,
  );

  return {
    storeName: params.catalog.store.name,
    storeCurrency: params.catalog.store.currency,
    storeNotes: params.catalog.store.notes,
    query: params.query,
    normalizedQuery: analysis.normalizedQuery,
    filters: analysis.filters,
    pricePreference: analysis.pricePreference,
    exactMatches: matches.filter((match) => match.exactFilterMatch).slice(0, limit),
    suggestedMatches: matches.slice(0, limit),
  };
}

export function formatCatalogSearchForPrompt(
  search: CatalogSearchResult | undefined,
): string | undefined {
  if (!search) {
    return undefined;
  }

  const lines = [
    "Katalogu i argjendarise:",
    `Dyqani: ${search.storeName}`,
    `Monedha baze: ${search.storeCurrency}`,
    `Pyetja e klientit: ${search.query}`,
  ];

  if (search.storeNotes) {
    lines.push(`Shenime dyqani: ${search.storeNotes}`);
  }

  if (search.filters.category) {
    lines.push(`Kategori e kerkuar: ${search.filters.category}`);
  }

  if (search.filters.targetAudience) {
    lines.push(`Grupi i kerkuar: ${search.filters.targetAudience}`);
  }

  if (typeof search.filters.karat === "number") {
    lines.push(`Karat i kerkuar: ${search.filters.karat}`);
  }

  if (search.filters.material) {
    lines.push(`Materiali i kerkuar: ${search.filters.material}`);
  }

  if (search.filters.stone) {
    lines.push(`Guri i kerkuar: ${search.filters.stone}`);
  }

  if (search.pricePreference === "higher") {
    lines.push("Preferenca e klientit: modele me te shtrenjta.");
  } else if (search.pricePreference === "lower") {
    lines.push("Preferenca e klientit: modele me te lira.");
  }

  const exactMatches = search.exactMatches.map((match, index) =>
    `${index + 1}. ${formatMatchForPrompt(match)}`,
  );
  const suggestedMatches = search.suggestedMatches.map((match, index) =>
    `${index + 1}. ${formatMatchForPrompt(match)}`,
  );

  if (exactMatches.length > 0) {
    lines.push("Perputhjet me te sakta:");
    lines.push(...exactMatches);
  } else {
    lines.push("Perputhje e sakte nuk u gjet.");
  }

  if (suggestedMatches.length > 0) {
    lines.push("Sugjerimet me te aferta:");
    lines.push(...suggestedMatches);
  }

  return lines.join("\n");
}

export function buildCatalogFallbackReply(
  search: CatalogSearchResult | undefined,
): string | undefined {
  if (!search) {
    return undefined;
  }

  if (search.exactMatches.length > 0) {
    const topMatch = search.exactMatches[0]?.product;
    if (!topMatch) {
      return undefined;
    }

    return `Po, kemi ${buildFriendlyProductMention(topMatch)} 😊 Nese doni, mund t'ju tregoj edhe modele te ngjashme.`;
  }

  if (search.suggestedMatches.length > 0) {
    const topMatch = search.suggestedMatches[0]?.product;
    if (!topMatch) {
      return undefined;
    }

    return `Pikerisht ate model nuk e gjeta, por kam ${buildFriendlyProductMention(topMatch)} si variant shume te afert 😊 Nese doni, mund ta ngushtoj kerkimin sipas karatit, modelit ose buxhetit.`;
  }

  return "Per momentin nuk po me del nje model i sakte per kete pershkrim 😊 Nese doni, me tregoni kategorine, karatin ose buxhetin dhe ju sugjeroj dicka me te afert.";
}

export function getTopCatalogProduct(
  search: CatalogSearchResult | undefined,
): JewelryProduct | undefined {
  return search?.exactMatches[0]?.product ?? search?.suggestedMatches[0]?.product;
}

export function resolveCatalogImageUrl(params: {
  product: JewelryProduct;
  baseUrl: string;
}): string | undefined {
  const imageRef = params.product.images[0]?.ref?.trim();
  if (!imageRef) {
    return undefined;
  }

  if (/^https?:\/\//i.test(imageRef)) {
    return imageRef;
  }

  const normalizedRef = imageRef.replace(/^\/+/, "");
  const encodedPath = normalizedRef
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${params.baseUrl.replace(/\/+$/, "")}/catalog-assets/${encodedPath}`;
}

function analyzeQuery(query: string): QueryAnalysis {
  const normalizedQuery = normalizeSearchText(query);
  const rawTokens = tokenizeSearchText(normalizedQuery);
  const tokens = rawTokens
    .map(canonicalizeToken)
    .filter((token) => token.length > 1 && !QUERY_STOPWORDS.has(token));

  return {
    normalizedQuery,
    rawTokens,
    tokens,
    filters: {
      category: detectMappedValue(normalizedQuery, CATEGORY_KEYWORDS),
      targetAudience: detectMappedValue(normalizedQuery, AUDIENCE_KEYWORDS),
      karat: detectKarat(normalizedQuery),
      material: detectMaterial(normalizedQuery),
      stone: detectStone(normalizedQuery),
    },
    pricePreference: detectPricePreference(rawTokens),
  };
}

function scoreProduct(
  product: JewelryProduct,
  analysis: QueryAnalysis,
): CatalogSearchMatch | null {
  const searchableText = normalizeSearchText(
    [
      product.title,
      product.description,
      product.category,
      product.targetAudience,
      product.material,
      product.stone,
      ...product.tags,
      ...product.synonyms,
      ...product.styleNotes,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" "),
  );
  const searchableTokens = new Set(
    tokenizeSearchText(searchableText)
      .map(canonicalizeToken)
      .filter((token) => token.length > 1 && !QUERY_STOPWORDS.has(token)),
  );

  let score = 0;
  let explicitFilterCount = 0;
  let exactFilterMatch = true;
  const matchedFields = new Set<string>();

  if (analysis.filters.category) {
    explicitFilterCount += 1;
    if (product.category === analysis.filters.category) {
      score += 40;
      matchedFields.add("category");
    } else {
      score -= 25;
      exactFilterMatch = false;
    }
  }

  if (analysis.filters.targetAudience) {
    explicitFilterCount += 1;
    if (
      product.targetAudience === analysis.filters.targetAudience ||
      product.targetAudience === "unisex"
    ) {
      score += 24;
      matchedFields.add("targetAudience");
    } else {
      score -= 15;
      exactFilterMatch = false;
    }
  }

  if (typeof analysis.filters.karat === "number") {
    explicitFilterCount += 1;
    if (product.karat === analysis.filters.karat) {
      score += 28;
      matchedFields.add("karat");
    } else {
      score -= 25;
      exactFilterMatch = false;
    }
  }

  if (analysis.filters.material) {
    explicitFilterCount += 1;
    const normalizedMaterial = normalizeSearchText(product.material);
    const normalizedRequestedMaterial = normalizeSearchText(analysis.filters.material);
    if (normalizedMaterial.includes(normalizedRequestedMaterial)) {
      score += 16;
      matchedFields.add("material");
    } else {
      score -= 10;
      exactFilterMatch = false;
    }
  }

  if (analysis.filters.stone) {
    explicitFilterCount += 1;
    const normalizedStone = normalizeSearchText(product.stone ?? "");
    if (normalizedStone.includes(analysis.filters.stone)) {
      score += 12;
      matchedFields.add("stone");
    } else {
      score -= 8;
      exactFilterMatch = false;
    }
  }

  let tokenOverlap = 0;
  for (const token of analysis.tokens) {
    if (hasLooseTokenMatch(token, searchableTokens)) {
      tokenOverlap += 1;
    }
  }

  score += tokenOverlap * 4;

  if (product.availability === "in_stock") {
    score += 5;
  } else if (product.availability === "limited") {
    score += 2;
  }

  if (analysis.pricePreference) {
    const priceAmount = getComparablePriceAmount(product);
    if (typeof priceAmount === "number") {
      score += 3;
      matchedFields.add(analysis.pricePreference === "higher" ? "price-higher" : "price-lower");
    } else {
      score -= 3;
    }
  }

  if (tokenOverlap === 0 && matchedFields.size === 0 && !analysis.pricePreference) {
    return null;
  }

  if (score <= 0) {
    return null;
  }

  return {
    product,
    score,
    exactFilterMatch:
      explicitFilterCount > 0
        ? exactFilterMatch
        : tokenOverlap > 0 || Boolean(analysis.pricePreference),
    matchedFields: [...matchedFields],
  };
}

function rankMatches(
  matches: CatalogSearchMatch[],
  pricePreference?: CatalogPricePreference,
): CatalogSearchMatch[] {
  return applyPricePreferenceBoost(matches, pricePreference).sort((left, right) => {
    const scoreDelta = right.score - left.score;
    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    if (pricePreference) {
      const priceDelta = compareByPricePreference(left.product, right.product, pricePreference);
      if (priceDelta !== 0) {
        return priceDelta;
      }
    }

    if (left.exactFilterMatch !== right.exactFilterMatch) {
      return Number(right.exactFilterMatch) - Number(left.exactFilterMatch);
    }

    return left.product.title.localeCompare(right.product.title, "sq");
  });
}

function applyPricePreferenceBoost(
  matches: CatalogSearchMatch[],
  pricePreference?: CatalogPricePreference,
): CatalogSearchMatch[] {
  if (!pricePreference) {
    return [...matches];
  }

  const pricedMatches = matches.filter(
    (match) => typeof getComparablePriceAmount(match.product) === "number",
  );

  if (pricedMatches.length === 0) {
    return [...matches];
  }

  const amounts = pricedMatches.map((match) => getComparablePriceAmount(match.product) as number);
  const minAmount = Math.min(...amounts);
  const maxAmount = Math.max(...amounts);
  const range = Math.max(maxAmount - minAmount, 1);

  return matches.map((match) => {
    const amount = getComparablePriceAmount(match.product);

    if (typeof amount !== "number") {
      return {
        ...match,
        score: match.score - 6,
      };
    }

    const normalizedPreference =
      pricePreference === "higher"
        ? (amount - minAmount) / range
        : (maxAmount - amount) / range;

    return {
      ...match,
      score: match.score + Math.round(normalizedPreference * 18),
    };
  });
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearchText(value: string): string[] {
  return normalizeSearchText(value)
    .split(" ")
    .filter((token) => token.length > 0);
}

function canonicalizeToken(token: string): string {
  let value = normalizeSearchText(token);

  for (const suffix of [
    "ve",
    "eve",
    "ave",
    "veve",
    "it",
    "at",
    "et",
    "es",
    "en",
    "in",
    "ne",
    "ve",
    "ve",
    "a",
    "e",
    "i",
    "u",
    "t",
  ]) {
    if (value.length > 5 && value.endsWith(suffix)) {
      value = value.slice(0, -suffix.length);
      break;
    }
  }

  return value;
}

function detectPricePreference(
  rawTokens: string[],
): CatalogPricePreference | undefined {
  if (rawTokens.some((token) => containsRoot(token, HIGHER_PRICE_ROOTS))) {
    return "higher";
  }

  if (rawTokens.some((token) => containsRoot(token, LOWER_PRICE_ROOTS))) {
    return "lower";
  }

  return undefined;
}

function containsRoot(
  value: string,
  roots: readonly string[],
): boolean {
  const normalizedValue = canonicalizeToken(value);
  return roots.some((root) => normalizedValue.includes(root));
}

function hasLooseTokenMatch(
  token: string,
  searchableTokens: Set<string>,
): boolean {
  if (searchableTokens.has(token)) {
    return true;
  }

  if (token.length < 4) {
    return false;
  }

  for (const candidate of searchableTokens) {
    if (
      candidate.startsWith(token) ||
      token.startsWith(candidate) ||
      sharedPrefixLength(candidate, token) >= Math.min(candidate.length, token.length) - 1
    ) {
      return true;
    }
  }

  return false;
}

function sharedPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let index = 0;

  while (index < max && left[index] === right[index]) {
    index += 1;
  }

  return index;
}

function compareByPricePreference(
  left: JewelryProduct,
  right: JewelryProduct,
  pricePreference: CatalogPricePreference,
): number {
  const normalizedLeftAmount = getComparablePriceAmount(left);
  const normalizedRightAmount = getComparablePriceAmount(right);

  if (
    typeof normalizedLeftAmount === "number" &&
    typeof normalizedRightAmount === "number"
  ) {
    return pricePreference === "higher"
      ? normalizedRightAmount - normalizedLeftAmount
      : normalizedLeftAmount - normalizedRightAmount;
  }

  if (typeof normalizedLeftAmount === "number") {
    return -1;
  }

  if (typeof normalizedRightAmount === "number") {
    return 1;
  }

  return 0;
}

function getComparablePriceAmount(product: JewelryProduct): number | undefined {
  const amount = product.price.amount;
  return typeof amount === "number" && amount > 0 ? amount : undefined;
}

function detectMappedValue<T extends string>(
  normalizedQuery: string,
  mapping: Record<T, string[]>,
): T | undefined {
  for (const [value, keywords] of Object.entries(mapping) as Array<[T, string[]]>) {
    for (const keyword of keywords) {
      if (normalizedQuery.includes(normalizeSearchText(keyword))) {
        return value;
      }
    }
  }

  return undefined;
}

function detectKarat(normalizedQuery: string): number | undefined {
  const match = normalizedQuery.match(/\b(8|9|10|12|14|18|21|22|24)\s*(k|karat)\b/);
  if (match) {
    return Number(match[1]);
  }

  return undefined;
}

function detectMaterial(normalizedQuery: string): string | undefined {
  for (const [material, keywords] of Object.entries(MATERIAL_KEYWORDS)) {
    if (keywords.some((keyword) => normalizedQuery.includes(normalizeSearchText(keyword)))) {
      return material;
    }
  }

  return undefined;
}

function detectStone(normalizedQuery: string): string | undefined {
  return STONE_KEYWORDS.find((keyword) =>
    normalizedQuery.includes(normalizeSearchText(keyword)),
  );
}

function formatMatchForPrompt(match: CatalogSearchMatch): string {
  return `${formatProductSummary(match.product)} | score=${match.score}`;
}

function formatProductSummary(product: JewelryProduct): string {
  const parts = [
    `${product.title} (${product.sku})`,
    product.karat ? `${product.karat}K` : undefined,
    product.targetAudience,
    product.material,
    product.weightGrams ? `${product.weightGrams}g` : undefined,
    product.price.display,
  ];

  return parts.filter((value): value is string => Boolean(value)).join(" | ");
}

function buildFriendlyProductMention(product: JewelryProduct): string {
  const parts = [
    product.title,
    product.karat ? `${product.karat}K` : undefined,
    product.price.display,
  ];

  return parts.filter((value): value is string => Boolean(value)).join(" me ");
}
