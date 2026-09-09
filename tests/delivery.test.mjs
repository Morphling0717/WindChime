import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { syncInstallation } from "../scripts/sync-installation.mjs";
import { promoteBuild } from "../scripts/promote-build.mjs";

test("local artifact synchronization preserves installed nested dependencies and host manifest/lock/React", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "windchime-sync-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = path.join(root, "host/node_modules/@windchime/embed");
  const source = path.join(root, "source-dist");
  await mkdir(path.join(destination, "node_modules/private-dependency"), {
    recursive: true,
  });
  await mkdir(path.join(destination, "dist"), { recursive: true });
  await mkdir(path.join(root, "host/node_modules/react"), { recursive: true });
  await mkdir(source);
  for (const [filename, value] of [
    ["host/package.json", "host manifest"],
    ["host/package-lock.json", "host lock"],
    ["host/node_modules/react/package.json", "host React"],
    ["host/node_modules/@windchime/embed/package.json", "old package"],
    ["host/node_modules/@windchime/embed/dist/old.js", "old artifact"],
    [
      "host/node_modules/@windchime/embed/node_modules/private-dependency/index.js",
      "nested dependency",
    ],
  ])
    await writeFile(path.join(root, filename), value);
  await writeFile(path.join(source, "index.js"), "new artifact");
  await syncInstallation(destination, source, {
    name: "@windchime/embed",
    version: "test-version",
  });
  assert.equal(
    await readFile(path.join(destination, "dist/index.js"), "utf8"),
    "new artifact",
  );
  assert.deepEqual(await readdir(path.join(destination, "dist")), ["index.js"]);
  assert.equal(
    JSON.parse(await readFile(path.join(destination, "package.json"), "utf8"))
      .version,
    "test-version",
  );
  assert.equal(
    await readFile(
      path.join(destination, "node_modules/private-dependency/index.js"),
      "utf8",
    ),
    "nested dependency",
  );
  for (const [filename, value] of [
    ["package.json", "host manifest"],
    ["package-lock.json", "host lock"],
    ["node_modules/react/package.json", "host React"],
  ])
    assert.equal(
      await readFile(path.join(root, "host", filename), "utf8"),
      value,
    );
  assert.deepEqual(await readdir(path.dirname(destination)), ["embed"]);
});

test("a failed artifact staging copy preserves the last installed package", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "windchime-sync-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const destination = path.join(root, "embed");
  await mkdir(path.join(destination, "dist"), { recursive: true });
  await writeFile(path.join(destination, "package.json"), "original manifest");
  await writeFile(path.join(destination, "dist/index.js"), "original code");
  await assert.rejects(
    syncInstallation(destination, path.join(root, "missing"), {
      name: "@windchime/embed",
    }),
    { code: "ENOENT" },
  );
  assert.equal(
    await readFile(path.join(destination, "package.json"), "utf8"),
    "original manifest",
  );
  assert.equal(
    await readFile(path.join(destination, "dist/index.js"), "utf8"),
    "original code",
  );
  assert.deepEqual(await readdir(root), ["embed"]);
});

test("example login and mutation origin checks work with container ports/proxy Host and reject cross-site requests", async (t) => {
  const names = [
    "EXAMPLE_SESSION_SECRET",
    "EXAMPLE_ADMIN_PASSWORD",
    "NODE_ENV",
  ];
  const saved = Object.fromEntries(
    names.map((name) => [name, process.env[name]]),
  );
  t.after(() => {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });
  process.env.EXAMPLE_SESSION_SECRET = "delivery-test-secret";
  process.env.EXAMPLE_ADMIN_PASSWORD = "delivery-test-password";
  process.env.NODE_ENV = "production";
  const source = await readFile(
    new URL("../examples/next-sqlite/lib/auth.ts", import.meta.url),
    "utf8",
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const auth = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
  const request = (url, host, origin, method = "POST", cookie) =>
    new Request(url, {
      method,
      headers: {
        host,
        ...(origin ? { origin } : {}),
        ...(cookie ? { cookie } : {}),
        "content-type": "application/json",
      },
      ...(method === "POST"
        ? { body: JSON.stringify({ password: "delivery-test-password" }) }
        : {}),
    });
  const mapped = request(
    "http://0.0.0.0:3000/api/session",
    "localhost:3010",
    "http://localhost:3010",
  );
  const response = await auth.login(mapped);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
  assert.match(response.headers.get("set-cookie"), /Secure/);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.equal(
    auth.authorizeAdmin(
      request(
        "http://0.0.0.0:3000/api/mail/settings",
        "localhost:3010",
        "http://localhost:3010",
        "PUT",
        cookie,
      ),
    ),
    null,
  );
  assert.equal(
    (
      await auth.login(
        request(
          "https://internal:3000/api/session",
          "example.test",
          "https://example.test",
        ),
      )
    ).status,
    200,
  );
  assert.equal(
    auth.authorizeAdmin(
      request(
        "https://internal:3000/api/mail/settings",
        "example.test",
        "https://evil.test",
        "PUT",
        cookie,
      ),
    ).status,
    403,
  );
  assert.equal(
    auth.authorizeAdmin(
      request(
        "https://internal:3000/api/mail/settings",
        "example.test",
        null,
        "PUT",
        cookie,
      ),
    ).status,
    403,
  );
  assert.equal(
    auth.authorizeAdmin(
      request(
        "https://internal:3000/api/mail/settings",
        "example.test",
        null,
        "GET",
        cookie,
      ),
    ),
    null,
  );
  assert.equal(
    (
      await auth.login(
        request(
          "https://internal:3000/api/session",
          "example.test",
          "https://evil.test",
        ),
      )
    ).status,
    403,
  );
  assert.equal(
    auth.logout(
      request(
        "https://internal:3000/api/session",
        "example.test",
        "https://evil.test",
        "DELETE",
      ),
    ).status,
    403,
  );
  assert.match(
    auth
      .logout(
        request(
          "https://internal:3000/api/session",
          "example.test",
          "https://example.test",
          "DELETE",
        ),
      )
      .headers.get("set-cookie"),
    /Max-Age=0/,
  );
});

test("build output promotion replaces complete artifacts and preserves existing output for a missing stage", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "windchime-promote-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stage = path.join(root, "stage"),
    destination = path.join(root, "dist");
  await mkdir(stage);
  await mkdir(destination);
  await writeFile(path.join(stage, "new.js"), "complete new artifact");
  await writeFile(path.join(destination, "old.js"), "complete old artifact");
  await assert.rejects(promoteBuild(path.join(root, "missing"), destination), {
    code: "ENOENT",
  });
  assert.equal(
    await readFile(path.join(destination, "old.js"), "utf8"),
    "complete old artifact",
  );
  const copy = t.mock.method(fs, "cp");
  await promoteBuild(stage, destination);
  assert.equal(copy.mock.callCount(), 0, "ordinary promotion uses only rename");
  assert.deepEqual(await readdir(root), ["dist"]);
  assert.deepEqual(await readdir(destination), ["new.js"]);
  assert.equal(
    await readFile(path.join(destination, "new.js"), "utf8"),
    "complete new artifact",
  );
});

async function promotionFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "windchime-promote-fault-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stage = path.join(root, "stage"),
    destination = path.join(root, "dist");
  await mkdir(stage);
  await mkdir(path.join(destination, "nested"), { recursive: true });
  await writeFile(path.join(stage, "new.js"), "complete new artifact");
  await writeFile(path.join(destination, "old.js"), "old entrypoint");
  await writeFile(
    path.join(destination, "nested/dependency.js"),
    "old dependency",
  );
  return {
    root,
    stage,
    destination,
    async recovery() {
      const names = (await readdir(root)).filter((name) =>
        name.startsWith(".windchime-previous-"),
      );
      assert.equal(names.length, 1);
      return path.join(root, names[0], "dist");
    },
  };
}

async function assertPreviousOutput(directory) {
  assert.deepEqual((await readdir(directory)).sort(), ["nested", "old.js"]);
  assert.equal(
    await readFile(path.join(directory, "old.js"), "utf8"),
    "old entrypoint",
  );
  assert.equal(
    await readFile(path.join(directory, "nested/dependency.js"), "utf8"),
    "old dependency",
  );
}

const filesystemError = (code) => Object.assign(new Error(code), { code });

test("OverlayFS EXDEV backs up the complete old output before replacing it", async (t) => {
  const { root, stage, destination } = await promotionFixture(t);
  const rename = fs.rename,
    remove = fs.rm;
  let backup;
  t.mock.method(fs, "rename", async (source, target) => {
    if (source === destination) {
      backup = target;
      throw filesystemError("EXDEV");
    }
    return rename(source, target);
  });
  t.mock.method(fs, "rm", async (target, options) => {
    if (target === destination) await assertPreviousOutput(backup);
    return remove(target, options);
  });
  await promoteBuild(stage, destination);
  assert.deepEqual(await readdir(root), ["dist"]);
  assert.deepEqual(await readdir(destination), ["new.js"]);
  assert.equal(
    await readFile(path.join(destination, "new.js"), "utf8"),
    "complete new artifact",
  );
});

test("an incomplete EXDEV backup never removes or changes the old output", async (t) => {
  const { root, stage, destination } = await promotionFixture(t);
  const rename = fs.rename,
    copy = fs.cp,
    failure = filesystemError("ENOSPC");
  t.mock.method(fs, "rename", (source, target) => {
    if (source === destination) throw filesystemError("EXDEV");
    return rename(source, target);
  });
  t.mock.method(fs, "cp", async (source, target, options) => {
    if (source !== destination) return copy(source, target, options);
    await mkdir(target);
    await writeFile(path.join(target, "partial.js"), "incomplete backup");
    throw failure;
  });
  await assert.rejects(
    promoteBuild(stage, destination),
    (error) => error === failure,
  );
  await assertPreviousOutput(destination);
  assert.equal(
    await readFile(path.join(stage, "new.js"), "utf8"),
    "complete new artifact",
  );
  assert.deepEqual((await readdir(root)).sort(), ["dist", "stage"]);
});

test("a partial removal after an EXDEV backup restores all old files and retains recovery materials", async (t) => {
  const { stage, destination, recovery } = await promotionFixture(t);
  const rename = fs.rename,
    remove = fs.rm,
    failure = filesystemError("EACCES");
  let failed = false;
  t.mock.method(fs, "rename", (source, target) => {
    if (source === destination) throw filesystemError("EXDEV");
    return rename(source, target);
  });
  t.mock.method(fs, "rm", async (target, options) => {
    if (target === destination && !failed) {
      failed = true;
      await remove(path.join(target, "old.js"));
      throw failure;
    }
    return remove(target, options);
  });
  await assert.rejects(promoteBuild(stage, destination), (error) => {
    assert.deepEqual(error.errors, [failure]);
    assert.match(error.message, /previous output restored/);
    return true;
  });
  await assertPreviousOutput(destination);
  await assertPreviousOutput(await recovery());
  assert.equal(
    await readFile(path.join(stage, "new.js"), "utf8"),
    "complete new artifact",
  );
});

test("failed promotion restores renamed output and keeps a complete recovery copy", async (t) => {
  const { stage, destination, recovery } = await promotionFixture(t);
  const rename = fs.rename,
    failure = filesystemError("EIO");
  t.mock.method(fs, "rename", (source, target) => {
    if (source === stage) throw failure;
    return rename(source, target);
  });
  await assert.rejects(promoteBuild(stage, destination), (error) => {
    assert.deepEqual(error.errors, [failure]);
    return true;
  });
  await assertPreviousOutput(destination);
  const backup = await recovery();
  await assertPreviousOutput(backup);
  assert.equal(
    await readFile(path.join(stage, "new.js"), "utf8"),
    "complete new artifact",
  );
});

test("recovery falls back to copying on EXDEV without consuming its backup", async (t) => {
  const { stage, destination, recovery } = await promotionFixture(t);
  const rename = fs.rename,
    failure = filesystemError("EIO");
  t.mock.method(fs, "rename", (source, target) => {
    if (source === stage) throw failure;
    if (source === destination || path.basename(source) === "restore")
      throw filesystemError("EXDEV");
    return rename(source, target);
  });
  await assert.rejects(promoteBuild(stage, destination), (error) => {
    assert.deepEqual(error.errors, [failure]);
    assert.match(error.message, /previous output restored/);
    return true;
  });
  await assertPreviousOutput(destination);
  await assertPreviousOutput(await recovery());
});

test("a failed recovery copy retains the full backup and reports its location", async (t) => {
  const { stage, destination, recovery } = await promotionFixture(t);
  const rename = fs.rename,
    copy = fs.cp,
    promotionFailure = filesystemError("EIO"),
    recoveryFailure = filesystemError("ENOSPC");
  t.mock.method(fs, "rename", (source, target) => {
    if (source === stage) throw promotionFailure;
    if (path.basename(source) === "restore") throw filesystemError("EXDEV");
    return rename(source, target);
  });
  t.mock.method(fs, "cp", async (source, target, options) => {
    if (target !== destination) return copy(source, target, options);
    await mkdir(target);
    await writeFile(path.join(target, "partial.js"), "incomplete recovery");
    throw recoveryFailure;
  });
  let failure;
  await assert.rejects(promoteBuild(stage, destination), (error) => {
    failure = error;
    assert.deepEqual(error.errors, [promotionFailure, recoveryFailure]);
    return true;
  });
  const backup = await recovery();
  assert.ok(failure.message.includes(backup));
  await assertPreviousOutput(backup);
  assert.equal(
    await readFile(path.join(stage, "new.js"), "utf8"),
    "complete new artifact",
  );
});
