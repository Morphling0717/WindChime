import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), "windchime-package-"));
try {
  function run(command, args, cwd = temporary, capture = false) {
    const result = spawnSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: capture ? "pipe" : "inherit",
      env: process.env,
    });
    if (result.status !== 0)
      throw new Error(`${command} failed: ${result.stderr || result.status}`);
    return result.stdout;
  }
  run(process.execPath, ["scripts/build.mjs"], root);
  const [artifact] = JSON.parse(
    run(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", temporary],
      root,
      true,
    ),
  );
  if (
    artifact.files.some((file) =>
      /(?:node_modules|\.env|\.(?:db|sqlite3?)(?:-(?:wal|shm))?$|\.windchime-build)/.test(
        file.path,
      ),
    )
  )
    throw new Error("Package contains development or runtime data");
  await writeFile(
    path.join(temporary, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run("npm", [
    "install",
    "--no-audit",
    "--no-fund",
    path.join(temporary, artifact.filename),
    "sqlite3@6.0.1",
    "react@19",
    "react-dom@19",
    "qrcode@1",
    "typescript@5",
    "@types/react@19",
    "@types/node@20",
  ]);
  await writeFile(
    path.join(temporary, "smoke.mjs"),
    `
import assert from 'node:assert/strict';
import { createWindChimeSqlite } from '@windchime/embed/sqlite';
import { createWindChimeService } from '@windchime/embed/server';
for (const entry of ['core','client','react','server','sqlite','next','media']) await import('@windchime/embed/'+entry);
const storage = createWindChimeSqlite({filename: ${JSON.stringify(path.join(temporary, "fresh.db"))}});
try {
  await storage.ready;
  const service = createWindChimeService({storage,hashSalt:'package-smoke-only'});
  const topic = await service.getPublicTopic('default');
  assert.equal(topic.slug, 'default');
  assert.equal('note' in topic, false);
} finally { await storage.close(); }
console.log('Installed tarball: all headless imports and fresh SQLite passed');
`,
  );
  await writeFile(
    path.join(temporary, "types.tsx"),
    `
import { createWindChimeClient } from '@windchime/embed/client';
import { useWindChimeInbox, useWindChimeSubmission } from '@windchime/embed/react';
import { WindChimeSender } from '@windchime/embed/ui';
const client = createWindChimeClient();
export function Page() { const inbox=useWindChimeInbox(client); const form=useWindChimeSubmission({client}); return <><button disabled={!form.canSubmit}>{inbox.items.length}</button><WindChimeSender onSubmit={async p=>{await client.messages.submit(p)}} /></>; }
`,
  );
  run(process.execPath, ["smoke.mjs"]);
  run(process.execPath, [
    "node_modules/typescript/bin/tsc",
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--jsx",
    "react-jsx",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2022",
    "types.tsx",
  ]);
  const installed = JSON.parse(
    await readFile(
      path.join(temporary, "node_modules/@windchime/embed/package.json"),
      "utf8",
    ),
  );
  console.log(
    `Verified ${installed.name}@${installed.version}; tarball ${artifact.filename}; isolated installation passed`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
