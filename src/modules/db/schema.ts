import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  integer,
  bigint,
} from "drizzle-orm/pg-core";
const dates = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...dates,
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
});
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ...dates,
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
});
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  ...dates,
});
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ...dates,
});
export const twoFactor = pgTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id),
  verified: boolean("verified"),
  failedVerificationCount: integer("failed_verification_count")
    .notNull()
    .default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});
export const artists = pgTable("artists", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").references(() => user.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  biography: text("biography").notNull().default(""),
  statement: text("statement").notNull().default(""),
  city: text("city").notNull().default(""),
  verificationStatus: text("verification_status")
    .notNull()
    .default("UNVERIFIED"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
export const artworks = pgTable("artworks", {
  id: uuid("id").primaryKey().defaultRandom(),
  artistId: uuid("artist_id")
    .notNull()
    .references(() => artists.id),
  title: text("title").notNull(),
  slug: text("slug").notNull().unique(),
  captureYear: integer("capture_year").notNull(),
  description: text("description").notNull(),
  editorialStatus: text("editorial_status").notNull().default("DRAFT"),
  visibility: text("visibility").notNull().default("PUBLIC"),
  version: integer("version").notNull().default(1),
});
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});
