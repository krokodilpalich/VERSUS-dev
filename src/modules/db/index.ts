import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
const globalDb = globalThis as unknown as {
  rawSql?: ReturnType<typeof postgres>;
  ormSql?: ReturnType<typeof postgres>;
};
export const sql =
  globalDb.rawSql ??
  postgres(
    process.env.DATABASE_URL ?? "postgres://unconfigured@localhost/versus",
    { max: 10, prepare: false, onnotice: () => {} },
  );

// Drizzle overrides JSON/date serializers. Keep its pool separate from raw transactional SQL.
if (process.env.NODE_ENV !== "production") globalDb.rawSql = sql;
export const ormSql =
  globalDb.ormSql ??
  postgres(
    process.env.DATABASE_URL ?? "postgres://unconfigured@localhost/versus",
    { max: 5, prepare: false, onnotice: () => {} },
  );
if (process.env.NODE_ENV !== "production") globalDb.ormSql = ormSql;
export const db = drizzle(ormSql, { schema });
export type Tx = postgres.TransactionSql;
export async function audit(
  tx: Tx,
  actor: string | null,
  subject: string,
  id: string,
  action: string,
  details: Record<string, unknown> = {},
) {
  await tx`INSERT INTO audit_events(actor_id,subject_type,subject_id,action,details) VALUES(${actor},${subject},${id},${action},${tx.json(details as never)})`;
}
export async function notify(
  tx: Tx,
  recipient: string,
  type: string,
  message: string,
) {
  await tx`INSERT INTO notifications(recipient_id,type,message) VALUES(${recipient},${type},${message})`;
  await tx`INSERT INTO outbox_events(recipient_id,type,payload) VALUES(${recipient},${type},${tx.json({ message })})`;
}
