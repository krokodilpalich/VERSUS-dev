import { z } from "zod";
import { sql, audit, type Tx } from "../db";
import { staff, requireThat, type Actor } from "../auth/policy";
import { idSchema } from "./service";
export async function reviewMandate(actor: Actor | null, input: unknown) {
  staff(actor, "OPERATIONS");
  const d = z
    .object({
      artistId: idSchema,
      organizationId: idSchema,
      artworkId: idSchema.nullable(),
      exclusive: z.boolean(),
      startsAt: z.iso.datetime({ offset: true }),
      endsAt: z.iso.datetime({ offset: true }),
      evidence: z.string().min(20).max(3000),
    })
    .strict()
    .parse(input);
  requireThat(
    new Date(d.endsAt) > new Date(d.startsAt),
    422,
    "INVALID_PERIOD",
    "Неверный срок мандата",
  );
  return sql.begin(async (tx) => {
    const [artist] =
      await tx`SELECT id FROM artists WHERE id=${d.artistId} FOR UPDATE`;
    requireThat(artist, 404, "NOT_FOUND", "Автор не найден");
    const [org] =
      await tx`SELECT id FROM organizations WHERE id=${d.organizationId} AND verification_status='APPROVED'`;
    requireThat(
      org,
      422,
      "ORG_UNVERIFIED",
      "Организация должна пройти верификацию",
    );
    if (d.artworkId) {
      const [w] =
        await tx`SELECT id FROM artworks WHERE id=${d.artworkId} AND artist_id=${d.artistId}`;
      requireThat(
        w,
        422,
        "ARTIST_MISMATCH",
        "Работа принадлежит другому автору",
      );
    }
    const [r] =
      await tx`INSERT INTO representation_mandates(artist_id,organization_id,artwork_id,exclusive,starts_at,ends_at,evidence,status) VALUES(${d.artistId},${d.organizationId},${d.artworkId},${d.exclusive},${d.startsAt},${d.endsAt},${d.evidence},'APPROVED') RETURNING id`;
    const conflicts =
      await tx`SELECT id FROM representation_mandates WHERE artist_id=${d.artistId} AND exclusive AND status='APPROVED' AND organization_id!=${d.organizationId} AND starts_at<${d.endsAt} AND ends_at>${d.startsAt} AND (artwork_id IS NULL OR ${d.artworkId}::uuid IS NULL OR artwork_id=${d.artworkId})`;
    if (d.exclusive && conflicts.length)
      await tx`UPDATE listings SET status='ON_HOLD' WHERE edition_variant_id IN (SELECT v.id FROM edition_variants v JOIN artworks w ON w.id=v.artwork_id WHERE w.artist_id=${d.artistId} AND (${d.artworkId}::uuid IS NULL OR w.id=${d.artworkId})) AND status='PUBLISHED'`;
    await audit(tx, actor.id, "Mandate", r.id, "MANDATE_REVIEWED", {
      exclusive: d.exclusive,
      conflict: !!conflicts.length,
    });
    return { id: r.id, conflict: !!conflicts.length };
  });
}
export async function checkListingRights(
  tx: Tx,
  listing: {
    representative_org_id: string | null;
    artwork_id: string;
    artist_id: string;
    author_id: string;
    seller_id: string;
  },
) {
  await tx`SELECT id FROM artists WHERE id=${listing.artist_id} FOR SHARE`;
  const mandates =
    await tx`SELECT organization_id,exclusive FROM representation_mandates WHERE artist_id=${listing.artist_id} AND (artwork_id IS NULL OR artwork_id=${listing.artwork_id}) AND scope='SALE' AND geography='RU' AND status='APPROVED' AND starts_at<=now() AND ends_at>now()`;
  const exclusive = mandates.filter((m) => m.exclusive);
  requireThat(
    new Set(exclusive.map((m) => m.organization_id)).size <= 1,
    409,
    "MANDATE_CONFLICT",
    "Спорный мандат: предложение на проверке",
  );
  if (listing.representative_org_id) {
    requireThat(
      mandates.some((m) => m.organization_id === listing.representative_org_id),
      409,
      "MANDATE_EXPIRED",
      "Представительство требует проверки",
    );
    const [m] =
      await tx`SELECT id FROM organization_members WHERE organization_id=${listing.representative_org_id} AND user_id=${listing.seller_id} AND invitation_status='ACCEPTED' AND role IN ('OWNER','MANAGER','SALES','CATALOG_EDITOR')`;
    requireThat(
      m,
      409,
      "REPRESENTATIVE_REVOKED",
      "Полномочия представителя отозваны",
    );
  } else
    requireThat(
      listing.seller_id === listing.author_id && exclusive.length === 0,
      409,
      "MANDATE_REQUIRED",
      "Обратитесь к действующему представителю",
    );
}
