import { randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

export const stateDirectory =
  process.env.TAPPILOT_STATE_DIR ?? join(homedir(), "Library", "Application Support", "TapPilot");
const legacyTokenPath = join(stateDirectory, "device-token");
const registryPath = join(stateDirectory, "paired-devices.json");

export type PairedDevice = {
  id: string;
  label: string;
  platform: "phone" | "tablet" | "computer" | "unknown";
  route: "本机" | "Tailscale";
  createdAt: string;
  lastSeenAt: string;
};

type StoredDevice = PairedDevice & { token: string };
type Registry = { version: 1; devices: StoredDevice[] };
export type PairingDeviceInput = Pick<PairedDevice, "label" | "platform" | "route">;

function ensureStateDirectory(): void {
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
}

function writePrivate(path: string, value: string): void {
  ensureStateDirectory();
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, value, { mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function persistLegacyToken(token: string): string {
  writePrivate(legacyTokenPath, token);
  return token;
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function newPairingCode(): string {
  return String(randomInt(100_000, 1_000_000));
}

function loadLegacyToken(): string | null {
  try {
    const token = readFileSync(legacyTokenPath, "utf8").trim();
    return token.length >= 32 ? token : null;
  } catch {
    return null;
  }
}

function isStoredDevice(value: unknown): value is StoredDevice {
  if (!value || typeof value !== "object") return false;
  const device = value as Partial<StoredDevice>;
  return typeof device.id === "string" && typeof device.token === "string" && device.token.length >= 32
    && typeof device.label === "string" && typeof device.createdAt === "string" && typeof device.lastSeenAt === "string"
    && ["phone", "tablet", "computer", "unknown"].includes(String(device.platform))
    && ["本机", "Tailscale"].includes(String(device.route));
}

function loadRegistry(): Registry {
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8")) as Partial<Registry>;
    if (parsed.version === 1 && Array.isArray(parsed.devices) && parsed.devices.every(isStoredDevice)) {
      return { version: 1, devices: parsed.devices };
    }
  } catch {
    // First launch (or a malformed local file) falls back to a safe empty registry.
  }

  const legacyToken = loadLegacyToken();
  const registry: Registry = {
    version: 1,
    devices: legacyToken ? [{
      id: "legacy-device",
      token: legacyToken,
      label: "已配对的旧设备",
      platform: "unknown",
      route: "Tailscale",
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    }] : [],
  };
  // Do not write a migration at module import. It keeps read-only consumers
  // harmless; the first pairing, removal, or credential rotation persists it.
  return registry;
}

function writeRegistry(registry: Registry): void {
  writePrivate(registryPath, JSON.stringify(registry, null, 2));
}

let registry = loadRegistry();
export let pairingCode = newPairingCode();

export function rotatePairingCredentials(): string {
  // Keep the legacy file opaque for old installations, but never use it as a
  // valid cookie after rotation. New devices receive individually revocable tokens.
  persistLegacyToken(newToken());
  registry = { version: 1, devices: [] };
  writeRegistry(registry);
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

function withoutSecret(device: StoredDevice): PairedDevice {
  const { token: _token, ...publicDevice } = device;
  return publicDevice;
}

export function authenticatedDevice(request: IncomingMessage): PairedDevice | null {
  const token = cookieValue(request, "tappilot_device");
  if (!token) return null;
  const device = registry.devices.find((candidate) => secureEqual(candidate.token, token));
  return device ? withoutSecret(device) : null;
}

export function isAuthenticated(request: IncomingMessage): boolean {
  return authenticatedDevice(request) !== null;
}

function setDeviceCookie(response: ServerResponse, token: string): void {
  const secure = process.env.TAPPILOT_SECURE_COOKIE === "1" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `tappilot_device=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure}`,
  );
}

export function clearDeviceCookie(response: ServerResponse): void {
  const secure = process.env.TAPPILOT_SECURE_COOKIE === "1" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `tappilot_device=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

export function pair(code: string, response: ServerResponse, input: PairingDeviceInput = {
  label: "浏览器设备", platform: "unknown", route: "Tailscale",
}): boolean {
  if (!secureEqual(code, pairingCode)) return false;
  const now = new Date().toISOString();
  const token = newToken();
  const device: StoredDevice = {
    id: randomUUID(),
    token,
    label: input.label.slice(0, 80) || "浏览器设备",
    platform: input.platform,
    route: input.route,
    createdAt: now,
    lastSeenAt: now,
  };
  registry = { version: 1, devices: [...registry.devices, device] };
  writeRegistry(registry);
  setDeviceCookie(response, token);
  return true;
}

export function listPairedDevices(): PairedDevice[] {
  return registry.devices
    .map(withoutSecret)
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
}

export function removePairedDevice(id: string): boolean {
  const next = registry.devices.filter((device) => device.id !== id);
  if (next.length === registry.devices.length) return false;
  registry = { version: 1, devices: next };
  writeRegistry(registry);
  return true;
}

export function touchAuthenticatedDevice(request: IncomingMessage): PairedDevice | null {
  const token = cookieValue(request, "tappilot_device");
  if (!token) return null;
  const index = registry.devices.findIndex((candidate) => secureEqual(candidate.token, token));
  if (index < 0) return null;
  const existing = registry.devices[index];
  const now = new Date().toISOString();
  if (Date.parse(now) - Date.parse(existing.lastSeenAt) > 60_000) {
    const devices = [...registry.devices];
    devices[index] = { ...existing, lastSeenAt: now };
    registry = { version: 1, devices };
    writeRegistry(registry);
  }
  return withoutSecret(registry.devices[index]);
}
