import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { getEnv } from "@meta-chatbot/config";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const env = getEnv();
    const schema = extractSchemaName(env.DATABASE_URL) ?? "public";
    const adapter = new PrismaPg(
      {
        connectionString: env.DATABASE_URL,
      },
      {
        schema,
      },
    );

    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}

export * from "@prisma/client";

function extractSchemaName(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    return url.searchParams.get("schema");
  } catch {
    return null;
  }
}
