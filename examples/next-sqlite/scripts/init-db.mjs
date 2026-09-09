import { createWindChimeSqlite } from "@windchime/embed/sqlite";
const storage = createWindChimeSqlite({
  filename: process.env.DATABASE_PATH || "data/windchime.db",
});
try {
  await storage.ready;
  console.log("Database initialized; existing records preserved.");
} finally {
  await storage.close();
}
