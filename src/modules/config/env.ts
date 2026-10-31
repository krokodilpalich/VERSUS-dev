import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  APP_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET_PRIVATE: z.string().min(3),
  S3_BUCKET_PUBLIC: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(3),
  S3_SECRET_KEY: z.string().min(8),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number().int().default(1025),
  MAIL_FROM: z.string(),
  MAIL_MODE: z.enum(["local", "disabled"]).default("local"),
  PAYMENTS_MODE: z.literal("disabled").default("disabled"),
  FEATURE_AUCTIONS: z.literal("false").default("false"),
  FEATURE_CHECKOUT: z.literal("false").default("false"),
  RESERVATION_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
});
export function env() {
  return schema.parse(process.env);
}
