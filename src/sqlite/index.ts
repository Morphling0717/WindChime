import sqlite3 from "sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { initializeWindChimeSchema } from "./schema.js";
export type WindChimeSqlValue = string | number | null | Uint8Array;
export interface WindChimeSqlExecutor {
  get<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T | undefined>;
  all<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
  run(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ changes: number; lastID: number }>;
}
export interface WindChimeStorage extends WindChimeSqlExecutor {
  readonly ready: Promise<void>;
  transaction<T>(work: (tx: WindChimeSqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export type WindChimeSqliteOptions = {
  filename: string;
  busyTimeoutMs?: number;
  defaultTopicTitle?: string;
};
/** One persistent connection, with every operation queued so no query enters another operation's transaction. */
export function createWindChimeSqlite(
  options: WindChimeSqliteOptions,
): WindChimeStorage {
  if (!options.filename) throw new Error("SQLite filename is required");
  if (options.filename !== ":memory:")
    mkdirSync(dirname(resolve(options.filename)), { recursive: true });
  const busyTimeoutMs = options.busyTimeoutMs ?? 5000;
  if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0)
    throw new Error("busyTimeoutMs must be a non-negative integer");
  let db!: sqlite3.Database;
  let didOpen = false;
  const opened = new Promise<void>((resolve, reject) => {
    db = new sqlite3.Database(options.filename, (error) => {
      if (error) reject(error);
      else {
        didOpen = true;
        resolve();
      }
    });
  });
  // A long native busy wait occupies a libuv worker. With several connections,
  // all workers can wait for a lock whose owner needs a worker to commit.
  // Short native waits plus asynchronous retries let the owner make progress.
  db.configure("busyTimeout", Math.min(busyTimeoutMs, 25));
  const raw: WindChimeSqlExecutor = {
    get: <T>(sql: string, params: readonly unknown[] = []) =>
      retryBusy(
        () =>
          new Promise<T | undefined>((resolve, reject) =>
            db.get(sql, params, (error: Error | null, row: T) =>
              error ? reject(error) : resolve(row),
            ),
          ),
      ),
    all: <T>(sql: string, params: readonly unknown[] = []) =>
      retryBusy(
        () =>
          new Promise<T[]>((resolve, reject) =>
            db.all(sql, params, (error: Error | null, rows: T[]) =>
              error ? reject(error) : resolve(rows),
            ),
          ),
      ),
    run: (sql, params = []) =>
      retryBusy(
        () =>
          new Promise<{ changes: number; lastID: number }>((resolve, reject) =>
            db.run(sql, params, function (error) {
              error
                ? reject(error)
                : resolve({ changes: this.changes, lastID: this.lastID });
            }),
          ),
      ),
  };
  async function retryBusy<T>(work: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + busyTimeoutMs;
    for (;;) {
      try {
        return await work();
      } catch (error) {
        if (
          (error as { code?: string }).code !== "SQLITE_BUSY" ||
          Date.now() >= deadline
        )
          throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))),
        );
      }
    }
  }
  const ready = (async () => {
    await opened;
    await raw.run("PRAGMA foreign_keys = ON");
    await raw.run("PRAGMA journal_mode = WAL");
    await initializeWindChimeSchema(
      raw,
      options.defaultTopicTitle ?? "常规信箱",
    );
  })();
  let queue: Promise<unknown> = ready;
  let closed = false;
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(async () => {
      await ready;
      if (closed) throw new Error("WindChime storage is closed");
      return work();
    });
    queue = result.catch(() => undefined);
    return result;
  }
  return {
    ready,
    get: <T>(sql: string, params?: readonly unknown[]) =>
      enqueue(() => raw.get<T>(sql, params)),
    all: <T>(sql: string, params?: readonly unknown[]) =>
      enqueue(() => raw.all<T>(sql, params)),
    run: (sql, params) => enqueue(() => raw.run(sql, params)),
    transaction: (work) =>
      enqueue(async () => {
        await raw.run("BEGIN IMMEDIATE");
        try {
          const result = await work(raw);
          await raw.run("COMMIT");
          return result;
        } catch (error) {
          await raw.run("ROLLBACK").catch(() => undefined);
          throw error;
        }
      }),
    close: async () => {
      await queue.catch(() => undefined);
      if (closed) return;
      closed = true;
      if (!didOpen) return;
      await new Promise<void>((resolve, reject) =>
        db.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
