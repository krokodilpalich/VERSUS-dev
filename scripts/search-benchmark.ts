import { performance } from "node:perf_hooks";
import { sql } from "../src/modules/db";
import { env } from "../src/modules/config/env";
if (env().DEMO_MODE !== "true")
  throw new Error(
    "Synthetic benchmark is restricted to isolated DEMO environments",
  );
class RollbackBenchmark extends Error {}
const prefix = "benchmark-" + crypto.randomUUID();
try {
  await sql.begin(async (tx) => {
    const [artist] = await tx`SELECT id FROM artists LIMIT 1`;
    if (!artist) throw new Error("Run seed first");
    await tx`INSERT INTO "user"(id,name,email) SELECT gen_random_uuid()::text,'SYNTHETIC',${prefix}||n||'@example.invalid' FROM generate_series(1,10000) n`;
    await tx`INSERT INTO artworks(artist_id,title,slug,capture_year,description,genre,color_mode,editorial_status,visibility) SELECT ${artist.id},'Искусственный свет '||n,${prefix}||n,2026,'Синтетическая композиция для измерения поиска без реальных пользователей.','Абстракция','BW','PUBLISHED','PUBLIC' FROM generate_series(1,50000) n`;
    await tx`INSERT INTO edition_variants(artwork_id,print_technique,paper,image_width_mm,image_height_mm,sheet_width_mm,sheet_height_mm,edition_type,edition_total) SELECT id,'Пигментная печать','Бумага',400,600,450,650,'LIMITED',5 FROM artworks WHERE slug LIKE ${prefix + "%"}`;
    await tx`INSERT INTO artwork_media(artwork_id,storage_key_original,derivative_key,thumbnail_key,alt_text,rights_holder,mime_type) SELECT w.id,'SYNTHETIC_NOT_STORED','SYNTHETIC_NOT_STORED','SYNTHETIC_NOT_STORED','Синтетическая запись','DEMO','image/webp' FROM artworks w CROSS JOIN generate_series(1,2) n WHERE w.slug LIKE ${prefix + "%"}`;
    const timings: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      const rows =
        await tx`SELECT w.id,w.title,a.name,count(*) OVER()::int AS total FROM artworks w JOIN artists a ON a.id=w.artist_id WHERE w.editorial_status='PUBLISHED' AND w.visibility='PUBLIC' AND w.search_vector @@ websearch_to_tsquery('russian','искусственный свет') AND EXISTS(SELECT 1 FROM artwork_media m WHERE m.artwork_id=w.id) AND EXISTS(SELECT 1 FROM edition_variants v WHERE v.artwork_id=w.id AND v.image_width_mm<=10000) ORDER BY w.created_at DESC LIMIT 12`;
      if (rows.length !== 12 || rows[0].total < 50000)
        throw new Error("Synthetic target not exercised");
      timings.push(performance.now() - start);
    }
    timings.sort((a, b) => a - b);
    console.log(
      JSON.stringify(
        {
          scope: "PostgreSQL catalog query only; not HTTP, LCP or S3 load",
          syntheticUsers: 10000,
          syntheticArtworks: 50000,
          syntheticMediaRows: 100000,
          queries: timings.length,
          p50Ms: Math.round(timings[9]),
          p95Ms: Math.round(timings[18]),
          storageObjectsCreated: 0,
          transaction: "rolled back",
        },
        null,
        2,
      ),
    );
    throw new RollbackBenchmark();
  });
} catch (error) {
  if (!(error instanceof RollbackBenchmark)) throw error;
} finally {
  await sql.end();
}
