import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { getEnv } from "@meta-chatbot/config";
import { queueNames } from "@meta-chatbot/core";
import { createLogger, serializeError } from "@meta-chatbot/logger";
import {
  closeQueueConnection,
  createWorkerOptions,
  inboundEventJobName,
  type InboundEventJobPayload,
} from "@meta-chatbot/queue";
import { Worker } from "bullmq";
import { ConversationOrchestratorService } from "./conversation-orchestrator.service";

@Injectable()
export class MessageProcessingWorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly env = getEnv();
  private readonly logger = createLogger("message-processing-worker");
  private worker?: Worker<InboundEventJobPayload>;

  constructor(
    private readonly conversationOrchestrator: ConversationOrchestratorService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.worker = new Worker<InboundEventJobPayload>(
      queueNames.inboundEvents,
      async (job) => {
        if (job.name !== inboundEventJobName) {
          this.logger.warn(
            {
              jobId: job.id,
              jobName: job.name,
            },
            "Skipping unexpected job name.",
          );
          return;
        }

        await this.conversationOrchestrator.processInboundEvent(job.data);
      },
      createWorkerOptions({
        concurrency: this.env.WORKER_CONCURRENCY,
      }),
    );

    this.worker.on("completed", (job) => {
      this.logger.info(
        {
          jobId: job.id,
          jobName: job.name,
        },
        "Inbound processing job completed.",
      );
    });

    this.worker.on("failed", (job, error) => {
      this.logger.error(
        {
          jobId: job?.id,
          jobName: job?.name,
          error: serializeError(error),
        },
        "Inbound processing job failed.",
      );
    });

    this.logger.info(
      {
        queue: queueNames.inboundEvents,
        concurrency: this.env.WORKER_CONCURRENCY,
      },
      "Inbound processing worker is listening.",
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await closeQueueConnection();
  }
}
