import { sql, type Tx } from "./index";
import { createHash } from "node:crypto";
import { requireThat } from "../auth/policy";
export async function rateLimit(key: string, max = 40) {
  const [row] =
    await sql`INSERT INTO rate_limits(key,count,expires_at) VALUES(${key},1,now()+interval '1 minute') ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.count+1 END, expires_at=CASE WHEN rate_limits.expires_at<now() THEN now()+interval '1 minute' ELSE rate_limits.expires_at END RETURNING count`;
  requireThat(
    row.count <= max,
    429,
    "RATE_LIMIT",
    "Слишком много запросов. Попробуйте позже.",
  );
}
export function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export async function idempotent<T>(
  tx: Tx,
  actor: string,
  operation: string,
  key: string | undefined,
  input: unknown,
  run: () => Promise<T>,
): Promise<T> {
  requireThat(
    key && /^[\w-]{8,128}$/.test(key),
    422,
    "IDEMPOTENCY_KEY",
    "Нужен Idempotency-Key длиной 8–128 символов",
  );
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${actor + operation + key},0))`;
  const hash = fingerprint(input);
  const [found] =
    await tx`SELECT * FROM operation_keys WHERE actor_id=${actor} AND operation=${operation} AND key=${key}`;
  if (found) {
    requireThat(
      found.fingerprint === hash,
      409,
      "KEY_REUSED",
      "Ключ уже использован с другими параметрами",
    );
    return found.result as T;
  }
  const result = await run();
  await tx`INSERT INTO operation_keys(actor_id,operation,key,fingerprint,result) VALUES(${actor},${operation},${key},${hash},${tx.json(result as never)})`;
  return result;
}
