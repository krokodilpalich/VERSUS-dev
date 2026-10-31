import { auth } from "./index";
import { sql } from "../db";
export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireThat(
  condition: unknown,
  status: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new DomainError(status, code, message);
}
export const staffRoles = [
  "MODERATOR",
  "CURATOR",
  "EDITOR",
  "OPERATIONS",
  "ADMIN",
  "SUPERADMIN",
];
export type Actor = {
  id: string;
  email: string;
  name: string;
  verified: boolean;
  mfa: boolean;
  roles: string[];
};
export async function getActor(headers: Headers): Promise<Actor | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const roles = await sql<
    { role: string }[]
  >`SELECT role FROM user_roles WHERE user_id=${session.user.id}`;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    verified: session.user.emailVerified,
    mfa: session.user.twoFactorEnabled ?? false,
    roles: roles.map((r) => r.role),
  };
}
export function signed(actor: Actor | null): asserts actor is Actor {
  requireThat(actor, 401, "UNAUTHENTICATED", "Войдите в аккаунт");
  requireThat(actor.verified, 403, "EMAIL_UNVERIFIED", "Подтвердите email");
}
export function hasRole(actor: Actor | null, ...roles: string[]) {
  return !!actor && actor.roles.some((r) => roles.includes(r));
}
export function staff(
  actor: Actor | null,
  ...roles: string[]
): asserts actor is Actor {
  signed(actor);
  requireThat(
    hasRole(actor, ...roles, "ADMIN", "SUPERADMIN"),
    403,
    "FORBIDDEN",
    "Недостаточно прав",
  );
  requireThat(
    actor.mfa,
    403,
    "MFA_REQUIRED",
    "Сначала включите двухфакторную защиту в настройках",
  );
}
export function isStaff(actor: Actor | null) {
  return !!actor && actor.mfa && hasRole(actor, ...staffRoles);
}
export function isOperator(actor: Actor | null) {
  return (
    !!actor && actor.mfa && hasRole(actor, "OPERATIONS", "ADMIN", "SUPERADMIN")
  );
}
export function slug(title: string) {
  return (
    title
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90) +
    "-" +
    crypto.randomUUID().slice(0, 8)
  );
}
