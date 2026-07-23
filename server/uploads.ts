import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stateDirectory } from "./auth.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES_PER_MESSAGE = 4;
const RETENTION_MS = 24 * 60 * 60 * 1_000;
const uploadDirectory = join(stateDirectory, "uploads");

const imageTypes = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
} as const;

type SupportedImageType = keyof typeof imageTypes;

export interface StoredImage {
  id: string;
  name: string;
  mime: SupportedImageType;
  size: number;
}

function ensureUploadDirectory(): void {
  mkdirSync(uploadDirectory, { recursive: true, mode: 0o700 });
  chmodSync(uploadDirectory, 0o700);
}

export function detectImageType(buffer: Buffer): SupportedImageType | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

export function isUploadId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function storedPath(id: string): string | null {
  if (!isUploadId(id)) return null;
  for (const extension of Object.values(imageTypes)) {
    const candidate = join(uploadDirectory, `${id}${extension}`);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function storeImage(buffer: Buffer, declaredType: string, originalName: string): StoredImage {
  if (!buffer.length) throw new Error("图片内容为空");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("单张图片不能超过 8 MB");
  const detectedType = detectImageType(buffer);
  if (!detectedType) throw new Error("仅支持 PNG、JPEG 和 WebP 图片");
  if (declaredType && declaredType !== "application/octet-stream" && declaredType !== detectedType) {
    throw new Error("图片格式与文件内容不一致");
  }

  ensureUploadDirectory();
  const id = randomUUID();
  const path = join(uploadDirectory, `${id}${imageTypes[detectedType]}`);
  writeFileSync(path, buffer, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  const name = originalName.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || `图片${imageTypes[detectedType]}`;
  return { id, name, mime: detectedType, size: buffer.length };
}

export function resolveImages(ids: string[]): string[] {
  if (ids.length > MAX_IMAGES_PER_MESSAGE) throw new Error("每次最多发送 4 张图片");
  return ids.map((id) => {
    const path = storedPath(id);
    if (!path) throw new Error("图片附件已失效，请重新选择");
    return path;
  });
}

export function deleteImage(id: string): boolean {
  const path = storedPath(id);
  if (!path) return false;
  unlinkSync(path);
  return true;
}

export function cleanupStaleImages(now = Date.now()): number {
  ensureUploadDirectory();
  let removed = 0;
  for (const filename of readdirSync(uploadDirectory)) {
    if (!/^[0-9a-f-]+\.(?:jpg|png|webp)$/i.test(filename)) continue;
    const path = join(uploadDirectory, filename);
    try {
      if (now - statSync(path).mtimeMs > RETENTION_MS) {
        unlinkSync(path);
        removed += 1;
      }
    } catch {
      // A concurrent delete is already a successful cleanup outcome.
    }
  }
  return removed;
}

export function verifyStoredImage(path: string): boolean {
  return detectImageType(readFileSync(path)) !== null;
}
