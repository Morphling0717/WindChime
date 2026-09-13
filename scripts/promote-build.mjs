import fs from "node:fs/promises";
import path from "node:path";

const copyOptions = {
  recursive: true,
  force: false,
  errorOnExist: true,
  preserveTimestamps: true,
  verbatimSymlinks: true,
};

async function rename(source, destination) {
  for (let attempt = 0; ; attempt++) {
    try { return await fs.rename(source, destination); }
    catch (error) {
      // Windows scanners briefly hold a newly closed compiler output directory.
      // Retry the same atomic operation; never copy over a live destination.
      if (process.platform !== "win32" || !["EPERM", "EBUSY"].includes(error.code) || attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 75 * 2 ** attempt));
    }
  }
}

/** Publish a fully built directory without copying over the live output. */
export async function promoteBuild(stage, destination) {
  if (!(await fs.stat(stage)).isDirectory())
    throw new Error("Build stage must be a directory");
  const recovery = await fs.mkdtemp(
    path.join(path.dirname(destination), ".windchime-previous-"),
  );
  const previous = path.join(recovery, "dist");
  let hadPrevious = false,
    preserveRecovery = false;
  try {
    try {
      await rename(destination, previous);
      hadPrevious = true;
    } catch (error) {
      if (error.code === "EXDEV") {
        // OverlayFS can reject renaming a directory from an earlier image
        // layer. Do not touch that output until its entire backup is copied.
        await fs.cp(destination, previous, copyOptions);
        hadPrevious = true;
        await fs.rm(destination, { recursive: true, force: true });
      } else if (error.code !== "ENOENT") {
        throw error;
      }
    }
    await rename(stage, destination);
  } catch (error) {
    if (!hadPrevious) throw error;
    preserveRecovery = true;
    try {
      // A failed removal may have left a partial directory. Restore from a
      // disposable copy so every recovery failure retains the full backup.
      await fs.rm(destination, { recursive: true, force: true });
      const restore = path.join(recovery, "restore");
      await fs.cp(previous, restore, copyOptions);
      try {
        await rename(restore, destination);
      } catch (restoreError) {
        if (restoreError.code !== "EXDEV") throw restoreError;
        await fs.cp(restore, destination, copyOptions);
      }
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        `Build promotion and recovery failed; previous output preserved in ${previous}`,
      );
    }
    throw new AggregateError(
      [error],
      `Build promotion failed; previous output restored; recovery copy preserved in ${previous}`,
    );
  } finally {
    if (!preserveRecovery)
      await fs.rm(recovery, { recursive: true, force: true });
  }
}
