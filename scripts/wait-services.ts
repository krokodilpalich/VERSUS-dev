import { setTimeout } from "node:timers/promises";
import { sql } from "../src/modules/db";
import {
  storage,
  ensureBuckets,
  put,
} from "../src/modules/integrations/storage";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../src/modules/config/env";
try {
  let ready = false;
  for (let i = 0; i < 45; i++) {
    try {
      await sql`SELECT 1`;
      await ensureBuckets();
      const e = env();
      await put(
        e.S3_BUCKET_PRIVATE,
        "health/probe",
        Buffer.alloc(8192),
        "application/octet-stream",
      );
      await put(
        e.S3_BUCKET_PUBLIC,
        "health/probe",
        Buffer.alloc(8192),
        "application/octet-stream",
      );
      await storage().send(
        new DeleteObjectCommand({
          Bucket: e.S3_BUCKET_PRIVATE,
          Key: "health/probe",
        }),
      );
      await storage().send(
        new DeleteObjectCommand({
          Bucket: e.S3_BUCKET_PUBLIC,
          Key: "health/probe",
        }),
      );
      ready = true;
      break;
    } catch {
      await setTimeout(1000);
    }
  }
  if (!ready) throw new Error("PostgreSQL/S3 did not become writable");
  console.log("PostgreSQL and both authenticated S3 buckets are writable.");
} finally {
  await sql.end();
}
