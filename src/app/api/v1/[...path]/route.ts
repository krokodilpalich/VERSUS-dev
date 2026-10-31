import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getActor,
  DomainError,
  requireThat,
  signed,
  staff,
  type Actor,
} from "@/modules/auth/policy";
import { sql, audit } from "@/modules/db";
import { rateLimit } from "@/modules/db/helpers";
import * as editing from "@/modules/catalog/editing";
import * as catalog from "@/modules/catalog/service";
import * as commerce from "@/modules/commerce/service";
import * as calls from "@/modules/calls/service";
import * as circle from "@/modules/private/service";
import * as content from "@/modules/content/service";
import { reviewMandate } from "@/modules/catalog/rights";
import { uploadArtwork } from "@/modules/catalog/media";
export const dynamic = "force-dynamic";
const json = (data: unknown, requestId: string) =>
  NextResponse.json(
    { data, requestId },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    },
  );
async function adminList(actor: Actor | null, key: string) {
  const roles: Record<string, string[]> = {
    artworks: ["MODERATOR"],
    listings: ["OPERATIONS"],
    inquiries: ["OPERATIONS"],
    deals: ["OPERATIONS"],
    "open-calls": ["EDITOR", "OPERATIONS"],
    applications: ["CURATOR", "OPERATIONS"],
    editorial: ["EDITOR"],
    events: ["EDITOR"],
    verification: ["OPERATIONS"],
    organizations: ["OPERATIONS"],
    invitations: [],
    users: [],
    audit: [],
    "commission-policies": ["OPERATIONS"],
    settings: [],
  };
  requireThat(Object.hasOwn(roles, key), 404, "NOT_FOUND", "Раздел не найден");
  staff(actor, ...roles[key]);
  switch (key) {
    case "artworks":
      return sql`SELECT w.id,w.title,w.editorial_status,w.visibility,w.version,a.name AS artist_name,(SELECT id FROM artwork_media WHERE artwork_id=w.id LIMIT 1) AS media_id FROM artworks w JOIN artists a ON a.id=w.artist_id ORDER BY w.updated_at DESC LIMIT 100`;
    case "listings":
      return sql`SELECT id,price_mode,price_minor::float8,status,rights_evidence FROM listings ORDER BY created_at DESC LIMIT 100`;
    case "inquiries":
      return commerce.myInquiries(actor);
    case "deals":
      return sql`SELECT id,status,amount_minor::float8,commission_snapshot,created_at FROM deals ORDER BY created_at DESC LIMIT 100`;
    case "open-calls":
      return sql`SELECT * FROM open_calls ORDER BY deadline_at DESC LIMIT 100`;
    case "applications":
      return sql`SELECT a.id,a.status,a.receipt,a.statement,c.title FROM applications a JOIN open_calls c ON c.id=a.open_call_id ORDER BY a.submitted_at DESC LIMIT 100`;
    case "editorial":
    case "events":
      return sql`SELECT id,type,title,slug,status,visibility,body,excerpt FROM content ORDER BY updated_at DESC LIMIT 100`;
    case "verification":
      return sql`SELECT id,subject_type,subject_id,status,created_at FROM verification_requests ORDER BY created_at DESC LIMIT 100`;
    case "organizations":
      return sql`SELECT id,name,type,verification_status FROM organizations LIMIT 100`;
    case "invitations":
      return sql`SELECT u.id,u.name,m.status FROM private_memberships m JOIN "user" u ON u.id=m.user_id ORDER BY m.updated_at DESC LIMIT 100`;
    case "users":
      return sql`SELECT u.id,u.name,u.email,u.email_verified,u.two_factor_enabled,coalesce(array_agg(r.role) FILTER(WHERE r.role IS NOT NULL),'{}') AS roles FROM "user" u LEFT JOIN user_roles r ON r.user_id=u.id GROUP BY u.id ORDER BY u.created_at DESC LIMIT 100`;
    case "audit":
      return sql`SELECT id,subject_type,subject_id,action,at FROM audit_events ORDER BY at DESC LIMIT 100`;
    case "commission-policies":
      return sql`SELECT * FROM commission_policies ORDER BY created_at DESC`;
    case "settings":
      return [{ payments: "disabled", auctions: false, checkout: false }];
  }
}
async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const requestId = crypto.randomUUID();
  try {
    const parts = (await params).path;
    const path = parts.join("/"),
      method = req.method,
      actor = await getActor(req.headers);
    const id = (n: number) => catalog.idSchema.parse(parts[n]);
    if (method !== "GET") {
      requireThat(
        req.headers.get("origin") === new URL(process.env.APP_URL!).origin,
        403,
        "CSRF",
        "Недопустимый источник запроса",
      );
      signed(actor);
      await rateLimit(`mutation:${actor.id}`, 60);
      requireThat(
        Number(req.headers.get("content-length") ?? 0) <= 16 * 1024 * 1024,
        413,
        "TOO_LARGE",
        "Запрос слишком большой",
      );
    }
    if (method === "GET") {
      if (path === "admin/export") {
        staff(actor);
        const rows =
          await sql`SELECT action,count(*)::int AS total FROM audit_events GROUP BY action ORDER BY action`;
        return new NextResponse(
          "action,total\n" +
            rows.map((r) => r.action + "," + r.total).join("\n"),
          {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition":
                'attachment; filename="versus-metrics.csv"',
              "Cache-Control": "no-store",
            },
          },
        );
      }

      if (path === "me")
        return json(
          actor
            ? {
                id: actor.id,
                name: actor.name,
                roles: actor.roles,
                mfa: actor.mfa,
              }
            : null,
          requestId,
        );
      if (path === "artworks")
        return json(
          await catalog.publicCatalog(req.nextUrl.searchParams),
          requestId,
        );
      if (parts[0] === "artworks" && parts.length === 2)
        return json(await catalog.workDossier(parts[1], actor), requestId);
      if (path === "open-calls")
        return json(
          await sql`SELECT id,title,slug,source_type,description,deadline_at,timezone,is_demo FROM open_calls WHERE status='PUBLISHED' ORDER BY deadline_at`,
          requestId,
        );
      if (path === "me/inquiries")
        return json(await commerce.myInquiries(actor), requestId);
      if (parts[0] === "inquiries" && parts.length === 2)
        return json(await commerce.inquiryDetail(actor, id(1)), requestId);
      if (path === "me/applications")
        return json(await calls.applications(actor), requestId);
      if (path === "me/portfolio") {
        signed(actor);
        const works =
          await sql`SELECT w.* FROM artworks w JOIN artists a ON a.id=w.artist_id WHERE a.user_id=${actor.id} ORDER BY w.created_at DESC`;
        const series =
          await sql`SELECT s.* FROM series s JOIN artists a ON a.id=s.artist_id WHERE a.user_id=${actor.id}`;
        const copies =
          await sql`SELECT c.id,c.number,c.status,v.edition_total,w.title FROM edition_copies c JOIN edition_variants v ON v.id=c.variant_id JOIN artworks w ON w.id=v.artwork_id JOIN artists a ON a.id=w.artist_id WHERE a.user_id=${actor.id}`;
        return json({ works, series, copies }, requestId);
      }
      if (path === "commission-policies") {
        signed(actor);
        return json(
          await sql`SELECT id,name,version,basis_points,is_demo FROM commission_policies WHERE status='ACTIVE'`,
          requestId,
        );
      }
      if (path === "private/collections")
        return json(await circle.privateCollections(actor), requestId);
      if (
        parts[0] === "private" &&
        parts[1] === "collections" &&
        parts.length === 3
      )
        return json(await circle.privateCollections(actor, id(2)), requestId);
      if (parts[0] === "admin" && parts.length === 2)
        return json(await adminList(actor, parts[1]), requestId);
      throw new DomainError(404, "NOT_FOUND", "Маршрут не найден");
    }
    if (method === "POST" && parts[0] === "artworks" && parts[2] === "media") {
      const form = await req.formData(),
        file = form.get("file");
      requireThat(file instanceof File, 422, "FILE_REQUIRED", "Выберите файл");
      return json(
        await uploadArtwork(
          actor,
          id(1),
          file,
          String(form.get("alt") ?? ""),
          String(form.get("rightsHolder") ?? ""),
        ),
        requestId,
      );
    }
    const body = await req.json().catch(() => {
      throw new DomainError(422, "JSON_INVALID", "Некорректный JSON");
    });
    const key = req.headers.get("idempotency-key") ?? undefined;
    let result: unknown;
    if (method === "POST") {
      if (path === "onboarding") result = await content.onboard(actor, body);
      else if (path === "privacy")
        result = await content.savePrivacy(actor, body);
      else if (path === "artists")
        result = await catalog.saveArtist(actor, body);
      else if (path === "series")
        result = await catalog.createSeries(actor, body);
      else if (path === "artworks")
        result = await catalog.createArtwork(actor, body);
      else if (parts[0] === "artworks" && parts[2] === "submit")
        result = await catalog.submitArtwork(actor, id(1));
      else if (parts[0] === "artworks" && parts[2] === "edit")
        result = await catalog.updateArtwork(actor, id(1), body);
      else if (
        parts[0] === "admin" &&
        parts[1] === "artworks" &&
        parts[3] === "moderate"
      )
        result = await catalog.moderateArtwork(actor, id(2), body);
      else if (
        parts[0] === "admin" &&
        parts[1] === "artists" &&
        parts[3] === "review"
      )
        result = await catalog.reviewArtistProfile(actor, id(2), body);
      else if (parts[0] === "series" && parts[2] === "edit")
        result = await editing.editSeries(actor, id(1), body);
      else if (
        parts[0] === "admin" &&
        parts[1] === "series" &&
        parts[3] === "review"
      )
        result = await editing.reviewSeries(actor, id(2), body);
      else if (parts[0] === "artworks" && parts[2] === "variants")
        result = await editing.createVariant(actor, id(1), body);
      else if (parts[0] === "artworks" && parts[2] === "revise")
        result = await editing.reviseArtwork(actor, id(1), body);
      else if (parts[0] === "applications" && parts[2] === "edit")
        result = await calls.editApplication(actor, id(1), body);
      else if (path === "listings")
        result = await catalog.publishListing(actor, body);
      else if (path === "inquiries")
        result = await commerce.createInquiry(actor, body);
      else if (parts[0] === "inquiries" && parts[2] === "messages")
        result = await commerce.replyInquiry(actor, id(1), body);
      else if (parts[0] === "inquiries" && parts[2] === "offers")
        result = await commerce.createOffer(actor, id(1), body);
      else if (path === "reservations")
        result = await commerce.createReservation(actor, body, key);
      else if (parts[0] === "offers" && parts[2] === "accept")
        result = await commerce.acceptOffer(actor, id(1), key);
      else if (parts[0] === "deals" && parts[2] === "request-completion")
        result = await commerce.requestCompletion(actor, id(1), body);
      else if (
        parts[0] === "admin" &&
        parts[1] === "deals" &&
        parts[3] === "confirm-offline"
      )
        result = await commerce.confirmOfflineCompletion(actor, id(2), body);
      else if (
        parts[0] === "admin" &&
        parts[1] === "open-calls" &&
        parts.length === 3
      )
        result = await calls.editCall(actor, id(2), body);
      else if (path === "admin/open-calls")
        result = await calls.createCall(actor, body);
      else if (parts[0] === "open-calls" && parts[2] === "applications")
        result = await calls.submitApplication(actor, id(1), body);
      else if (parts[0] === "applications" && parts[2] === "withdraw")
        result = await calls.withdrawApplication(actor, id(1));
      else if (
        parts[0] === "admin" &&
        parts[1] === "applications" &&
        parts[3] === "review"
      )
        result = await calls.reviewApplication(actor, id(2), body);
      else if (path === "admin/invitations")
        result = await circle.invitePrivateMember(actor, body);
      else if (path === "private/invites/accept")
        result = await circle.verifyPrivateInvite(actor, body);
      else if (path === "admin/memberships/revoke")
        result = await circle.revokeMember(actor, body);
      else if (path === "admin/collections")
        result = await circle.createCollection(actor, body);
      else if (path === "admin/editorial")
        result = await content.saveContent(actor, body);
      else if (
        parts[0] === "admin" &&
        parts[1] === "editorial" &&
        parts.length === 3
      )
        result = await content.saveContent(actor, body, id(2));
      else if (parts[0] === "events" && parts[2] === "rsvp")
        result = await content.rsvp(actor, id(1));
      else if (path === "favorites")
        result = await content.saveFavorite(actor, body);
      else if (path === "admin/mandates")
        result = await reviewMandate(actor, body);
      else if (path === "organizations")
        result = await content.createOrganization(actor, body);
      else if (
        parts[0] === "admin" &&
        parts[1] === "verification" &&
        parts.length === 3
      )
        result = await content.reviewVerification(actor, id(2), body);
      else if (path === "admin/roles")
        result = await content.assignRole(actor, body);
      else if (path === "admin/commission-policies") {
        staff(actor);
        const d = z
          .object({
            name: z.string().min(3).max(100),
            version: z.number().int().positive(),
            basisPoints: z.number().int().min(0).max(10000),
            isDemo: z.boolean(),
          })
          .strict()
          .parse(body);
        result = await sql.begin(async (tx) => {
          const [row] =
            await tx`INSERT INTO commission_policies(name,version,basis_points,is_demo,status) VALUES(${d.name},${d.version},${d.basisPoints},${d.isDemo},'ACTIVE') RETURNING id`;
          await audit(
            tx,
            actor.id,
            "CommissionPolicy",
            row.id,
            "POLICY_CREATED",
          );
          return row;
        });
      } else if (path === "notifications/read") {
        signed(actor);
        await sql`UPDATE notifications SET read_at=now() WHERE recipient_id=${actor.id}`;
        result = { saved: true };
      } else throw new DomainError(404, "NOT_FOUND", "Маршрут не найден");
    } else
      throw new DomainError(
        405,
        "METHOD_NOT_ALLOWED",
        "Метод не поддерживается",
      );
    return json(result, requestId);
  } catch (error) {
    let status = 500,
      code = "INTERNAL_ERROR",
      message = "Не удалось выполнить операцию";
    if (error instanceof DomainError) {
      ({ status, code } = error);
      message = error.message;
    } else if (error instanceof z.ZodError) {
      status = 422;
      code = "VALIDATION_ERROR";
      message = error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } else if ((error as { code?: string }).code === "23505") {
      status = 409;
      code = "CONFLICT";
      message = "Запись уже существует или состояние изменилось";
    } else
      console.error(
        JSON.stringify({
          requestId,
          event: "api_error",
          type: error instanceof Error ? error.name : "Unknown",
        }),
      );
    return NextResponse.json(
      { error: { code, message, requestId } },
      {
        status,
        headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
      },
    );
  }
}
export const GET = handle;
export const POST = handle;
