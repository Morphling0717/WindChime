import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
const password = randomBytes(12).toString("base64url");
try {
  await writeFile(
    ".env.local",
    `DATABASE_PATH=data/windchime.db\nWINDCHIME_HASH_SALT=${randomBytes(32).toString("hex")}\nEXAMPLE_ADMIN_PASSWORD=${password}\nEXAMPLE_SESSION_SECRET=${randomBytes(32).toString("hex")}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log("Created .env.local. Local example admin password:", password);
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log(
    ".env.local already exists; preserved existing credentials and identity salt.",
  );
}
