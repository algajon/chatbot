import { Module } from "@nestjs/common";
import { AiModule } from "@meta-chatbot/ai";
import { DatabaseModule } from "@meta-chatbot/db";
import { ConversationOrchestratorService } from "./services/conversation-orchestrator.service";
import { MessageProcessingWorkerService } from "./services/message-processing-worker.service";
import { MetaOutboundMessageService } from "./services/meta-outbound.service";

@Module({
  imports: [AiModule, DatabaseModule],
  providers: [
    ConversationOrchestratorService,
    MessageProcessingWorkerService,
    MetaOutboundMessageService,
  ],
})
export class AppModule {}
