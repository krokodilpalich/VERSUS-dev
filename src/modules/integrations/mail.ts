import nodemailer from "nodemailer";
import { env } from "../config/env";
export async function sendMail(to: string, subject: string, text: string) {
  const e = env();
  if (e.MAIL_MODE !== "local")
    throw new Error(
      "Email disabled: configure an approved production adapter separately",
    );
  if (!["localhost", "127.0.0.1", "mailpit"].includes(e.SMTP_HOST))
    throw new Error("Local email mode only permits Mailpit");
  const transport = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: false,
  });
  await transport.sendMail({ from: e.MAIL_FROM, to, subject, text });
}
