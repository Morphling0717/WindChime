import type { WindChimeSqlExecutor } from "../sqlite/index.js";

/** Missing settings (including an existing word list) never opt a site in. */
export async function readBlockedTermsEnabled(db: WindChimeSqlExecutor): Promise<boolean> {
  const row = await db.get<{ value: string }>(
    "SELECT value FROM mail_settings WHERE key='mail.blocked_terms_enabled'",
  );
  return row?.value === "true";
}
