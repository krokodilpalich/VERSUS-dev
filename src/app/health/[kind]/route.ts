import { sql } from "@/modules/db";
import { env } from "@/modules/config/env";
import { storage } from "@/modules/integrations/storage";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import Redis from "ioredis";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (kind === "live") return Response.json({ status: "alive" });
  if (kind !== "ready") return new Response(null, { status: 404 });
  try {
    const e = env();
    await sql`SELECT 1`;
    const r = new Redis(e.REDIS_URL, {
      connectTimeout: 2000,
      maxRetriesPerRequest: 0,
      lazyConnect: true,
    });
    try {
      await r.ping();
    } finally {
      r.disconnect();
    }
    await storage().send(
      new HeadBucketCommand({ Bucket: e.S3_BUCKET_PRIVATE }),
    );
    return Response.json({ status: "ready" });
  } catch {
    return Response.json({ status: "not-ready" }, { status: 503 });
  }
}
