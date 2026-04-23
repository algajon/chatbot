import IORedis from "ioredis";
import { JobsOptions, Queue, type WorkerOptions } from "bullmq";
import { getEnv } from "@meta-chatbot/config";
import {
  inboundEventJobName,
  queueNames,
  type NormalizedInboundEvent,
} from "@meta-chatbot/core";

export type InboundEventJobPayload = {
  webhookEventLogId: string;
  normalizedEvent: NormalizedInboundEvent;
};

let sharedConnection: IORedis | undefined;

export function getQueueConnection(): IORedis {
  if (sharedConnection) {
    return sharedConnection;
  }

  const env = getEnv();
  sharedConnection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  return sharedConnection;
}

export function closeQueueConnection(): Promise<void> {
  if (!sharedConnection) {
    return Promise.resolve();
  }

  const connection = sharedConnection;
  sharedConnection = undefined;
  return connection.quit().then(() => undefined);
}

export function createQueue<T>(
  name: string,
  options: JobsOptions = {},
): Queue<T> {
  return new Queue<T>(name, {
    connection: getQueueConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 1_000,
      },
      removeOnComplete: {
        count: 500,
      },
      removeOnFail: {
        count: 1_000,
      },
      ...options,
    },
  });
}

export function createWorkerOptions(
  overrides: Partial<WorkerOptions> = {},
): WorkerOptions {
  return {
    ...overrides,
    connection: overrides.connection ?? getQueueConnection(),
  };
}

export function createInboundEventsQueue(): Queue<InboundEventJobPayload> {
  return createQueue<InboundEventJobPayload>(queueNames.inboundEvents);
}

export function buildInboundJobId(event: NormalizedInboundEvent): string {
  return `${event.channel}:${event.eventId}`;
}

export { inboundEventJobName };
