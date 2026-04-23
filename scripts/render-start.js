const { spawn } = require("node:child_process");

const nodeCommand = process.execPath;
const childProcesses = [];

function startProcess(scriptPath, name) {
  const child = spawn(nodeCommand, [scriptPath], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`${name} exited due to signal ${signal}`);
    } else if (code !== 0) {
      console.error(`${name} exited with code ${code}`);
    }

    if (name === "api") {
      stopChildren();
      process.exit(code ?? 1);
    }
  });

  childProcesses.push(child);
  return child;
}

function stopChildren() {
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

process.on("SIGTERM", () => {
  stopChildren();
  process.exit(0);
});

process.on("SIGINT", () => {
  stopChildren();
  process.exit(0);
});

startProcess("apps/worker/dist/main.js", "worker");
startProcess("apps/api/dist/main.js", "api");
