import { NextRequest, NextResponse } from "next/server";
import { getActor, DomainError, requireThat } from "@/modules/auth/policy";
import { sql } from "@/modules/db";
import { visibleArtwork, idSchema } from "@/modules/catalog/service";
import { get } from "@/modules/integrations/storage";
import { env } from "@/modules/config/env";
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const id = idSchema.parse((await params).id),
      actor = await getActor(req.headers);
    const [m] =
      await sql`SELECT artwork_id,derivative_key,thumbnail_key FROM artwork_media WHERE id=${id}`;
    requireThat(m, 404, "NOT_FOUND", "Изображение не найдено");
    await visibleArtwork(m.artwork_id, actor);
    const data = await get(
      env().S3_BUCKET_PUBLIC,
      req.nextUrl.searchParams.get("size") === "small"
        ? m.thumbnail_key
        : m.derivative_key,
    );
    return new NextResponse(Buffer.from(data), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return new NextResponse("Изображение недоступно", {
      status: error instanceof DomainError ? error.status : 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
