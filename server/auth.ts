import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export const stateDirectory =
  process.env.TAPPILOT_STATE_DIR ?? join(homedir(), "Library", "Application Support", "TapPilot");
const tokenPath = join(stateDirectory, "device-token");

function persistToken(token: string): string {
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  writeFileSync(tokenPath, token, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
  return token;
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function newPairingCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

function loadOrCreateToken(): string {
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  try {
    const token = readFileSync(tokenPath, "utf8").trim();
    if (token.length >= 32) return token;
  } catch {
    // First launch creates the local device credential below.
  }
  return persistToken(newToken());
}

let deviceToken = loadOrCreateToken();
export let pairingCode = newPairingCode();

export function rotatePairingCredentials(): string {
  deviceToken = persistToken(newToken());
  const previousCode = pairingCode;
  do pairingCode = newPairingCode(); while (pairingCode === previousCode);
  return pairingCode;
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cookieValue(request: IncomingMessage, name: string): string | null {
  const cookie = request.headers.cookie ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function isAuthenticated(request: IncomingMessage): boolean {
  const token = cookieValue(request, "tappilot_device");
  return token !== null && secureEqual(token, deviceToken);
}

export function pair(code: string, response: ServerResponse): boolean {
  if (!secureEqual(code, pairingCode)) return false;
  const secure = process.env.TAPPILOT_SECURE_COOKIE === "1" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `tappilot_device=${encodeURIComponent(deviceToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure}`,
  );
  return true;
}
