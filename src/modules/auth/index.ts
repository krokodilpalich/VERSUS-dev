import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { hash, verify } from "@node-rs/argon2";
import { db } from "../db";
import * as schema from "../db/schema";
import { sendMail } from "../integrations/mail";
export const auth = betterAuth({
  appName: "VERSUS",
  logger: {
    level: "warn",
    log: (level) =>
      console.error(JSON.stringify({ event: "auth_provider", level })),
  },
  baseURL: process.env.APP_URL,
  secret: process.env.SESSION_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    password: {
      hash: async (p) =>
        hash(p, { memoryCost: 19456, timeCost: 2, parallelism: 1 }),
      verify: async ({ hash: h, password }) => verify(h, password),
    },
    sendResetPassword: async ({ user, url }) =>
      sendMail(
        user.email,
        "VERSUS — сброс пароля",
        `Ссылка для сброса пароля: ${url}\nЕсли вы не запрашивали сброс, проигнорируйте письмо.`,
      ),
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) =>
      sendMail(
        user.email,
        "VERSUS — подтвердите email",
        `Подтвердите email: ${url}`,
      ),
  },
  advanced: {
    database: { generateId: "uuid" },
    useSecureCookies: process.env.APP_URL?.startsWith("https:") ?? false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60,
    cookieCache: { enabled: false },
  },
  trustedOrigins: [process.env.APP_URL ?? "http://localhost:3000"],
  rateLimit: { enabled: true, window: 60, max: 30, storage: "database" },
  plugins: [twoFactor({ issuer: "VERSUS", allowPasswordless: false })],
});
