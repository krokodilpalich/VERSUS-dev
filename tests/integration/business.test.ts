import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { sql } from "../../src/modules/db";
import {
  createInquiry,
  createReservation,
  createOffer,
  acceptOffer,
  requestCompletion,
  confirmOfflineCompletion,
  releaseExpiredReservations,
} from "../../src/modules/commerce/service";
import { submitApplication, createCall } from "../../src/modules/calls/service";
import {
  createArtwork,
  workDossier,
  publishListing,
  updateArtwork,
  publicCatalog,
} from "../../src/modules/catalog/service";
import {
  invitePrivateMember,
  verifyPrivateInvite,
  revokeMember,
  privateCollections,
} from "../../src/modules/private/service";
import { symmetricDecrypt } from "better-auth/crypto";
import { env } from "../../src/modules/config/env";
import type { Actor } from "../../src/modules/auth/policy";
import { createHash } from "node:crypto";
const demoId = (key: string) => {
  const h = createHash("sha256")
    .update("VERSUS_DEMO_" + key)
    .digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const makeActor = (key: string, role: string): Actor => ({
  id: demoId(key),
  email: `${key}@versus.local`,
  name: "DEMO",
  verified: true,
  mfa: role === "ADMIN",
  roles: [role],
});
const admin = makeActor("admin", "ADMIN"),
  buyer = makeActor("collector2", "COLLECTOR"),
  other = makeActor("collector3", "COLLECTOR"),
  artist = makeActor("artist1", "ARTIST");
let listing: string, copy: string;
beforeAll(async () => {
  const w = await createArtwork(artist, {
    title: "DEMO Integration " + crypto.randomUUID(),
    seriesId: demoId("series1"),
    captureYear: 2026,
    description:
      "Оригинальная демонстрационная работа для интеграционной проверки.",
    genre: "Абстракция",
    colorMode: "BW",
    visibility: "PUBLIC",
    technique: "Печать",
    paper: "Бумага",
    width: 100,
    height: 100,
    editionType: "LIMITED",
    editionTotal: 3,
    printYear: 2026,
    signed: true,
    rightsAccepted: true,
  });
  await sql`UPDATE artworks SET editorial_status='PUBLISHED' WHERE id=${w.id}`;
  const [c] =
    await sql`SELECT c.id FROM edition_copies c JOIN edition_variants v ON v.id=c.variant_id WHERE v.artwork_id=${w.id} ORDER BY c.number LIMIT 1`;
  copy = c.id;
  const l = await publishListing(artist, {
    copyId: copy,
    priceMode: "FIXED_PRICE",
    priceMinor: 12345678,
    rightsEvidence: "DEMO — право автора на тестовую композицию",
  });
  listing = l.id;
});
afterAll(async () => {
  await sql.end();
});
describe("PostgreSQL invariants", () => {
  it("parallel reservations: exactly one wins; retry key has one effect", async () => {
    const key = crypto.randomUUID();
    const results = await Promise.allSettled([
      createReservation(buyer, { listingId: listing }, key),
      createReservation(other, { listingId: listing }, crypto.randomUUID()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected");
    expect(loser?.status === "rejected" && loser.reason.status).toBe(409);
    const [r] =
      await sql`SELECT * FROM reservations WHERE edition_copy_id=${copy} AND status='ACTIVE'`;
    const who = r.buyer_id === buyer.id ? buyer : other;
    const retryKey = crypto.randomUUID();
    const first = await createReservation(
      who,
      { listingId: listing },
      retryKey,
    );
    const second = await createReservation(
      who,
      { listingId: listing },
      retryKey,
    );
    expect(first.id).toBe(second.id);
    const [count] =
      await sql`SELECT count(*)::int AS n FROM reservations WHERE edition_copy_id=${copy} AND status='ACTIVE'`;
    expect(count.n).toBe(1);
  });
  it("expires reservation and releases copy before next operation", async () => {
    await sql`UPDATE reservations SET expires_at=now()-interval '1 second' WHERE edition_copy_id=${copy}`;
    expect(
      (await releaseExpiredReservations()).released,
    ).toBeGreaterThanOrEqual(1);
    const [c] = await sql`SELECT status FROM edition_copies WHERE id=${copy}`;
    expect(c.status).toBe("AVAILABLE");
  });
  it("offer acceptance is idempotent; offline confirmation preserves snapshot and marks copy sold", async () => {
    const i = await createInquiry(buyer, {
      listingId: listing,
      type: "BUY",
      message: "Хочу уточнить условия этой тестовой работы.",
    });
    const o = await createOffer(artist, i.id, {
      amountMinor: 12345678,
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      terms: "DEMO — доставка и документы согласованы отдельно.",
      commissionPolicyId: demoId("policy"),
    });
    const key = crypto.randomUUID();
    const d = await acceptOffer(buyer, o.id, key);
    expect((await acceptOffer(buyer, o.id, key)).id).toBe(d.id);
    await expect(
      acceptOffer(other, o.id, crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
    await requestCompletion(artist, d.id, {
      evidence: "DEMO — акт передачи тестового экземпляра №1.",
    });
    await confirmOfflineCompletion(admin, d.id, {
      evidence: "DEMO — акт проверен операционным сотрудником.",
    });
    await expect(
      createReservation(other, { listingId: listing }, crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
    const [row] =
      await sql`SELECT status,commission_snapshot FROM deals WHERE id=${d.id}`;
    expect(row.status).toBe("OFFLINE_CONFIRMED");
    expect(row.commission_snapshot.feeMinor).toBe(1234568);
    await expect(
      sql`UPDATE deals SET amount_minor=1 WHERE id=${d.id}`,
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("denies editing another author and selling without a mandate", async () => {
    await expect(
      updateArtwork(other, demoId("work29"), {
        title: "Чужое",
        description: "Попытка несанкционированного изменения",
        version: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      publishListing(other, {
        copyId: demoId("copy2-2"),
        priceMode: "FIXED_PRICE",
        priceMinor: 10000,
        rightsEvidence: "Попытка продажи без действующего мандата",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createArtwork(artist, {
        title: "Чужая серия",
        seriesId: demoId("series2"),
        captureYear: 2026,
        description: "Работа с серией другого автора, не разрешено.",
        genre: "DEMO",
        colorMode: "BW",
        visibility: "PUBLIC",
        technique: "печать",
        paper: "бумага",
        width: 100,
        height: 100,
        editionType: "LIMITED",
        editionTotal: 2,
        printYear: 2026,
        signed: true,
        rightsAccepted: true,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("does not disclose private works in detail, listing or search", async () => {
    await expect(workDossier("demo-work-30", null)).rejects.toMatchObject({
      status: 404,
    });
    const publicWorks = await publicCatalog(new URLSearchParams({ q: "DEMO" }));
    expect(publicWorks.every((w) => w.slug !== "demo-work-30")).toBe(true);
    const publicWork = await workDossier("demo-work-1", null);
    expect(JSON.stringify(publicWork)).not.toContain("versus.local");
    expect(JSON.stringify(publicWork)).not.toContain("seller_id");
  });
  it("rejects external, expired calls, foreign artwork and duplicate applications", async () => {
    const input = {
      statement: "Оригинальная демонстрационная серия исследования света.",
      workIds: [demoId("work1")],
      rulesAccepted: true,
      dataConsent: true,
    };
    await expect(
      submitApplication(artist, demoId("call3"), input),
    ).rejects.toMatchObject({ code: "EXTERNAL_CALL" });
    await expect(
      submitApplication(artist, demoId("call2"), input),
    ).rejects.toMatchObject({ code: "DEADLINE" });
    await expect(
      submitApplication(other, demoId("call1"), input),
    ).rejects.toMatchObject({ status: 403 });
    const call = await createCall(admin, {
      title: "DEMO Integration call",
      organizerName: "DEMO редакция",
      sourceType: "VERSUS_HOSTED",
      sourceUrl: null,
      description: "Демонстрационный внутренний конкурс.",
      requirements: "Только собственные авторские работы.",
      eligibility: "Демо",
      startsAt: new Date(Date.now() - 3600000).toISOString(),
      deadlineAt: new Date(Date.now() + 3600000).toISOString(),
      timezone: "Europe/Moscow",
      maxWorks: 5,
      feeMinor: 0,
      isDemo: true,
    });
    const a = await submitApplication(artist, call.id, input);
    expect(a.receipt).toBeTruthy();
    await expect(
      submitApplication(artist, call.id, input),
    ).rejects.toMatchObject({ code: "APPLICATION_LIMIT" });
  });
  it("email-bound one-use invite, immediate revocation and invalid token rejection", async () => {
    const i = await invitePrivateMember(admin, { email: buyer.email });
    const [event] =
      await sql`SELECT payload FROM outbox_events WHERE type='PrivateInvite' ORDER BY created_at DESC LIMIT 1`;
    const token = await symmetricDecrypt({
      key: env().SESSION_SECRET,
      data: event.payload.encryptedToken,
    });
    await expect(verifyPrivateInvite(other, { token })).rejects.toMatchObject({
      status: 404,
    });
    await verifyPrivateInvite(buyer, { token });
    await expect(verifyPrivateInvite(buyer, { token })).rejects.toMatchObject({
      status: 404,
    });
    expect(
      ((await privateCollections(buyer)) as unknown[]).length,
    ).toBeGreaterThan(0);
    await revokeMember(admin, {
      userId: buyer.id,
      reason: "DEMO — проверка немедленного отзыва доступа",
    });
    await expect(privateCollections(buyer)).rejects.toMatchObject({
      status: 404,
    });
    const [invite] =
      await sql`SELECT token_hash FROM private_invites WHERE id=${i.id}`;
    expect(invite.token_hash).not.toBe(token);
  });
  it("database enforces edition number and immutable audit", async () => {
    await expect(
      sql`INSERT INTO edition_copies(variant_id,number,print_year) VALUES(${demoId("variant1")},99,2026)`,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      sql`UPDATE audit_events SET action='tampered' WHERE subject_type='System'`,
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("additional security boundaries", () => {
  it("rejects executable disguised as image without saving media", async () => {
    const { uploadArtwork } = await import("../../src/modules/catalog/media");
    const [before] = await sql`SELECT count(*)::int AS n FROM artwork_media`;
    const bad = new File(['<svg onload="alert(1)"></svg>'], "image.png", {
      type: "image/png",
    });
    await expect(
      uploadArtwork(
        artist,
        demoId("work1"),
        bad,
        "Описание тестового файла",
        "DEMO Автор",
      ),
    ).rejects.toMatchObject({ code: "FILE_TYPE" });
    const [after] = await sql`SELECT count(*)::int AS n FROM artwork_media`;
    expect(after.n).toBe(before.n);
  });
  it("rejects expired invitations and tampered tokens", async () => {
    const token = crypto.randomUUID() + crypto.randomUUID();
    const hash = createHash("sha256").update(token).digest("hex");
    await sql`INSERT INTO private_invites(email,token_hash,expires_at,invited_by) VALUES(${buyer.email},${hash},now()-interval '1 second',${admin.id})`;
    await expect(verifyPrivateInvite(buyer, { token })).rejects.toMatchObject({
      code: "INVITE_INVALID",
    });
    await expect(
      verifyPrivateInvite(buyer, { token: token + "invalid" }),
    ).rejects.toMatchObject({ code: "INVITE_INVALID" });
  });
  it("requires a valid organization mandate and blocks conflicting exclusive claims", async () => {
    const { reviewMandate } = await import("../../src/modules/catalog/rights");
    const w = await createArtwork(artist, {
      title: "DEMO Integration mandate " + crypto.randomUUID(),
      seriesId: demoId("series1"),
      captureYear: 2026,
      description:
        "Демонстрационная работа для проверки границ представительства.",
      genre: "Абстракция",
      colorMode: "BW",
      visibility: "PUBLIC",
      technique: "Печать",
      paper: "Бумага",
      width: 100,
      height: 100,
      editionType: "LIMITED",
      editionTotal: 3,
      printYear: 2026,
      signed: true,
      rightsAccepted: true,
    });
    await sql`UPDATE artworks SET editorial_status='PUBLISHED' WHERE id=${w.id}`;
    const copies =
      await sql`SELECT c.id FROM edition_copies c JOIN edition_variants v ON v.id=c.variant_id WHERE v.artwork_id=${w.id} ORDER BY c.number`;
    const gallery = makeActor("gallery1", "GALLERY_MEMBER");
    const input = {
      copyId: copies[0].id,
      priceMode: "FIXED_PRICE",
      priceMinor: 100000,
      representativeOrgId: demoId("org1"),
      rightsEvidence: "DEMO — проверенное представительство по документам",
    };
    await expect(publishListing(gallery, input)).rejects.toMatchObject({
      code: "MANDATE_REQUIRED",
    });
    const period = {
      artistId: demoId("author1"),
      organizationId: demoId("org1"),
      artworkId: w.id,
      exclusive: true,
      startsAt: new Date(Date.now() - 1000).toISOString(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
      evidence: "DEMO — вручную проверенное полномочие организации",
    };
    await reviewMandate(admin, period);
    const l = await publishListing(gallery, input);
    expect(l.id).toBeTruthy();
    const conflict = await reviewMandate(admin, {
      ...period,
      organizationId: demoId("org2"),
    });
    expect(conflict.conflict).toBe(true);
    const [listing] = await sql`SELECT status FROM listings WHERE id=${l.id}`;
    expect(listing.status).toBe("ON_HOLD");
    await expect(
      publishListing(gallery, { ...input, copyId: copies[1].id }),
    ).rejects.toMatchObject({ code: "MANDATE_CONFLICT" });
  });
});

describe("editorial workflows", () => {
  it("creates separate AP stock, reviews series changes, preserves diffs and protects sold history", async () => {
    const { createSeries } = await import("../../src/modules/catalog/service");
    const { createVariant, editSeries, reviewSeries, reviseArtwork } =
      await import("../../src/modules/catalog/editing");
    const series = await createSeries(artist, {
      title: "DEMO Integration series " + crypto.randomUUID(),
      statement: "Исходное описание оригинальной демонстрационной серии.",
      yearStart: 2026,
    });
    const w = await createArtwork(artist, {
      title: "DEMO Integration revisions",
      seriesId: series.id,
      captureYear: 2026,
      description: "Первоначальное описание демонстрационного произведения.",
      genre: "Абстракция",
      colorMode: "BW",
      visibility: "PUBLIC",
      technique: "Печать",
      paper: "Бумага",
      width: 100,
      height: 100,
      editionType: "LIMITED",
      editionTotal: 3,
      printYear: 2026,
      signed: true,
      rightsAccepted: true,
    });
    const input = {
      technique: "Пигментная печать",
      paper: "Бумага",
      width: 200,
      height: 300,
      sheetWidth: 250,
      sheetHeight: 350,
      editionType: "LIMITED",
      editionTotal: 2,
      apTotal: 1,
      printYear: 2026,
      signed: true,
      condition: "NEW",
    };
    const variant = await createVariant(artist, w.id, input);
    const copies =
      await sql`SELECT proof_type,number FROM edition_copies WHERE variant_id=${variant.id}`;
    expect(copies).toHaveLength(3);
    expect(copies.filter((c) => c.proof_type === "AP")).toHaveLength(1);
    await expect(createVariant(other, w.id, input)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      createVariant(artist, w.id, {
        ...input,
        editionType: "OPEN",
        editionTotal: null,
        apTotal: 1,
      }),
    ).rejects.toThrow();
    await updateArtwork(artist, w.id, {
      title: "DEMO Integration revised",
      description: "Обновлённое описание демонстрационного произведения.",
      version: 1,
    });
    const [diff] =
      await sql`SELECT details FROM audit_events WHERE subject_id=${w.id} AND action='ARTWORK_EDITED'`;
    expect(diff.details.before.title).toBe("DEMO Integration revisions");
    expect(diff.details.after.title).toBe("DEMO Integration revised");
    await sql`UPDATE artworks SET editorial_status='PUBLISHED' WHERE id=${w.id}`;
    await editSeries(artist, series.id, {
      title: "DEMO Revised series",
      statement: "Описание изменено и требует мотивированной проверки.",
      yearStart: 2025,
    });
    const [pending] =
      await sql`SELECT title,pending_revision FROM series WHERE id=${series.id}`;
    expect(pending.title).not.toBe("DEMO Revised series");
    expect(pending.pending_revision.title).toBe("DEMO Revised series");
    await reviewSeries(admin, series.id, {
      approve: true,
      reason: "Демонстрационные изменения серии проверены модератором.",
    });
    await reviseArtwork(artist, w.id, {
      reason: "Нужна повторная редакция демонстрационного описания.",
    });
    await sql`UPDATE artworks SET editorial_status='PUBLISHED' WHERE id=${w.id}`;
    await sql`UPDATE edition_copies SET status='SOLD' WHERE variant_id=${variant.id} AND proof_type='AP'`;
    await expect(
      reviseArtwork(artist, w.id, {
        reason: "Попытка скрыть историю проданного экземпляра.",
      }),
    ).rejects.toMatchObject({ code: "ACTIVE_HISTORY" });
  });
  it("edits own submitted application before deadline without replacing receipt; rejects late or foreign edits", async () => {
    const { editApplication, createCall } =
      await import("../../src/modules/calls/service");
    const call = await createCall(admin, {
      title: "DEMO Editing call",
      organizerName: "DEMO редакция",
      sourceType: "VERSUS_HOSTED",
      sourceUrl: null,
      description: "Демонстрационный конкурс для редактирования заявки.",
      requirements: "Только собственные авторские произведения.",
      eligibility: "Демо",
      startsAt: new Date(Date.now() - 3600000).toISOString(),
      deadlineAt: new Date(Date.now() + 3600000).toISOString(),
      timezone: "Europe/Moscow",
      maxWorks: 5,
      feeMinor: 0,
      isDemo: true,
    });
    const input = {
      statement: "Первоначальный текст демонстрационной заявки на конкурс.",
      workIds: [demoId("work1")],
      rulesAccepted: true,
      dataConsent: true,
    };
    const a = await submitApplication(artist, call.id, input);
    const edited = await editApplication(artist, a.id, {
      ...input,
      statement: "Обновлённый текст демонстрационной заявки до дедлайна.",
    });
    expect(edited.receipt).toBe(a.receipt);
    await expect(editApplication(other, a.id, input)).rejects.toMatchObject({
      status: 404,
    });
    await sql`UPDATE open_calls SET deadline_at=now()-interval '1 second' WHERE id=${call.id}`;
    await expect(editApplication(artist, a.id, input)).rejects.toMatchObject({
      code: "APPLICATION_LOCKED",
    });
  });
});
