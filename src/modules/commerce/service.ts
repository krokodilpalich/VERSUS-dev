import { z } from "zod";
import { sql, audit, notify, type Tx } from "../db";
import {
  signed,
  staff,
  requireThat,
  isOperator,
  type Actor,
} from "../auth/policy";
import { visibleArtwork, idSchema, money } from "../catalog/service";
import { idempotent } from "../db/helpers";
import { env } from "../config/env";
import { checkListingRights } from "../catalog/rights";
export function commission(amount: number, basisPoints: number) {
  requireThat(
    Number.isSafeInteger(amount) &&
      amount > 0 &&
      Number.isInteger(basisPoints) &&
      basisPoints >= 0 &&
      basisPoints <= 10000,
    422,
    "INVALID_MONEY",
    "Некорректная сумма или комиссия",
  );
  const fee = Number((BigInt(amount) * BigInt(basisPoints) + 5000n) / 10000n);
  return {
    amountMinor: amount,
    basisPoints,
    feeMinor: fee,
    sellerNetMinor: amount - fee,
    currency: "RUB",
  };
}
async function allowedListing(tx: Tx, actor: Actor, id: string) {
  const [l] =
    await tx`SELECT l.*,v.artwork_id,w.artist_id,a.user_id AS author_id FROM listings l JOIN edition_variants v ON v.id=l.edition_variant_id JOIN artworks w ON w.id=v.artwork_id JOIN artists a ON a.id=w.artist_id WHERE l.id=${id}`;
  requireThat(l, 404, "NOT_FOUND", "Предложение не найдено");
  await tx`SELECT id FROM artworks WHERE id=${l.artwork_id} FOR SHARE`;
  await visibleArtwork(l.artwork_id, actor, tx);
  requireThat(
    l.status === "PUBLISHED" && l.price_mode !== "NOT_FOR_SALE",
    409,
    "LISTING_UNAVAILABLE",
    "Предложение недоступно",
  );
  await checkListingRights(
    tx,
    l as {
      representative_org_id: string | null;
      artwork_id: string;
      artist_id: string;
      author_id: string;
      seller_id: string;
    },
  );
  requireThat(
    l.seller_id !== actor.id,
    409,
    "SELF_PURCHASE",
    "Нельзя отправить запрос на собственное предложение",
  );
  return l;
}
export async function createInquiry(actor: Actor | null, input: unknown) {
  signed(actor);
  const d = z
    .object({
      listingId: idSchema,
      type: z.enum([
        "BUY",
        "PRICE",
        "AVAILABILITY",
        "INSTITUTIONAL",
        "LICENSING",
        "CURATORIAL",
      ]),
      message: z.string().min(10).max(5000),
      contactPreference: z.literal("IN_PLATFORM").default("IN_PLATFORM"),
    })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const l = await allowedListing(tx, actor, d.listingId);
    const [i] =
      await tx`INSERT INTO inquiries(created_by,listing_id,type) VALUES(${actor.id},${d.listingId},${d.type}) RETURNING id,status`;
    await tx`INSERT INTO inquiry_messages(inquiry_id,author_id,body) VALUES(${i.id},${actor.id},${d.message})`;
    await notify(
      tx,
      l.seller_id,
      "InquiryCreated",
      "Новый запрос по вашему предложению",
    );
    await audit(tx, actor.id, "Inquiry", i.id, "INQUIRY_CREATED");
    return i;
  });
}
export async function inquiryAccess(
  tx: Tx | typeof sql,
  actor: Actor,
  id: string,
  forUpdate = false,
) {
  const rows = forUpdate
    ? await tx`SELECT i.*,l.seller_id FROM inquiries i JOIN listings l ON l.id=i.listing_id WHERE i.id=${id} FOR UPDATE OF i`
    : await tx`SELECT i.*,l.seller_id FROM inquiries i JOIN listings l ON l.id=i.listing_id WHERE i.id=${id}`;
  const i = rows[0];
  requireThat(
    i &&
      (i.created_by === actor.id ||
        i.seller_id === actor.id ||
        i.assignee_id === actor.id ||
        isOperator(actor)),
    404,
    "NOT_FOUND",
    "Запрос не найден",
  );
  return i;
}
export async function myInquiries(actor: Actor | null) {
  signed(actor);
  return sql`SELECT i.id,i.type,i.status,i.created_at,w.title,l.id AS listing_id FROM inquiries i JOIN listings l ON l.id=i.listing_id JOIN edition_variants v ON v.id=l.edition_variant_id JOIN artworks w ON w.id=v.artwork_id WHERE i.created_by=${actor.id} OR l.seller_id=${actor.id} OR i.assignee_id=${actor.id} OR ${isOperator(actor)} ORDER BY i.created_at DESC`;
}
export async function inquiryDetail(actor: Actor | null, id: string) {
  signed(actor);
  const i = await inquiryAccess(sql, actor, id);
  const messages =
    await sql`SELECT id,body,created_at,author_id=${actor.id} AS is_mine FROM inquiry_messages WHERE inquiry_id=${id} ORDER BY created_at`;
  const offers =
    await sql`SELECT id,amount_minor::float8,currency,valid_until,terms,status,commission_snapshot FROM offers WHERE inquiry_id=${id} ORDER BY created_at DESC`;
  const deals =
    await sql`SELECT id,status,amount_minor::float8,commission_snapshot FROM deals WHERE inquiry_id=${id}`;
  return {
    id: i.id,
    status: i.status,
    isBuyer: i.created_by === actor.id,
    canManage:
      i.seller_id === actor.id ||
      isOperator(actor) ||
      i.assignee_id === actor.id,
    messages,
    offers,
    deals,
  };
}
export async function replyInquiry(
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  signed(actor);
  const d = z
    .object({ message: z.string().min(2).max(5000) })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const i = await inquiryAccess(tx, actor, id, true);
    await tx`INSERT INTO inquiry_messages(inquiry_id,author_id,body) VALUES(${id},${actor.id},${d.message})`;
    if (i.created_by !== actor.id)
      await tx`UPDATE inquiries SET status=CASE WHEN status IN ('NEW','ASSIGNED') THEN 'CONTACTED' ELSE status END WHERE id=${id}`;
    await notify(
      tx,
      i.created_by === actor.id ? i.seller_id : i.created_by,
      "InquiryMessage",
      "Новое сообщение в запросе",
    );
    await audit(tx, actor.id, "Inquiry", id, "INQUIRY_REPLIED");
    return { id };
  });
}
export async function createOffer(
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  signed(actor);
  const d = z
    .object({
      amountMinor: money,
      validUntil: z.iso.datetime({ offset: true }),
      terms: z.string().min(20).max(10000),
      commissionPolicyId: idSchema,
    })
    .strict()
    .parse(input);
  requireThat(
    new Date(d.validUntil) > new Date(),
    422,
    "OFFER_EXPIRED",
    "Оферта должна действовать в будущем",
  );
  return sql.begin(async (tx) => {
    const i = await inquiryAccess(tx, actor, id, true);
    requireThat(
      i.created_by !== actor.id &&
        (i.seller_id === actor.id ||
          isOperator(actor) ||
          i.assignee_id === actor.id),
      403,
      "FORBIDDEN",
      "Только продавец или оператор может создать оферту",
    );
    requireThat(
      !["WON", "LOST", "CANCELLED"].includes(i.status),
      409,
      "STATE_CONFLICT",
      "Запрос закрыт",
    );
    const [p] =
      await tx`SELECT * FROM commission_policies WHERE id=${d.commissionPolicyId} AND status='ACTIVE'`;
    requireThat(
      p && p.basis_points !== null,
      409,
      "POLICY_REQUIRED",
      "Нужна утверждённая политика комиссии",
    );
    requireThat(
      !p.is_demo || env().DEMO_MODE === "true",
      409,
      "DEMO_POLICY",
      "DEMO-политика запрещена вне демонстрационной среды",
    );
    const snapshot = {
      ...commission(d.amountMinor, p.basis_points),
      policyId: p.id,
      policyName: p.name,
      version: p.version,
      isDemo: p.is_demo,
    };
    await tx`UPDATE offers SET status='SUPERSEDED' WHERE inquiry_id=${id} AND status='OFFERED'`;
    const [o] =
      await tx`INSERT INTO offers(inquiry_id,amount_minor,valid_until,terms,commission_policy_id,commission_snapshot) VALUES(${id},${d.amountMinor},${d.validUntil},${d.terms},${p.id},${tx.json(snapshot)}) RETURNING id,status`;
    await tx`UPDATE inquiries SET status='OFFERED' WHERE id=${id}`;
    await audit(tx, actor.id, "Offer", o.id, "OFFER_CREATED", {
      commissionSnapshot: snapshot,
    });
    await notify(
      tx,
      i.created_by,
      "OfferCreated",
      "В вашем запросе сформирована оферта",
    );
    return o;
  });
}
async function reserve(tx: Tx, actor: Actor, listingId: string) {
  const l = await allowedListing(tx, actor, listingId);
  const [c] =
    await tx`SELECT * FROM edition_copies WHERE id=${l.edition_copy_id} FOR UPDATE`;
  requireThat(
    c && c.status !== "SOLD" && c.status !== "ON_HOLD",
    409,
    "COPY_UNAVAILABLE",
    "Экземпляр недоступен",
  );
  await tx`UPDATE reservations SET status='EXPIRED' WHERE edition_copy_id=${c.id} AND status='ACTIVE' AND expires_at<=now()`;
  const [existing] =
    await tx`SELECT * FROM reservations WHERE edition_copy_id=${c.id} AND status='ACTIVE'`;
  if (existing) {
    requireThat(
      existing.buyer_id === actor.id,
      409,
      "ALREADY_RESERVED",
      "Экземпляр уже зарезервирован",
    );
    return existing;
  }
  const [r] =
    await tx`INSERT INTO reservations(edition_copy_id,listing_id,buyer_id,expires_at) VALUES(${c.id},${listingId},${actor.id},now()+${env().RESERVATION_HOURS}*interval '1 hour') RETURNING id,edition_copy_id,expires_at,status`;
  await tx`UPDATE edition_copies SET status='RESERVED' WHERE id=${c.id}`;
  await audit(tx, actor.id, "Reservation", r.id, "RESERVATION_CREATED", {
    copyId: c.id,
  });
  return r;
}
export async function createReservation(
  actor: Actor | null,
  input: unknown,
  key?: string,
) {
  signed(actor);
  const d = z.object({ listingId: idSchema }).strict().parse(input);
  return sql.begin(async (tx) =>
    idempotent(tx, actor.id, "reserve", key, d, async () =>
      reserve(tx, actor, d.listingId),
    ),
  );
}
export async function acceptOffer(
  actor: Actor | null,
  id: string,
  key?: string,
) {
  signed(actor);
  return sql.begin(async (tx) =>
    idempotent(tx, actor.id, "accept-offer", key, { id }, async () => {
      const [o] =
        await tx`SELECT o.*,i.created_by,i.listing_id,l.seller_id FROM offers o JOIN inquiries i ON i.id=o.inquiry_id JOIN listings l ON l.id=i.listing_id WHERE o.id=${id} FOR UPDATE OF o`;
      requireThat(
        o && o.created_by === actor.id,
        404,
        "NOT_FOUND",
        "Оферта не найдена",
      );
      requireThat(
        o.status === "OFFERED" && new Date(o.valid_until) > new Date(),
        409,
        "OFFER_UNAVAILABLE",
        "Оферта недоступна или истекла",
      );
      const r = await reserve(tx, actor, o.listing_id);
      const [d] =
        await tx`INSERT INTO deals(inquiry_id,offer_id,listing_id,edition_copy_id,reservation_id,buyer_id,seller_id,amount_minor,commission_snapshot,terms_snapshot) VALUES(${o.inquiry_id},${id},${o.listing_id},${r.edition_copy_id},${r.id},${actor.id},${o.seller_id},${o.amount_minor},${tx.json(o.commission_snapshot)},${o.terms}) RETURNING id,status`;
      await tx`UPDATE offers SET status='ACCEPTED' WHERE id=${id}`;
      await tx`INSERT INTO deal_events(deal_id,event_type,actor_id) VALUES(${d.id},'OFFLINE_AGREED',${actor.id})`;
      await audit(tx, actor.id, "Deal", d.id, "OFFER_ACCEPTED");
      await notify(
        tx,
        o.seller_id,
        "OfferAccepted",
        "Оферта принята. Офлайн-согласование не является оплатой.",
      );
      return d;
    }),
  );
}
export async function requestCompletion(
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  signed(actor);
  const d = z
    .object({ evidence: z.string().min(20).max(3000) })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    const [deal] = await tx`SELECT * FROM deals WHERE id=${id} FOR UPDATE`;
    requireThat(
      deal && (deal.seller_id === actor.id || isOperator(actor)),
      404,
      "NOT_FOUND",
      "Сделка не найдена",
    );
    requireThat(
      deal.status === "OFFLINE_AGREED",
      409,
      "STATE_CONFLICT",
      "Некорректный статус сделки",
    );
    await tx`UPDATE deals SET status='OFFLINE_COMPLETION_PENDING_VERIFICATION',evidence=${d.evidence} WHERE id=${id}`;
    await tx`INSERT INTO deal_events(deal_id,event_type,actor_id) VALUES(${id},'OFFLINE_COMPLETION_PENDING_VERIFICATION',${actor.id})`;
    await audit(tx, actor.id, "Deal", id, "OFFLINE_COMPLETION_REQUESTED");
    return { id };
  });
}
export async function confirmOfflineCompletion(
  actor: Actor | null,
  id: string,
  input: unknown,
) {
  staff(actor, "OPERATIONS");
  const d = z
    .object({ evidence: z.string().min(20).max(3000) })
    .strict()
    .parse(input);
  return sql.begin(async (tx) => {
    // Lock order matches expiry: copy first, then reservation and deal.
    const [lookup] = await tx`SELECT edition_copy_id FROM deals WHERE id=${id}`;
    requireThat(lookup, 404, "NOT_FOUND", "Сделка не найдена");
    const [c] =
      await tx`SELECT * FROM edition_copies WHERE id=${lookup.edition_copy_id} FOR UPDATE`;
    const [deal] = await tx`SELECT * FROM deals WHERE id=${id} FOR UPDATE`;
    requireThat(
      deal.status === "OFFLINE_COMPLETION_PENDING_VERIFICATION",
      409,
      "STATE_CONFLICT",
      "Сначала требуется запрос на проверку офлайн-завершения",
    );
    const [r] =
      await tx`SELECT * FROM reservations WHERE id=${deal.reservation_id} FOR UPDATE`;
    requireThat(
      c.status === "RESERVED" &&
        r.status === "ACTIVE" &&
        new Date(r.expires_at) > new Date(),
      409,
      "RESERVATION_EXPIRED",
      "Резерв уже недействителен",
    );
    await tx`UPDATE deals SET status='OFFLINE_CONFIRMED',evidence=${d.evidence},confirmed_by=${actor.id} WHERE id=${id}`;
    await tx`UPDATE edition_copies SET status='SOLD' WHERE id=${c.id}`;
    await tx`UPDATE reservations SET status='COMPLETED' WHERE id=${r.id}`;
    await tx`UPDATE listings SET status='ARCHIVED' WHERE edition_copy_id=${c.id}`;
    await tx`UPDATE inquiries SET status='WON' WHERE id=${deal.inquiry_id}`;
    await tx`INSERT INTO deal_events(deal_id,event_type,actor_id,details) VALUES(${id},'OFFLINE_CONFIRMED',${actor.id},${tx.json({ evidenceRecorded: true })})`;
    await audit(tx, actor.id, "Deal", id, "OFFLINE_CONFIRMED", {
      evidenceRecorded: true,
      commissionSnapshot: deal.commission_snapshot,
    });
    await notify(
      tx,
      deal.buyer_id,
      "DealConfirmed",
      "Сотрудник подтвердил офлайн-завершение сделки",
    );
    return { id, status: "OFFLINE_CONFIRMED" };
  });
}
export async function releaseExpiredReservations() {
  return sql.begin(async (tx) => {
    const copies =
      await tx`SELECT c.id FROM edition_copies c WHERE EXISTS(SELECT 1 FROM reservations r WHERE r.edition_copy_id=c.id AND r.status='ACTIVE' AND r.expires_at<=now()) ORDER BY c.id FOR UPDATE SKIP LOCKED`;
    let count = 0;
    for (const c of copies) {
      const expired =
        await tx`UPDATE reservations SET status='EXPIRED' WHERE edition_copy_id=${c.id} AND status='ACTIVE' AND expires_at<=now() RETURNING id,buyer_id`;
      if (!expired.length) continue;
      await tx`UPDATE edition_copies SET status='AVAILABLE' WHERE id=${c.id} AND status='RESERVED' AND NOT EXISTS(SELECT 1 FROM reservations WHERE edition_copy_id=${c.id} AND status='ACTIVE')`;
      for (const r of expired) {
        await tx`UPDATE deals SET status='EXPIRED' WHERE reservation_id=${r.id} AND status IN ('OFFLINE_AGREED','OFFLINE_COMPLETION_PENDING_VERIFICATION')`;
        await audit(tx, null, "Reservation", r.id, "RESERVATION_EXPIRED");
        await notify(
          tx,
          r.buyer_id,
          "ReservationExpired",
          "Срок резервирования истёк",
        );
        count++;
      }
    }
    return { released: count };
  });
}
