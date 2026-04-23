import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "@meta-chatbot/db";
import { getQueueConnection } from "@meta-chatbot/queue";

@Controller("internal/health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async getHealth(): Promise<{
    status: "ok";
    timestamp: string;
    services: {
      database: "ok";
      redis: "ok";
    };
  }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const redisStatus = await getQueueConnection().ping();

      if (redisStatus !== "PONG") {
        throw new Error(`Unexpected Redis response: ${redisStatus}`);
      }

      return {
        status: "ok",
        timestamp: new Date().toISOString(),
        services: {
          database: "ok",
          redis: "ok",
        },
      };
    } catch (error) {
      throw new ServiceUnavailableException({
        status: "degraded",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown healthcheck failure",
      });
    }
  }
}
