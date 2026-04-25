const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createWorker } = require("tesseract.js");
const { imageSize } = require("image-size");

const MANIFEST_PATH = path.resolve(
  process.cwd(),
  "data",
  "dardani-catalog-scrape",
  "manifest.json",
);
const OCR_CACHE_PATH = path.resolve(
  process.cwd(),
  "data",
  "dardani-catalog-scrape",
  "ocr-price-cache.json",
);
const OUTPUT_PATH = path.resolve(process.cwd(), "data", "argjendari-catalog.al.json");
const OCR_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.DARDANI_OCR_CONCURRENCY ?? "4", 10) || 4,
);
const IMPORT_LIMIT = Math.max(
  0,
  Number.parseInt(process.env.DARDANI_IMPORT_LIMIT ?? "0", 10) || 0,
);

async function main() {
  const manifest = JSON.parse(await fsp.readFile(MANIFEST_PATH, "utf8"));
  const cache = await readJsonIfExists(OCR_CACHE_PATH, {});
  const images = collectManifestImages(manifest);

  console.log(
    `[import] found ${manifest.categories.length} categories and ${images.length} images`,
  );

  await runOcrImport(images, cache);

  const catalog = buildCatalog(manifest, cache);
  await fsp.writeFile(OUTPUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  await fsp.writeFile(OCR_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf8");

  const pricedCount = catalog.products.filter((product) => typeof product.price.amount === "number")
    .length;

  console.log(
    `[import] wrote ${catalog.products.length} products to ${OUTPUT_PATH}`,
  );
  console.log(
    `[import] extracted prices for ${pricedCount} products`,
  );
}

function collectManifestImages(manifest) {
  const images = manifest.categories.flatMap((category) =>
    (category.images ?? []).map((image) => ({
      cacheKey: `${category.slug}:${image.id}`,
      category,
      image,
      localPath: image.fullLocalPath
        ? path.resolve(process.cwd(), image.fullLocalPath)
        : null,
    })),
  );

  return IMPORT_LIMIT > 0 ? images.slice(0, IMPORT_LIMIT) : images;
}

async function runOcrImport(images, cache) {
  let completed = 0;
  let nextIndex = 0;

  const workers = await Promise.all(
    Array.from({ length: OCR_CONCURRENCY }, () => createWorker("eng")),
  );

  try {
    await Promise.all(
      workers.map(async (worker) => {
        while (nextIndex < images.length) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          const item = images[currentIndex];
          const cached = cache[item.cacheKey];

          if (!cached?.priceDisplay) {
            cache[item.cacheKey] = await extractImageCatalogMeta(worker, item);
          }

          completed += 1;
          if (completed % 100 === 0 || completed === images.length) {
            console.log(`[import] processed ${completed}/${images.length}`);
          }
        }
      }),
    );
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}

async function extractImageCatalogMeta(worker, item) {
  const imagePath = item.localPath;
  if (!imagePath || !fs.existsSync(imagePath)) {
    return {
      priceAmount: null,
      priceCurrency: null,
      priceDisplay: null,
      sourceText: null,
      missingLocalImage: true,
    };
  }

  const dimensions = imageSize(fs.readFileSync(imagePath));
  if (!dimensions.width || !dimensions.height) {
    return {
      priceAmount: null,
      priceCurrency: null,
      priceDisplay: null,
      sourceText: null,
      invalidImage: true,
    };
  }

  const rectangle = {
    left: Math.floor(dimensions.width * 0.56),
    top: Math.floor(dimensions.height * 0.68),
    width: Math.floor(dimensions.width * 0.4),
    height: Math.floor(dimensions.height * 0.24),
  };

  const result = await worker.recognize(imagePath, {
    rectangle,
  });

  const sourceText = normalizeWhitespace(result.data.text ?? "");
  const priceMatch = extractPrice(sourceText);

  return {
    priceAmount: priceMatch?.amount ?? null,
    priceCurrency: priceMatch?.currency ?? null,
    priceDisplay: priceMatch?.display ?? null,
    sourceText,
    confidence: result.data.confidence ?? null,
  };
}

function buildCatalog(manifest, cache) {
  const products = [];
  let imported = 0;

  for (const category of manifest.categories) {
    for (const image of category.images ?? []) {
      if (IMPORT_LIMIT > 0 && imported >= IMPORT_LIMIT) {
        break;
      }

      const key = `${category.slug}:${image.id}`;
      const cached = cache[key] ?? {};
      const categoryInfo = mapCategory(category);
      const title = `${categoryInfo.displayName} ${category.material} - Modeli ${image.id}`;
      const description = buildDescription(categoryInfo, category.material, cached.priceDisplay);
      const price =
        typeof cached.priceAmount === "number"
          ? {
              amount: cached.priceAmount,
              currency: cached.priceCurrency ?? "EUR",
              display: cached.priceDisplay,
            }
          : {
              currency: "EUR",
              display: "Cmimi sipas kerkeses",
            };

      products.push({
        sku: `DARDANI-${category.id}-${image.id}`,
        title,
        description,
        category: categoryInfo.category,
        targetAudience: categoryInfo.targetAudience,
        material: mapMaterial(category.material),
        price,
        availability: "in_stock",
        tags: uniqueStrings([
          categoryInfo.displayName,
          category.name,
          category.slug.replace(/-/g, " "),
          category.material,
          categoryInfo.targetAudience,
          categoryInfo.category,
          ...slugToTokens(category.slug),
        ]),
        synonyms: uniqueStrings(buildSynonyms(categoryInfo, category)),
        styleNotes: uniqueStrings([
          `Kodi i katalogut ${image.id}`,
          typeof cached.priceAmount === "number"
            ? `Cmimi i lexuar nga imazhi: ${cached.priceDisplay}`
            : "Cmimi nuk u lexua nga imazhi",
        ]),
        images: [
          {
            ref: image.fullUrl,
            altText: title,
          },
        ],
      });
      imported += 1;
    }

    if (IMPORT_LIMIT > 0 && imported >= IMPORT_LIMIT) {
      break;
    }
  }

  return {
    store: {
      name: "Argjendaria Dardani",
      defaultLanguage: "sq-AL",
      currency: "EUR",
      notes:
        "Katalog i importuar nga katallogu.argjendariadardani.com. Lloji dhe materiali vijne nga kategorite e faqes, ndersa cmimet lexohen automatikisht nga imazhet kur jane te dukshme.",
    },
    products,
  };
}

function mapCategory(category) {
  const slug = normalizeSearchText(category.slug);
  const name = normalizeSearchText(category.name);
  const combined = `${slug} ${name}`;

  if (combined.includes("unaze") || combined.includes("rath")) {
    return {
      category: "unaze",
      targetAudience: detectTargetAudience(combined),
      displayName: decodeCatalogName(category.name),
    };
  }

  if (combined.includes("byzylyk")) {
    return {
      category: "byzylyke",
      targetAudience: detectTargetAudience(combined),
      displayName: decodeCatalogName(category.name),
    };
  }

  if (combined.includes("qafore")) {
    return {
      category: "qafore",
      targetAudience: detectTargetAudience(combined),
      displayName: decodeCatalogName(category.name),
    };
  }

  if (combined.includes("zingjir") || combined.includes("zinxhir") || combined.includes("chain")) {
    return {
      category: "zinxhire",
      targetAudience: detectTargetAudience(combined),
      displayName: decodeCatalogName(category.name),
    };
  }

  if (combined.includes("varese") || combined.includes("varse") || combined.includes("stoli")) {
    return {
      category: "varese",
      targetAudience: detectTargetAudience(combined),
      displayName: decodeCatalogName(category.name),
    };
  }

  if (combined.includes("vathe")) {
    return {
      category: "vathe",
      targetAudience: detectTargetAudience(combined),
      displayName: decodeCatalogName(category.name),
    };
  }

  if (combined.includes("komplet")) {
    return {
      category: "komplete",
      targetAudience: detectTargetAudience(combined),
      displayName: decodeCatalogName(category.name),
    };
  }

  if (combined.includes("ore")) {
    return {
      category: "ore",
      targetAudience: detectTargetAudience(combined),
      displayName: decodeCatalogName(category.name),
    };
  }

  return {
    category: "tjeter",
    targetAudience: detectTargetAudience(combined),
    displayName: decodeCatalogName(category.name),
  };
}

function detectTargetAudience(value) {
  if (value.includes("meshkuj")) {
    return "meshkuj";
  }

  if (value.includes("femije")) {
    return "femije";
  }

  if (value.includes("femra") || value.includes("gra")) {
    return "femra";
  }

  return "unisex";
}

function mapMaterial(material) {
  if (normalizeSearchText(material).includes("argjend")) {
    return "argjend";
  }

  return "ar i verdhe";
}

function buildDescription(categoryInfo, material, priceDisplay) {
  const base = `${categoryInfo.displayName} ${material} nga katalogu i Argjendaria Dardani.`;
  if (priceDisplay) {
    return `${base} Cmimi i shenuar ne katalog eshte ${priceDisplay}.`;
  }

  return `${base} Cmimi nuk eshte lexuar qarte nga imazhi.`;
}

function buildSynonyms(categoryInfo, category) {
  const displayName = decodeCatalogName(category.name);
  const material = normalizeSearchText(category.material).includes("argjend")
    ? "argjend"
    : "ari";
  const synonyms = [
    `${displayName} ${material}`,
    category.slug.replace(/-/g, " "),
  ];

  if (categoryInfo.targetAudience === "meshkuj") {
    synonyms.push(`${displayName} per meshkuj`, `${displayName} per burra`);
  } else if (categoryInfo.targetAudience === "femra") {
    synonyms.push(`${displayName} per femra`, `${displayName} per gra`);
  } else if (categoryInfo.targetAudience === "femije") {
    synonyms.push(`${displayName} per femije`);
  }

  return synonyms;
}

function slugToTokens(slug) {
  return uniqueStrings(slug.split("-").filter((token) => token.length > 1));
}

function extractPrice(text) {
  if (!text) {
    return null;
  }

  const normalized = text
    .replace(/[Oo]/g, "0")
    .replace(/\s+/g, " ")
    .trim();
  const match = normalized.match(/(\d[\d.,]{1,12})\s*(€|eur|euro|all|lek)/i);

  if (!match) {
    return null;
  }

  const rawAmount = match[1];
  const normalizedAmount = rawAmount.includes(",") && rawAmount.includes(".")
    ? rawAmount.replace(/,/g, "")
    : rawAmount.replace(/,/g, ".");
  const amount = Number.parseFloat(normalizedAmount);

  if (!Number.isFinite(amount)) {
    return null;
  }

  const currencyToken = match[2].toLowerCase();
  const currency =
    currencyToken === "all" || currencyToken === "lek" ? "ALL" : "EUR";
  const display =
    currency === "EUR"
      ? `${formatAmount(amount)} EUR`
      : `${formatAmount(amount)} ALL`;

  return {
    amount,
    currency,
    display,
  };
}

function formatAmount(amount) {
  if (Number.isInteger(amount)) {
    return amount.toString();
  }

  return amount.toFixed(2).replace(/\.00$/, "");
}

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeSearchText(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeCatalogName(value) {
  return normalizeWhitespace(String(value));
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((value) => normalizeWhitespace(value)))];
}

async function readJsonIfExists(filePath, fallbackValue) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return fallbackValue;
    }

    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
