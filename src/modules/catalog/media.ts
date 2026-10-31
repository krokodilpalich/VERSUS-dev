import sharp from "sharp";
import { sql, audit } from "../db";
import { env } from "../config/env";
import { signed, requireThat, type Actor } from "../auth/policy";
import { ownedWork } from "./service";
import { put } from "../integrations/storage";
export function sniffImage(data: Buffer) {
  if (
    data.length > 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  )
    return "image/jpeg";
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    data.subarray(0, 4).toString() === "RIFF" &&
    data.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return null;
}
export async function uploadArtwork(
  actor: Actor | null,
  id: string,
  file: File,
  alt: string,
  rightsHolder: string,
) {
  signed(actor);
  requireThat(
    env().DEMO_MODE === "true",
    503,
    "SCANNER_REQUIRED",
    "Production upload требует настроенного антивирусного сканера",
  );
  requireThat(
    file.size > 0 && file.size <= 15 * 1024 * 1024,
    422,
    "FILE_SIZE",
    "Изображение должно быть не больше 15 МБ",
  );
  requireThat(
    alt.length >= 5 &&
      alt.length <= 300 &&
      rightsHolder.length >= 2 &&
      rightsHolder.length <= 150,
    422,
    "METADATA_REQUIRED",
    "Укажите alt и правообладателя",
  );
  const input = Buffer.from(await file.arrayBuffer());
  const mime = sniffImage(input);
  requireThat(
    mime && mime === file.type,
    422,
    "FILE_TYPE",
    "Разрешены только настоящие JPEG, PNG и WebP",
  );
  let full: Buffer, thumb: Buffer;
  try {
    const image = sharp(input, {
      limitInputPixels: 40_000_000,
      failOn: "error",
    }).rotate();
    full = await image
      .clone()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    thumb = await image
      .clone()
      .resize(640, 640, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    requireThat(
      false,
      422,
      "IMAGE_INVALID",
      "Изображение повреждено или превышает лимит пикселей",
    );
  }
  const mediaId = crypto.randomUUID(),
    e = env();
  return sql.begin(async (tx) => {
    const w = await ownedWork(tx, actor, id);
    requireThat(
      ["DRAFT", "NEEDS_CHANGES", "REJECTED"].includes(w.editorial_status),
      409,
      "STATE_CONFLICT",
      "Сначала верните работу в черновик",
    );
    const [count] =
      await tx`SELECT count(*)::int AS count FROM artwork_media WHERE artwork_id=${id}`;
    requireThat(
      count.count < 10,
      422,
      "MEDIA_LIMIT",
      "Не более 10 изображений",
    );
    const original = `${id}/${mediaId}/original`,
      key = `${id}/${mediaId}/1600.webp`,
      thumbnail = `${id}/${mediaId}/640.webp`;
    await put(e.S3_BUCKET_PRIVATE, original, input, mime);
    await put(e.S3_BUCKET_PUBLIC, key, full, "image/webp");
    await put(e.S3_BUCKET_PUBLIC, thumbnail, thumb, "image/webp");
    await tx`INSERT INTO artwork_media(id,artwork_id,storage_key_original,derivative_key,thumbnail_key,alt_text,rights_holder,mime_type,sort_order) VALUES(${mediaId},${id},${original},${key},${thumbnail},${alt},${rightsHolder},${mime},${count.count})`;
    await audit(tx, actor.id, "Media", mediaId, "MEDIA_UPLOADED");
    return { id: mediaId };
  });
}
