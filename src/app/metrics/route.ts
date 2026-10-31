import { headers } from "next/headers";
import { getActor, staff } from "@/modules/auth/policy";
import { sql } from "@/modules/db";
export async function GET() {
  try {
    const a = await getActor(await headers());
    staff(a);
    const [m] =
      await sql`SELECT (SELECT count(*) FROM inquiries) AS inquiries,(SELECT count(*) FROM deals WHERE status='OFFLINE_CONFIRMED') AS offline_confirmed,(SELECT count(*) FROM outbox_events WHERE status='DEAD') AS outbox_dead`;
    return new Response(
      `versus_inquiries_total ${m.inquiries}\nversus_offline_confirmed_total ${m.offline_confirmed}\nversus_outbox_dead ${m.outbox_dead}\n`,
      {
        headers: {
          "Content-Type": "text/plain; version=0.0.4",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
}
