import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("Bridge API error wording", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a transient GET failure before succeeding", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, paired: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = api.health();
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ ok: true, paired: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("replaces a persistent browser failure with reconnect state wording", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const result = api.health();
    const assertion = expect(result).rejects.toThrow("与 Mac 的连接短暂中断，正在自动重连…");
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry POST requests that might already have been accepted", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.pair("123456")).rejects.toThrow("与 Mac 的连接短暂中断，正在自动重连…");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
