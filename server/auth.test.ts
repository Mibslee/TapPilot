import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  delete process.env.TAPPILOT_STATE_DIR;
  vi.resetModules();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("pairing credential rotation", () => {
  it("invalidates the previous code and every cookie issued from the old device token", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tappilot-auth-"));
    temporaryDirectories.push(directory);
    process.env.TAPPILOT_STATE_DIR = directory;
    const auth = await import("./auth.js");

    const oldCode = auth.pairingCode;
    let cookie = "";
    const response = {
      setHeader: (_name: string, value: string) => { cookie = value.split(";")[0]; },
    } as unknown as ServerResponse;

    expect(auth.pair(oldCode, response)).toBe(true);
    expect(auth.isAuthenticated({ headers: { cookie } } as IncomingMessage)).toBe(true);

    const newCode = auth.rotatePairingCredentials();
    expect(newCode).not.toBe(oldCode);
    expect(auth.pair(oldCode, response)).toBe(false);
    expect(auth.isAuthenticated({ headers: { cookie } } as IncomingMessage)).toBe(false);
  });

  it("issues revocable credentials per paired device without evicting another device", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tappilot-auth-"));
    temporaryDirectories.push(directory);
    process.env.TAPPILOT_STATE_DIR = directory;
    const auth = await import("./auth.js");
    const cookies: string[] = [];
    const response = {
      setHeader: (_name: string, value: string) => { cookies.push(value.split(";")[0]); },
    } as unknown as ServerResponse;

    expect(auth.pair(auth.pairingCode, response, { label: "iPhone · Safari", platform: "phone", route: "Tailscale" })).toBe(true);
    expect(auth.pair(auth.pairingCode, response, { label: "Mac · Safari", platform: "computer", route: "本机" })).toBe(true);
    const devices = auth.listPairedDevices();
    expect(devices).toHaveLength(2);
    expect(auth.isAuthenticated({ headers: { cookie: cookies[0] } } as IncomingMessage)).toBe(true);
    expect(auth.removePairedDevice(devices.find((device) => device.label.startsWith("iPhone"))!.id)).toBe(true);
    expect(auth.isAuthenticated({ headers: { cookie: cookies[0] } } as IncomingMessage)).toBe(false);
    expect(auth.isAuthenticated({ headers: { cookie: cookies[1] } } as IncomingMessage)).toBe(true);
  });
});
