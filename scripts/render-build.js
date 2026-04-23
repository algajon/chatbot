const { existsSync } = require("node:fs");
const { execSync } = require("node:child_process");

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
