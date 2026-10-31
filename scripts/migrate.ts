import { sql } from "../src/modules/db";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
try {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz DEFAULT now())`;
  for (const name of (await readdir("migrations"))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    const source = await readFile(`migrations/${name}`, "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(71839201)`;
      const [existing] =
        await tx`SELECT checksum FROM schema_migrations WHERE name=${name}`;
      if (existing) {
        if (existing.checksum !== checksum)
          throw new Error(`Migration checksum mismatch: ${name}`);
        return;
      }
      await tx.unsafe(source);
      await tx`INSERT INTO schema_migrations(name,checksum) VALUES(${name},${checksum})`;
      console.log("Applied", name);
    });
  }
  console.log("Migrations current.");
} finally {
  await sql.end();
}
