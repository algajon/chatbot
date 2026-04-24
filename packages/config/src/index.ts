import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv();

const optionalString = z.preprocess(
  (value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.4-mini"),
  OPENAI_REASONING_EFFORT: z
    .enum(["none", "minimal", "low", "medium", "high", "xhigh"])
    .default("low"),
  META_GRAPH_VERSION: z.string().min(1).default("v23.0"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  EXTERNAL_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CATALOG_FILE_PATH: optionalString,
  PUBLIC_BASE_URL: optionalString,
  OPENAI_API_KEY: optionalString,
  META_APP_SECRET: optionalString,
  META_VERIFY_TOKEN: optionalString,
  META_APP_ID: optionalString,
  WHATSAPP_ACCESS_TOKEN: optionalString,
  WHATSAPP_PHONE_NUMBER_ID: optionalString,
  INSTAGRAM_PAGE_ACCESS_TOKEN: optionalString,
  INSTAGRAM_PAGE_ID: optionalString,
  INSTAGRAM_ACCOUNT_ID: optionalString,
  MESSENGER_PAGE_ACCESS_TOKEN: optionalString,
  MESSENGER_PAGE_ID: optionalString,
  AWS_ACCESS_KEY_ID: optionalString,
  AWS_SECRET_ACCESS_KEY: optionalString,
  S3_BUCKET: optionalString,
  SENTRY_DSN: optionalString,
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = envSchema.parse(process.env);
  return cachedEnv;
}

export function resetEnvForTests(): void {
  cachedEnv = undefined;
}
