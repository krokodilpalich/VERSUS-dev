import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { env } from "../config/env";
export function storage() {
  const e = env();
  return new S3Client({
    endpoint: e.S3_ENDPOINT,
    region: e.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: e.S3_ACCESS_KEY,
      secretAccessKey: e.S3_SECRET_KEY,
    },
    maxAttempts: 3,
  });
}
export async function ensureBuckets() {
  const e = env(),
    s3 = storage();
  for (const Bucket of [e.S3_BUCKET_PRIVATE, e.S3_BUCKET_PUBLIC])
    try {
      await s3.send(new HeadBucketCommand({ Bucket }));
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode !== 404
      )
        throw error;
      await s3.send(new CreateBucketCommand({ Bucket }));
    }
}
export async function put(
  bucket: string,
  key: string,
  data: Buffer,
  type: string,
) {
  await storage().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: data,
      ContentType: type,
    }),
  );
}
export async function get(bucket: string, key: string) {
  const result = await storage().send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  return result.Body!.transformToByteArray();
}
