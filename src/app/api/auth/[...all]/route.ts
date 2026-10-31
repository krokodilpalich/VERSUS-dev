import { auth } from "@/modules/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { sql } from "@/modules/db";
const handlers = toNextJsHandler(auth);
export const GET = handlers.GET;
export async function POST(request: Request) {
  const signup = new URL(request.url).pathname.endsWith("/sign-up/email");
  if (signup) {
    const body = await request
      .clone()
      .json()
      .catch(() => null);
    if (body?.consentsAccepted !== true)
      return Response.json(
        {
          message:
            "Подтвердите согласие на обработку данных и ознакомление с условиями",
        },
        { status: 422 },
      );
  }
  const response = await handlers.POST(request);
  if (signup && response.ok) {
    const body = await response.clone().json();
    if (body.user?.id)
      await sql`INSERT INTO user_consents(user_id,type,version) VALUES(${body.user.id},'TERMS_AND_PRIVACY','draft-1') ON CONFLICT DO NOTHING`;
  }
  return response;
}
