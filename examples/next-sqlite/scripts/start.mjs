import { spawn } from "node:child_process";
import { access, cp } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
const server = path.join(standalone, "server.js");

try {
  await access(server);
} catch {
  throw new Error("Production output is missing. Run npm run build first.");
}

// Existing process environment takes precedence over the local example file.
try {
  loadEnvFile(path.join(root, ".env.local"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

await cp(
  path.join(root, ".next", "static"),
  path.join(standalone, ".next", "static"),
  {
    recursive: true,
  },
);
try {
  await access(path.join(root, "public"));
  await cp(path.join(root, "public"), path.join(standalone, "public"), {
    recursive: true,
  });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const child = spawn(process.execPath, [server], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: process.env.PORT || "3010",
    HOSTNAME: process.env.HOSTNAME || "0.0.0.0",
    // The standalone server changes cwd; retain the example's relative DB path.
    DATABASE_PATH: path.resolve(
      root,
      process.env.DATABASE_PATH || "data/windchime.db",
    ),
  },
});

const onInterrupt = () => child.kill("SIGINT");
const onTerminate = () => child.kill("SIGTERM");
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);
child.once("error", (error) => {
  console.error("Unable to start the example:", error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
  process.exitCode =
    code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
});
