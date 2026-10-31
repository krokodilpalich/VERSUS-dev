import { createHash } from "node:crypto";
import { sql } from "../src/modules/db";
import { env } from "../src/modules/config/env";
import {
  createInquiry,
  createOffer,
  acceptOffer,
  requestCompletion,
  confirmOfflineCompletion,
  createReservation,
  releaseExpiredReservations,
} from "../src/modules/commerce/service";
import { submitApplication } from "../src/modules/calls/service";
import { publishListing } from "../src/modules/catalog/service";
import type { Actor } from "../src/modules/auth/policy";
const e = env();
if (process.env.NODE_ENV === "production" || e.DEMO_MODE !== "true")
  throw new Error("Local DEMO only");
const id = (key: string) => {
  const h = createHash("sha256")
    .update("VERSUS_DEMO_" + key)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const actor = (key: string, role: string): Actor => ({
  id: id(key),
  email: key + "@versus.local",
  name: "DEMO",
  verified: true,
  mfa: role === "ADMIN",
  roles: [role],
});
try {
  for (let n = 1; n <= 2; n++) {
    const [existing] =
      await sql`SELECT id FROM deals WHERE listing_id=${id("listing" + n)} AND buyer_id=${id("collector" + (n + 7))}`;
    if (existing) continue;
    const buyer = actor("collector" + (n + 7), "COLLECTOR"),
      seller = actor("artist" + n, "ARTIST");
    const i = await createInquiry(buyer, {
      listingId: id("listing" + n),
      type: "BUY",
      message:
        "DEMO — фиктивная офлайн-сделка для демонстрации. Реального расчёта и передачи нет.",
    });
    const o = await createOffer(seller, i.id, {
      amountMinor: 2000000 + n * 100000,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      terms:
        "DEMO — вымышленная продажа. Доставка, документы и комиссия демонстрационные.",
      commissionPolicyId: id("policy"),
    });
    const d = await acceptOffer(buyer, o.id, "demo-seed-accept-" + n);
    await requestCompletion(seller, d.id, {
      evidence: "DEMO — вымышленный акт передачи для проверки интерфейса.",
    });
    await confirmOfflineCompletion(actor("admin", "ADMIN"), d.id, {
      evidence: "DEMO — фиктивный результат, не означает реальной продажи.",
    });
  }
  for (let n = 2; n <= 7; n++) {
    const [existing] =
      await sql`SELECT id FROM applications WHERE applicant_id=${id("artist" + n)} AND open_call_id=${id("call1")}`;
    if (!existing)
      await submitApplication(actor("artist" + n, "ARTIST"), id("call1"), {
        statement:
          "DEMO — вымышленный проект для показа сценария открытого конкурса.",
        workIds: [id("work" + n)],
        rulesAccepted: true,
        dataConsent: true,
      });
  }
  const [existingOffer] =
    await sql`SELECT o.id FROM offers o JOIN inquiries i ON i.id=o.inquiry_id WHERE i.listing_id=${id("listing3")}`;
  if (!existingOffer) {
    const inquiry = await createInquiry(actor("collector4", "COLLECTOR"), {
      listingId: id("listing3"),
      type: "PRICE",
      message: "DEMO — прошу уточнить условия демонстрационного предложения.",
    });
    await createOffer(actor("artist3", "ARTIST"), inquiry.id, {
      amountMinor: 3500000,
      validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
      terms:
        "DEMO — пример открытой оферты с отдельным согласованием доставки.",
      commissionPolicyId: id("policy"),
    });
  }
  const [existingListing] =
    await sql`SELECT id FROM listings WHERE edition_copy_id=${id("copy3-2")}`;
  const listing =
    existingListing ??
    (await publishListing(actor("artist3", "ARTIST"), {
      copyId: id("copy3-2"),
      priceMode: "PRICE_ON_REQUEST",
      priceMinor: null,
      rightsEvidence: "DEMO — авторское право на синтетическую композицию",
    }));
  const [expired] =
    await sql`SELECT id FROM reservations WHERE listing_id=${listing.id}`;
  if (!expired) {
    const r = await createReservation(
      actor("collector10", "COLLECTOR"),
      { listingId: listing.id },
      "demo-expired-reservation",
    );
    await sql`UPDATE reservations SET expires_at=now()-interval '1 minute' WHERE id=${r.id}`;
    await releaseExpiredReservations();
  }
  console.log(
    "DEMO commerce: 2 offline confirmations, pending offer, 6 applications, expired reservation.",
  );
} finally {
  await sql.end();
}
