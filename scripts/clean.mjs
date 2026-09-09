import { rm } from "node:fs/promises";
await Promise.all(
  ["dist", ".windchime-build"].map((dir) =>
    rm(new URL(`../${dir}`, import.meta.url), { recursive: true, force: true }),
  ),
);
