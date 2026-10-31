import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { artworkInput, artistInput } from "../src/modules/catalog/service";
import { callInput } from "../src/modules/calls/service";
import { contentInput } from "../src/modules/content/service";
import { sql, ormSql } from "../src/modules/db";
const definitions: [string, string, string, string?][] = [
  ["get", "/artworks", "Public published catalog"],
  ["get", "/artworks/{id}", "Permission checked work dossier"],
  ["post", "/artworks", "Create owned draft", "ArtworkInput"],
  ["post", "/artists", "Save or submit artist profile", "ArtistInput"],
  ["post", "/series", "Create owned series"],
  ["post", "/artworks/{id}/submit", "Submit draft with media"],
  ["post", "/artworks/{id}/media", "Authenticated multipart image upload"],
  ["post", "/admin/artworks/{id}/moderate", "Staff moderation with reason"],
  ["post", "/listings", "Publish a physical copy with rights verification"],
  ["get", "/open-calls", "Public call directory"],
  ["post", "/admin/open-calls", "Create internal/external call", "CallInput"],
  [
    "post",
    "/open-calls/{id}/applications",
    "Owned works, server deadline and consent",
  ],
  ["get", "/me/applications", "Own submissions"],
  ["post", "/inquiries", "Create private inquiry"],
  ["get", "/me/inquiries", "Only participant/operator records"],
  ["get", "/inquiries/{id}", "Private messages and offers"],
  ["post", "/inquiries/{id}/messages", "Participant reply"],
  [
    "post",
    "/inquiries/{id}/offers",
    "Seller/operator offer with immutable commission snapshot",
  ],
  ["post", "/reservations", "Atomic, idempotent reservation"],
  ["post", "/offers/{id}/accept", "Accept and reserve in one transaction"],
  [
    "post",
    "/deals/{id}/request-completion",
    "Seller/operator documents offline result",
  ],
  [
    "post",
    "/admin/deals/{id}/confirm-offline",
    "OPERATIONS verifies offline evidence",
  ],
  ["post", "/admin/invitations", "Queue address-bound private invite"],
  ["post", "/private/invites/accept", "Single use, verified email invite"],
  ["get", "/private/collections", "Live membership check"],
  ["get", "/private/collections/{id}", "Private works; no-store"],
  ["post", "/admin/memberships/revoke", "Immediate revocation"],
  ["post", "/admin/collections", "Create public/private collection"],
  ["post", "/admin/editorial", "CMS create", "ContentInput"],
  ["post", "/admin/editorial/{id}", "CMS update", "ContentInput"],
  ["post", "/events/{id}/rsvp", "Request participation"],
  ["post", "/organizations", "Organization verification request"],
  ["post", "/admin/mandates", "Staff-reviewed representation rights"],
  ["post", "/favorites", "Private saved items"],
  ["post", "/onboarding", "Select professional roles only"],
  ["post", "/privacy", "Private defaults"],
  ["get", "/admin/audit", "PII-redacted recent audit"],
  ["post", "/admin/commission-policies", "New immutable policy version"],
  ["post", "/admin/roles", "MFA required before staff assignment"],
];
definitions.push(
  ["post", "/series/{id}/edit", "Edit own series; public edits require review"],
  ["post", "/admin/series/{id}/review", "Moderate public series revision"],
  ["post", "/artworks/{id}/variants", "Create edition variant and AP copies"],
  [
    "post",
    "/artworks/{id}/revise",
    "Unpublish available work for a reviewed revision",
  ],
  [
    "post",
    "/applications/{id}/edit",
    "Edit own submitted application before deadline",
  ],
  ["post", "/admin/open-calls/{id}", "Update or archive call with reason"],
  ["get", "/admin/export", "PII-free audit aggregate CSV"],
);
const paths: Record<string, Record<string, unknown>> = {};
for (const [method, path, summary, body] of definitions) {
  const parameters: unknown[] = [];
  if (path.includes("{id}"))
    parameters.push({
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string", format: "uuid" },
    });
  if (["/reservations", "/offers/{id}/accept"].includes(path))
    parameters.push({
      in: "header",
      name: "Idempotency-Key",
      required: true,
      schema: { type: "string", minLength: 8, maxLength: 128 },
    });
  const operation: Record<string, unknown> = {
    summary,
    parameters,
    responses: {
      "200": {
        description: "Success envelope",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/Success" },
          },
        },
      },
      "401": { description: "Authentication required" },
      "403": { description: "Denied policy or CSRF" },
      "404": { description: "Missing or invisible" },
      "409": { description: "State, deadline, rights or inventory conflict" },
      "422": { description: "Zod validation error" },
      "429": { description: "Rate limited" },
    },
  };
  if (method === "post") {
    operation.security = [{ session: [] }];
    operation.requestBody = {
      required: true,
      content: {
        [path.endsWith("/media") ? "multipart/form-data" : "application/json"]:
          {
            schema: body
              ? { $ref: `#/components/schemas/${body}` }
              : {
                  type: "object",
                  description:
                    "See strict Zod input in the corresponding service module.",
                },
          },
      },
    };
  }
  paths[path] ??= {};
  paths[path][method] = operation;
}
const schemas = {
  ArtworkInput: z.toJSONSchema(artworkInput, { io: "input" }),
  ArtistInput: z.toJSONSchema(artistInput, { io: "input" }),
  CallInput: z.toJSONSchema(callInput, { io: "input" }),
  ContentInput: z.toJSONSchema(contentInput, { io: "input" }),
  Success: {
    type: "object",
    required: ["data", "requestId"],
    properties: { data: {}, requestId: { type: "string", format: "uuid" } },
  },
};
const document = {
  openapi: "3.1.0",
  info: { title: "VERSUS P0 API", version: "0.1.0" },
  servers: [{ url: "/api/v1" }],
  paths,
  components: {
    securitySchemes: {
      session: {
        type: "apiKey",
        in: "cookie",
        name: "better-auth.session_token",
      },
    },
    schemas,
  },
};
await writeFile("API_SPEC.yaml", JSON.stringify(document, null, 2) + "\n");
await sql.end();
await ormSql.end();
console.log("Generated OpenAPI 3.1 (JSON is valid YAML 1.2).");
