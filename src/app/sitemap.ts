import type { MetadataRoute } from "next";
import { sql } from "@/modules/db";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL;
  const works =
    await sql`SELECT slug,updated_at FROM artworks WHERE editorial_status='PUBLISHED' AND visibility='PUBLIC'`;
  const articles =
    await sql`SELECT slug,type,updated_at FROM content WHERE status='PUBLISHED' AND visibility='PUBLIC' AND type IN ('ARTICLE','PAGE','EVENT','AUCTION')`;
  const calls = await sql`SELECT slug FROM open_calls WHERE status='PUBLISHED'`;
  return [
    { url: `${base}/` },
    ...works.map((w) => ({
      url: `${base}/works/${w.slug}`,
      lastModified: w.updated_at,
    })),
    ...articles.map((a) => ({
      url: `${base}/${a.type === "PAGE" ? "" : a.type === "ARTICLE" ? "journal/" : a.type === "EVENT" ? "events/" : "auctions/"}${a.slug}`,
      lastModified: a.updated_at,
    })),
    ...calls.map((c) => ({ url: `${base}/open-calls/${c.slug}` })),
  ];
}
