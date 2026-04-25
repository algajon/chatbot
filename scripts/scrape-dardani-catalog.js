const fs = require("node:fs/promises");
const path = require("node:path");

const SITE_ORIGIN = "https://katallogu.argjendariadardani.com";
const OUTPUT_ROOT = path.resolve(process.cwd(), "data", "dardani-catalog-scrape");
const PAGE_SIZE = 100;
const IMAGE_CONCURRENCY = 4;

async function main() {
  await fs.mkdir(OUTPUT_ROOT, {
    recursive: true,
  });

  const homeHtml = await fetchText(`${SITE_ORIGIN}/`);
  const bundlePath = extractRequired(homeHtml, /\/assets\/index-[^"]+\.js/, "bundle path");
  const bundleSource = await fetchText(`${SITE_ORIGIN}${bundlePath}`);
  const token = extractToken(bundleSource);

  const categories = await fetchJson(`${SITE_ORIGIN}/backend/api/categories.php`);
  const totalImagesSummary = await fetchJson(
    `${SITE_ORIGIN}/backend/api/total_images.php`,
  ).catch(() => null);
  const totalCategoriesSummary = await fetchJson(
    `${SITE_ORIGIN}/backend/api/total_categories.php`,
  ).catch(() => null);
  const logos = await collectStaticAssets(homeHtml, bundleSource);
  const routes = [
    {
      name: "Home",
      slug: "",
      material: null,
      route: "/",
      url: `${SITE_ORIGIN}/`,
    },
    ...categories.map((category) => ({
      name: category.name,
      slug: category.slug,
      material: category.material,
      route: `/${category.slug}`,
      url: `${SITE_ORIGIN}/${category.slug}`,
    })),
  ];

  const manifest = {
    scrapedAt: new Date().toISOString(),
    siteOrigin: SITE_ORIGIN,
    routes,
    categories: [],
    logos: [],
    errors: [],
    totals: {
      categories: categories.length,
      images: 0,
      thumbnails: 0,
      icons: 0,
      logos: 0,
    },
    siteTotals: {
      categories: totalCategoriesSummary?.totalCategories ?? null,
      images: totalImagesSummary?.totalImages ?? null,
    },
  };

  const downloadQueue = [];

  for (const category of categories) {
    try {
      const categoryDirectory = path.join(OUTPUT_ROOT, sanitizeSegment(category.slug));
      await fs.mkdir(categoryDirectory, {
        recursive: true,
      });

      const categoryManifest = {
        id: category.id,
        name: category.name,
        slug: category.slug,
        material: category.material,
        route: `/${category.slug}`,
        icon: null,
        images: [],
        pagination: null,
      };

      if (category.icon_path) {
        const iconUrl = `${SITE_ORIGIN}/backend/${String(category.icon_path).replace(/^\/+/, "")}`;
        const iconDownload = enqueueDownload(downloadQueue, {
          url: iconUrl,
          destinationDirectory: path.join(categoryDirectory, "icons"),
          preferredBaseName: `icon-${category.id}`,
        });
        categoryManifest.icon = {
          url: iconUrl,
          download: iconDownload,
        };
        manifest.totals.icons += 1;
      }

      const firstPage = await fetchJson(
        `${SITE_ORIGIN}/backend/api/get_category_images.php?category_id=${category.id}&page=1&limit=${PAGE_SIZE}`,
        token,
      );

      const totalPages = firstPage.pagination?.total_pages ?? 1;
      const pages = [firstPage];

      for (let page = 2; page <= totalPages; page += 1) {
        pages.push(
          await fetchJson(
            `${SITE_ORIGIN}/backend/api/get_category_images.php?category_id=${category.id}&page=${page}&limit=${PAGE_SIZE}`,
            token,
          ),
        );
      }

      categoryManifest.pagination = {
        totalPages,
        totalImages: firstPage.pagination?.total ?? 0,
      };

      for (const page of pages) {
        for (const image of page.images ?? []) {
          const fullDownload = enqueueDownload(downloadQueue, {
            url: image.full_url,
            destinationDirectory: path.join(categoryDirectory, "images"),
            preferredBaseName: `${category.id}-${image.id}-full`,
          });
          const thumbnailDownload = image.thumbnail_url
            ? enqueueDownload(downloadQueue, {
                url: image.thumbnail_url,
                destinationDirectory: path.join(categoryDirectory, "thumbnails"),
                preferredBaseName: `${category.id}-${image.id}-thumb`,
              })
            : null;

          categoryManifest.images.push({
            id: image.id,
            cloudflareImageId: image.cloudflare_image_id,
            fullUrl: image.full_url,
            thumbnailUrl: image.thumbnail_url,
            download: {
              full: fullDownload,
              thumbnail: thumbnailDownload,
            },
          });
          manifest.totals.images += 1;
          if (thumbnailDownload) {
            manifest.totals.thumbnails += 1;
          }
        }
      }

      manifest.categories.push(categoryManifest);
      console.log(
        `[scrape] ${category.slug}: ${categoryManifest.images.length} images`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      manifest.errors.push({
        type: "category",
        categoryId: category.id,
        slug: category.slug,
        message,
      });
      console.warn(`[warn] category ${category.slug} skipped: ${message}`);
    }
  }

  for (const assetUrl of logos) {
    const normalizedAssetUrl = normalizeAssetUrl(assetUrl);
    const assetDownload = enqueueDownload(downloadQueue, {
      url: normalizedAssetUrl,
      destinationDirectory: path.join(OUTPUT_ROOT, "logos"),
      preferredBaseName: path.parse(new URL(normalizedAssetUrl).pathname).name,
    });
    manifest.logos.push({
      url: normalizedAssetUrl,
      download: assetDownload,
    });
    manifest.totals.logos += 1;
  }

  await runQueue(downloadQueue, IMAGE_CONCURRENCY);
  materializeManifestPaths(manifest);

  await fs.writeFile(
    path.join(OUTPUT_ROOT, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  console.log(
    `[done] categories=${manifest.totals.categories} images=${manifest.totals.images} thumbnails=${manifest.totals.thumbnails} icons=${manifest.totals.icons} logos=${manifest.totals.logos}`,
  );
  console.log(`[done] saved to ${OUTPUT_ROOT}`);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Codex scraper)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function fetchJson(url, token) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (compatible; Codex scraper)",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    headers,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function extractRequired(source, pattern, label) {
  const match = source.match(pattern);
  if (!match) {
    throw new Error(`Could not extract ${label}`);
  }

  return match[0];
}

function extractToken(bundleSource) {
  const bearerRef = bundleSource.match(/Authorization:`Bearer \$\{([^}]+)\}`/);
  if (!bearerRef) {
    throw new Error("Could not find bearer token reference in bundle.");
  }

  const variableName = bearerRef[1];
  const tokenMatch = bundleSource.match(new RegExp(`${variableName}="([^"]+)"`));
  if (!tokenMatch) {
    throw new Error("Could not extract bearer token value.");
  }

  return tokenMatch[1];
}

function collectStaticAssets(homeHtml, bundleSource) {
  const urls = new Set();
  const pattern = /(?:https:\/\/katallogu\.argjendariadardani\.com)?\/[^"'`\s>]+?\.(?:png|jpg|jpeg|webp|svg)/g;

  for (const source of [homeHtml, bundleSource]) {
    const matches = source.match(pattern) ?? [];
    for (const match of matches) {
      urls.add(match);
    }
  }

  return [...urls];
}

function normalizeAssetUrl(url) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `${SITE_ORIGIN}${url}`;
}

function enqueueDownload(queue, params) {
  const target = {
    url: params.url,
    destinationDirectory: params.destinationDirectory,
    preferredBaseName: params.preferredBaseName,
    localPath: null,
  };
  queue.push(target);
  return target;
}

async function runQueue(queue, concurrency) {
  let index = 0;

  async function worker() {
    while (index < queue.length) {
      const current = queue[index];
      index += 1;
      try {
        current.localPath = await downloadAsset(current);
      } catch (error) {
        current.error = error instanceof Error ? error.message : String(error);
        console.warn(`[warn] failed download ${current.url}: ${current.error}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker()),
  );
}

async function downloadAsset(item) {
  await fs.mkdir(item.destinationDirectory, {
    recursive: true,
  });

  const response = await fetch(item.url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Codex scraper)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${item.url}: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const extension = chooseExtension(item.url, contentType);
  const finalPath = path.join(
    item.destinationDirectory,
    `${sanitizeSegment(item.preferredBaseName)}${extension}`,
  );

  try {
    await fs.access(finalPath);
    return finalPath;
  } catch {}

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(finalPath, buffer);
  return finalPath;
}

function materializeManifestPaths(manifest) {
  for (const category of manifest.categories) {
    if (category.icon?.download) {
      if (category.icon.download.localPath) {
        category.icon.localPath = toPosix(
          path.relative(process.cwd(), category.icon.download.localPath),
        );
      }
      if (category.icon.download.error) {
        category.icon.downloadError = category.icon.download.error;
      }
      delete category.icon.download;
    }

    for (const image of category.images) {
      if (image.download?.full?.localPath) {
        image.fullLocalPath = toPosix(
          path.relative(process.cwd(), image.download.full.localPath),
        );
      }

      if (image.download?.thumbnail?.localPath) {
        image.thumbnailLocalPath = toPosix(
          path.relative(process.cwd(), image.download.thumbnail.localPath),
        );
      }
      if (image.download?.full?.error) {
        image.fullDownloadError = image.download.full.error;
      }
      if (image.download?.thumbnail?.error) {
        image.thumbnailDownloadError = image.download.thumbnail.error;
      }

      delete image.download;
    }
  }

  for (const logo of manifest.logos) {
    if (logo.download?.localPath) {
      logo.localPath = toPosix(path.relative(process.cwd(), logo.download.localPath));
    }
    if (logo.download?.error) {
      logo.downloadError = logo.download.error;
    }
    delete logo.download;
  }
}

function chooseExtension(url, contentType) {
  const pathname = new URL(url).pathname;
  const explicitExtension = path.extname(pathname);
  if (explicitExtension) {
    return explicitExtension.toLowerCase();
  }

  if (contentType.includes("png")) {
    return ".png";
  }
  if (contentType.includes("jpeg") || contentType.includes("jpg")) {
    return ".jpg";
  }
  if (contentType.includes("webp")) {
    return ".webp";
  }
  if (contentType.includes("svg")) {
    return ".svg";
  }

  return ".bin";
}

function sanitizeSegment(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
