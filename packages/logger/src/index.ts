import pino, { type Logger, type LoggerOptions } from "pino";
import { getEnv } from "@meta-chatbot/config";

export type LogBindings = Record<string, string | number | boolean | undefined>;

export function createLogger(
  context: string,
  bindings: LogBindings = {},
): Logger {
  const env = getEnv();
  const options: LoggerOptions = {
    level: env.LOG_LEVEL,
    name: `meta-chatbot:${context}`,
    base: {
      context,
      environment: env.NODE_ENV,
      ...bindings,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "*.authorization",
        "*.token",
        "*.apiKey",
        "*.secret",
        "headers.authorization",
      ],
      censor: "[Redacted]",
    },
  };

  return pino(options);
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    error,
  };
}
