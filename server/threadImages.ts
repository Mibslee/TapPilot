import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { CodexItem, CodexThread } from "./types.js";

const MAX_THREAD_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_TTL_MS = 60 * 60 * 1000;

export interface ThreadImage {
  mime: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  size: number;
  path?: string;
  data?: Buffer;
}

export interface WebImageReference {
  url: string;
  alt: string;
}

type StoredImage = ThreadImage & { touchedAt: number };
const images = new Map<string, StoredImage>();

function mimeForPath(path: string): ThreadImage["mime"] | null {
  const extension = extname(path).toLowerCase();
  if ([".jpg", ".jpeg"].includes(extension)) return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return null;
}

function cleanup(): void {
  const cutoff = Date.now() - IMAGE_TTL_MS;
  for (const [id, image] of images) if (image.touchedAt < cutoff) images.delete(id);
}

function registerPath(path: string): WebImageReference | null {
  try {
    if (!path.startsWith("/") || !existsSync(path) || lstatSync(path).isSymbolicLink()) return null;
    accessSync(path, constants.R_OK);
    const stats = statSync(path);
    const mime = mimeForPath(path);
    if (!stats.isFile() || !mime || stats.size <= 0 || stats.size > MAX_THREAD_IMAGE_BYTES) return null;
    const id = createHash("sha256").update(`${path}\0${stats.size}\0${stats.mtimeMs}`).digest("hex").slice(0, 32);
    images.set(id, { path, mime, size: stats.size, touchedAt: Date.now() });
    return { url: `/api/thread-images/${id}`, alt: "对话图片" };
  } catch {
    return null;
  }
}

function registerBase64(value: string, mime: ThreadImage["mime"]): WebImageReference | null {
  try {
    const encoded = value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
    const data = Buffer.from(encoded, "base64");
    if (!data.length || data.length > MAX_THREAD_IMAGE_BYTES) return null;
    const id = createHash("sha256").update(mime).update(data).digest("hex").slice(0, 32);
    images.set(id, { data, mime, size: data.length, touchedAt: Date.now() });
    return { url: `/api/thread-images/${id}`, alt: "对话图片" };
  } catch {
    return null;
  }
}

function markdownImages(text: string): { text: string; images: WebImageReference[] } {
  const found: WebImageReference[] = [];
  const cleaned = text.replace(/!\[([^\]]*)\]\((?:<)?(\/[^)\n>]+)(?:>)?\)/g, (source, alt: string, path: string) => {
    const image = registerPath(path.trim());
    if (!image) return source;
    found.push({ ...image, alt: alt.trim() || image.alt });
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned, images: found };
}

/**
 * The Codex desktop host can prepend attachment paths and its ambient browser
 * context to a user message before the actual request. Those fields are host
 * metadata, not conversation content, and the desktop surface hides them.
 * Keep the phone timeline aligned with that surface while retaining the
 * original Codex thread unchanged.
 */
function displayUserText(text: string): string {
  const requestMarker = "## My request for Codex:";
  const markerIndex = text.indexOf(requestMarker);
  if (markerIndex < 0) return text;

  const prefix = text.slice(0, markerIndex);
  const hasAmbientContext = prefix.includes('<in-app-browser-context source="ambient-ui-state">');
  const hasFileMetadata = prefix.includes("# Files mentioned by the user:");
  if (!hasAmbientContext && !hasFileMetadata) return text;

  return text.slice(markerIndex + requestMarker.length).replace(/^\s+/, "");
}

function sanitizeItem(item: CodexItem): void {
  const references: WebImageReference[] = [];
  if (item.type === "userMessage" && Array.isArray(item.content)) {
    item.content = item.content.map((part) => {
      if (!part || typeof part !== "object") return part;
      if (part.type === "localImage" && typeof part.path === "string") {
        const image = registerPath(part.path);
        if (image) references.push(image);
        return image ? { type: "image", ...image } : { type: "image", alt: "图片暂不可用" };
      }
      if (part.type === "text" && typeof part.text === "string") {
        return { ...part, text: displayUserText(part.text) };
      }
      return part;
    });
  }

  if (item.type === "agentMessage" && typeof item.text === "string") {
    const extracted = markdownImages(item.text);
    item.text = extracted.text;
    references.push(...extracted.images);
  }

  if (item.type === "imageGeneration") {
    const pathImage = typeof item.savedPath === "string" ? registerPath(item.savedPath) : null;
    const generated = pathImage ?? (typeof item.result === "string" && item.result
      ? registerBase64(item.result, "image/png")
      : null);
    if (generated) references.push({ ...generated, alt: "Codex 生成的图片" });
    delete item.result;
    delete item.savedPath;
  }

  if ((item.type === "mcpToolCall" || item.type === "dynamicToolCall") && item.result && typeof item.result === "object") {
    const result = item.result as { content?: Array<Record<string, unknown>> };
    if (Array.isArray(result.content)) {
      result.content = result.content.map((content) => {
        if (content.type !== "image" || typeof content.data !== "string") return content;
        const mime = content.mimeType === "image/jpeg" || content.mimeType === "image/webp" || content.mimeType === "image/gif"
          ? content.mimeType : "image/png";
        const image = registerBase64(content.data, mime);
        const { data: _data, ...metadata } = content;
        return image ? { ...metadata, ...image } : metadata;
      });
    }
  }

  if (references.length) item.images = references;
}

export function prepareThreadForWeb(thread: CodexThread): CodexThread {
  cleanup();
  for (const turn of thread.turns ?? []) for (const item of turn.items ?? []) sanitizeItem(item);
  return thread;
}

export function getThreadImage(id: string): ThreadImage | null {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const image = images.get(id);
  if (!image) return null;
  if (image.path && !existsSync(image.path)) {
    images.delete(id);
    return null;
  }
  image.touchedAt = Date.now();
  if (image.data) return { data: image.data, mime: image.mime, size: image.size };
  if (image.path) return { path: image.path, mime: image.mime, size: image.size };
  return null;
}

export async function readThreadImage(id: string): Promise<ThreadImage | null> {
  const image = getThreadImage(id);
  if (!image) return null;
  if (image.data) return image;
  if (!image.path) return null;
  try {
    const data = await readFile(image.path);
    if (!data.length || data.length > MAX_THREAD_IMAGE_BYTES) {
      images.delete(id);
      return null;
    }
    return { data, mime: image.mime, size: data.length };
  } catch {
    // macOS may allow stat but deny opening a protected or expired temporary file.
    // Treat it as an unavailable image instead of emitting an unhandled stream error.
    images.delete(id);
    return null;
  }
}
