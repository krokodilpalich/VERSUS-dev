import { Queue, Worker } from "bullmq";
import { symmetricDecrypt } from "better-auth/crypto";
import { sql } from "../db";
import { env } from "../config/env";
import { sendMail } from "./mail";
import { releaseExpiredReservations } from "../commerce/service";
const e = env();
const u = new URL(e.REDIS_URL);
const connection = {
  host: u.hostname,
  port: Number(u.port) || 6379,
  password: u.password || undefined,
  maxRetriesPerRequest: null,
};
const queue = new Queue("versus-outbox", { connection });
const worker = new Worker(
  "versus-outbox",
  async (job) => {
    const [event] =
      await sql`SELECT * FROM outbox_events WHERE id=${job.data.id}`;
    if (!event || event.status === "DELIVERED") return;
    const payload = event.payload as {
      message?: string;
      email?: string;
      encryptedToken?: string;
    };
    if (event.type === "PrivateInvite") {
      const token = await symmetricDecrypt({
        key: e.SESSION_SECRET,
        data: payload.encryptedToken!,
      });
      await sendMail(
        payload.email!,
        "VERSUS — приглашение в Private Circle",
        `Войдите с подтверждённым email и примите приглашение: ${e.APP_URL}/private/invitations?token=${token}`,
      );
    } else if (event.recipient_id) {
      const [user] =
        await sql`SELECT email FROM "user" WHERE id=${event.recipient_id}`;
      if (user)
        await sendMail(
          user.email,
          "VERSUS — уведомление",
          payload.message ?? "Новое событие в вашем кабинете",
        );
    }
    await sql`UPDATE outbox_events SET status='DELIVERED',delivered_at=now(),payload=CASE WHEN type='PrivateInvite' THEN '{"redacted":true}'::jsonb ELSE payload END WHERE id=${event.id}`;
  },
  { connection, concurrency: 3 },
);
worker.on("failed", async (job) => {
  if (job)
    await sql`UPDATE outbox_events SET attempts=attempts+1,status=CASE WHEN attempts>=4 THEN 'DEAD' ELSE 'PENDING' END,next_attempt_at=now()+interval '1 minute' WHERE id=${job.data.id}`;
  console.error(
    "Outbox delivery failed; see event status (no recipient logged).",
  );
});
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    await releaseExpiredReservations();
    const events =
      await sql`SELECT id FROM outbox_events WHERE status='PENDING' AND next_attempt_at<=now() ORDER BY created_at LIMIT 50`;
    for (const event of events)
      await queue.add(
        "deliver",
        { id: event.id },
        {
          jobId: event.id,
          attempts: 5,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
  } catch {
    console.error("Worker tick failed; retrying on next interval.");
  } finally {
    running = false;
  }
}
const interval = setInterval(tick, 3000);
await tick();
console.log("VERSUS worker started: outbox + reservation expiry.");
async function shutdown() {
  clearInterval(interval);
  await worker.close();
  await queue.close();
  await sql.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
