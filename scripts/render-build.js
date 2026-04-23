const { existsSync, rmSync } = require("node:fs");
const { execSync } = require("node:child_process");

const stalePaths = [
  "apps/api/dist",
  "apps/worker/dist",
  "packages/ai/dist",
  "packages/channel-adapters/dist",
  "packages/config/dist",
  "packages/core/dist",
  "packages/db/dist",
  "packages/logger/dist",
  "packages/queue/dist",
  "apps/api/tsconfig.build.tsbuildinfo",
  "apps/worker/tsconfig.build.tsbuildinfo",
  "packages/ai/tsconfig.build.tsbuildinfo",
  "packages/channel-adapters/tsconfig.build.tsbuildinfo",
  "packages/config/tsconfig.build.tsbuildinfo",
  "packages/core/tsconfig.build.tsbuildinfo",
  "packages/db/tsconfig.build.tsbuildinfo",
  "packages/logger/tsconfig.build.tsbuildinfo",
  "packages/queue/tsconfig.build.tsbuildinfo",
];

for (const stalePath of stalePaths) {
  rmSync(stalePath, {
    force: true,
    recursive: true,
  });
}

const commands = [
  "npm run prisma:generate",
  "npm --workspace @meta-chatbot/core run build",
  "npm --workspace @meta-chatbot/config run build",
  "npm --workspace @meta-chatbot/logger run build",
  "npm --workspace @meta-chatbot/db run build",
  "npm --workspace @meta-chatbot/channel-adapters run build",
  "npm --workspace @meta-chatbot/queue run build",
  "npm --workspace @meta-chatbot/ai run build",
  "npm --workspace @meta-chatbot/api run build",
  "npm --workspace @meta-chatbot/worker run build",
];

for (const command of commands) {
  execSync(command, {
    stdio: "inherit",
    env: process.env,
  });
}

const expectedOutputs = [
  "apps/api/dist/main.js",
  "apps/worker/dist/main.js",
];

for (const output of expectedOutputs) {
  if (!existsSync(output)) {
    console.error(`Expected build output missing: ${output}`);
    process.exit(1);
  }
}

console.log("Render build outputs verified.");
