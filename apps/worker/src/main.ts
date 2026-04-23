import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { createLogger, serializeError } from "@meta-chatbot/logger";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const logger = createLogger("worker-bootstrap");
  const app = await NestFactory.createApplicationContext(AppModule);

  app.enableShutdownHooks();
  logger.info("Worker application context started.");
}

bootstrap().catch((error) => {
  const logger = createLogger("worker-bootstrap");
  logger.fatal(
    {
      error: serializeError(error),
    },
    "Worker bootstrap failed.",
  );
  process.exit(1);
});
