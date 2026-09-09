import { createWindChimeSqlite } from "@windchime/embed/sqlite";
import { createWindChimeService } from "@windchime/embed/server";
import { createWindChimeRouteHandlers } from "@windchime/embed/next";
import { authorizeAdmin, hasAdminAccess } from "./auth";

// Lazy initialization keeps build-time imports independent of runtime secrets.
// This example owns its connection; a host with its own DB also supplies ready().
const cached = globalThis as typeof globalThis & {
  exampleWindChime?: ReturnType<typeof createWindChimeService>;
};
export function getService() {
  if (!cached.exampleWindChime) {
    const hashSalt = process.env.WINDCHIME_HASH_SALT;
    if (!hashSalt)
      throw new Error("Run npm run setup before starting the example");
    const storage = createWindChimeSqlite({
      filename: process.env.DATABASE_PATH || "data/windchime.db",
    });
    cached.exampleWindChime = createWindChimeService({
      storage,
      hashSalt,
      turnstileSecret: process.env.TURNSTILE_SECRET,
    });
  }
  return cached.exampleWindChime;
}
export function handleMailRequest(req: Request) {
  const handlers = createWindChimeRouteHandlers({
    service: getService(),
    authorizeAdmin,
    hasAdminAccess,
  });
  return handlers[req.method as keyof typeof handlers](req);
}
