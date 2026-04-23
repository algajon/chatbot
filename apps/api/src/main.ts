import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { getEnv } from "@meta-chatbot/config";
import { createLogger, serializeError } from "@meta-chatbot/logger";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const logger = createLogger("api-bootstrap");

  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  app.enableShutdownHooks();
  await app.listen(env.PORT);

  logger.info(
    {
      port: env.PORT,
      environment: env.NODE_ENV,
    },
    "API server started.",
  );
}

bootstrap().catch((error) => {
  const logger = createLogger("api-bootstrap");
  logger.fatal(
    {
      error: serializeError(error),
    },
    "API bootstrap failed.",
  );
  process.exit(1);
});
