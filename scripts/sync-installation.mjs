import { cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Replace only the release-owned files, preserving npm's nested dependencies. */
export async function syncInstallation(destination, sourceDist, manifest) {
  const stage = await mkdtemp(
    path.join(path.dirname(destination), ".windchime-sync-"),
  );
  const backup = path.join(stage, "previous");
  const replaced = [];
  let preserveBackup = false;
  try {
    await mkdir(backup);
    await cp(sourceDist, path.join(stage, "dist"), { recursive: true });
    await writeFile(
      path.join(stage, "package.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    for (const name of ["dist", "package.json"]) {
      const target = path.join(destination, name);
      let existed = true;
      try {
        await rename(target, path.join(backup, name));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        existed = false;
      }
      const operation = { name, existed, installed: false };
      replaced.push(operation);
      await rename(path.join(stage, name), target);
      operation.installed = true;
    }
  } catch (error) {
    const failures = [];
    for (const operation of replaced.reverse()) {
      try {
        const target = path.join(destination, operation.name);
        if (operation.installed)
          await rm(target, { recursive: true, force: true });
        if (operation.existed)
          await rename(path.join(backup, operation.name), target);
      } catch (restoreError) {
        failures.push(restoreError);
      }
    }
    if (failures.length) {
      preserveBackup = true;
      throw new AggregateError(
        [error, ...failures],
        `Sync rollback needs attention; originals preserved in ${backup}`,
      );
    }
    throw error;
  } finally {
    if (!preserveBackup) await rm(stage, { recursive: true, force: true });
  }
}
