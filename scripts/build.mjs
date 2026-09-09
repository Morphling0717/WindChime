import { spawnSync } from "node:child_process";
import { promoteBuild } from "./promote-build.mjs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
// A failed compilation never replaces the previous usable package.
const stage = path.join(root, ".windchime-build");
await rm(stage, { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/typescript/bin/tsc"),
    "-p",
    "tsconfig.build.json",
    "--outDir",
    stage,
  ],
  { cwd: root, stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
await mkdir(path.join(stage, "styles"), { recursive: true });
await cp(
  path.join(root, "src/styles/windchime.css"),
  path.join(stage, "styles/windchime.css"),
);
async function fixImports(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await fixImports(file);
    else if (entry.name.endsWith(".js") || entry.name.endsWith(".d.ts")) {
      const source = await readFile(file, "utf8");
      // The original optional UI used bundler-only extensionless ESM imports.
      const resolved = source.replace(
        /(from\s*|import\s*\(?)(['"])(\.{1,2}\/[^'"]+)\2/g,
        (all, prefix, quote, specifier) => {
          if (path.extname(specifier)) return all;
          return `${prefix}${quote}${specifier}.js${quote}`;
        },
      );
      await writeFile(file, resolved);
    }
  }
}
await fixImports(stage);
await promoteBuild(stage, path.join(root, "dist"));
