/**
 * 이미지 파일 → 리사이즈/압축 base64 첨부.
 * Supabase Realtime broadcast 한도(~256KB) 아래로 맞춰야 하므로 축소 + JPEG 품질 조절.
 */
import type { ImageAttachment } from "@decku/shared";

const MAX_DIM = 1280; // 긴 변 최대 px (Claude가 어차피 다운샘플)
const TARGET_BYTES = 180_000; // base64 후 ~240KB → 한도 아래

export async function fileToAttachment(file: File): Promise<ImageAttachment> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 미지원");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  let quality = 0.8;
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  while (dataUrl.length * 0.75 > TARGET_BYTES && quality > 0.3) {
    quality -= 0.15;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  return { mediaType: "image/jpeg", dataBase64: dataUrl.split(",")[1] ?? "" };
}
