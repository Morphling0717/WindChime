import { spawn } from "node:child_process";
import { syncInstallation } from "./sync-installation.mjs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const targetsAt = args.indexOf("--targets");
const rawTargets =
  targetsAt < 0
    ? [option("--uliuli", "../Next_UliUli"), option("--mia", "../Next_Mia")]
    : args.slice(targetsAt + 1).filter((arg) => !arg.startsWith("--"));
const targets = rawTargets.map((target) => path.resolve(root, target));
const syncOnly = args.includes("--sync-only");
let stopping = false;
const children = new Map();
let building;

function run(command, params, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, params, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });
    building = child;
    child.on("error", reject);
    child.on("exit", (code) => {
      building = undefined;
      code === 0 ? resolve() : reject(new Error(`Command exited ${code}`));
    });
  });
}
async function assertPlainDirectory(directory) {
  for (let part = directory; ; part = path.dirname(part)) {
    const info = await lstat(part);
    if (info.isSymbolicLink()) throw new Error(`Refusing symlink: ${part}`);
    if (part === path.dirname(part)) break;
  }
}
async function validate(target, manifest) {
  const installed = path.join(target, "node_modules/@windchime/embed");
  await assertPlainDirectory(installed);
  const existing = JSON.parse(
    await readFile(path.join(installed, "package.json"), "utf8"),
  );
  if (existing.name !== manifest.name)
    throw new Error(`Unexpected package at ${installed}`);
  const require = createRequire(path.join(target, "package.json"));
  for (const [name, range] of Object.entries({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
  })) {
    let version;
    try {
      version = require(`${name}/package.json`).version;
    } catch {
      if (manifest.peerDependenciesMeta?.[name]?.optional) continue;
      throw new Error(
        `${target}: install missing dependency with npm install '${name}@${range}'`,
      );
    }
    if (!semver.satisfies(version, range))
      throw new Error(
        `${target}: ${name}@${version} does not satisfy ${range}; run npm install '${name}@${range}'`,
      );
  }
  return installed;
}
async function stop(target) {
  const child = children.get(target);
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    children.delete(target);
    return;
  }
  children.delete(target);
  await new Promise((resolve) => {
    const killTimer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, 5000);
    child.once("exit", () => {
      clearTimeout(killTimer);
      resolve();
    });
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      clearTimeout(killTimer);
      resolve();
    }
  });
}
async function sync() {
  const manifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  // Validate every target before changing either installation.
  const installed = await Promise.all(
    targets.map((target) => validate(target, manifest)),
  );
  await Promise.all(targets.map(stop));
  for (const [index, destination] of installed.entries()) {
    await syncInstallation(destination, path.join(root, "dist"), manifest);
    console.log(
      `Synced ${manifest.name}@${manifest.version} → ${targets[index]}`,
    );
  }
  if (!syncOnly && !stopping) {
    targets.forEach((target, index) => {
      const require = createRequire(path.join(target, "package.json"));
      const next = require.resolve("next/dist/bin/next");
      const child = spawn(
        process.execPath,
        [next, "dev", "--turbopack", "--port", String(3011 + index)],
        { cwd: target, stdio: "inherit", detached: true, env: process.env },
      );
      children.set(target, child);
      console.log(`Consumer ${index + 1}: http://localhost:${3011 + index}`);
    });
  }
}
async function fingerprint() {
  const entries = [];
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await scan(file);
      else {
        const info = await stat(file);
        entries.push(`${file}:${info.mtimeMs}:${info.size}`);
      }
    }
  }
  await scan(path.join(root, "src"));
  for (const file of ["package.json", "tsconfig.json", "tsconfig.build.json"]) {
    const info = await stat(path.join(root, file));
    entries.push(`${file}:${info.mtimeMs}`);
  }
  return entries.sort().join("\n");
}
async function shutdown() {
  if (stopping) return;
  stopping = true;
  building?.kill("SIGTERM");
  await Promise.all(targets.map(stop));
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
let previous = "";
while (!stopping) {
  const current = await fingerprint();
  if (current !== previous) {
    previous = current;
    try {
      await run(process.execPath, ["scripts/build.mjs"], root);
      if (!stopping) await sync();
    } catch (error) {
      console.error(error.message);
      console.error(
        "No successful update was reported. Fix the error, then save a source file to retry.",
      );
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
