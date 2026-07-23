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
});
