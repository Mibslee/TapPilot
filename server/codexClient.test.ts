import { describe, expect, it, vi } from "vitest";
import { CodexClient } from "./codexClient.js";
import type { CodexThread } from "./types.js";

function thread(overrides: Partial<CodexThread> = {}): CodexThread {
  return {
    id: "thread-1",
    preview: "任务",
    name: null,
    cwd: "/tmp/project",
    createdAt: 1,
    updatedAt: 2,
    recencyAt: 2,
    status: { type: "idle" },
    turns: [],
    ...overrides,
  };
}

describe("CodexClient.sendMessage", () => {
  it("resumes a persisted thread before starting an image turn", async () => {
    const client = new CodexClient();
    vi.spyOn(client, "start").mockResolvedValue();
    const request = vi.spyOn(client, "request")
      .mockResolvedValueOnce({ thread: thread() })
      .mockResolvedValueOnce({ turn: { id: "turn-1" } });

    await client.sendMessage(thread(), "看这张图", ["/tmp/upload.png"]);

    expect(request).toHaveBeenNthCalledWith(1, "thread/resume", {
      threadId: "thread-1",
      approvalsReviewer: "user",
    }, 30_000);
    expect(request).toHaveBeenNthCalledWith(2, "turn/start", {
      threadId: "thread-1",
      input: [
        { type: "text", text: "看这张图", text_elements: [] },
        { type: "localImage", path: "/tmp/upload.png" },
      ],
      approvalsReviewer: "user",
    }, 30_000);
  });

  it("steers the active turn returned by resume", async () => {
    const active = thread({
      status: { type: "active", activeFlags: [] },
      turns: [{ id: "turn-active", status: "inProgress", startedAt: 1, completedAt: null, durationMs: null, items: [] }],
    });
    const client = new CodexClient();
    vi.spyOn(client, "start").mockResolvedValue();
    const request = vi.spyOn(client, "request")
      .mockResolvedValueOnce({ thread: active })
      .mockResolvedValueOnce({});

    await client.sendMessage(thread(), "补充说明");

    expect(request).toHaveBeenNthCalledWith(2, "turn/steer", {
      threadId: "thread-1",
      expectedTurnId: "turn-active",
      input: [{ type: "text", text: "补充说明", text_elements: [] }],
    });
  });

  it("subscribes an opened thread to phone approval callbacks", async () => {
    const client = new CodexClient();
    const request = vi.spyOn(client, "request").mockResolvedValueOnce({ thread: thread() });
    vi.spyOn(client, "start").mockResolvedValueOnce();

    await client.openThread("thread-1");

    expect(request).toHaveBeenCalledWith("thread/resume", {
      threadId: "thread-1",
      approvalsReviewer: "user",
    }, 30_000);
  });

  it("resumes an opened thread only once", async () => {
    const client = new CodexClient();
    vi.spyOn(client, "start").mockResolvedValue();
    const request = vi.spyOn(client, "request")
      .mockResolvedValueOnce({ thread: thread() })
      .mockResolvedValueOnce({ thread: thread() });

    await client.openThread("thread-1");
    await client.openThread("thread-1");

    expect(request).toHaveBeenNthCalledWith(1, "thread/resume", {
      threadId: "thread-1",
      approvalsReviewer: "user",
    }, 30_000);
    expect(request).toHaveBeenNthCalledWith(2, "thread/read", {
      threadId: "thread-1",
      includeTurns: true,
    }, 30_000);
  });

  it("deduplicates approval cards and resolves every repeated callback", () => {
    const client = new CodexClient();
    const write = vi.spyOn(client as unknown as { write: (payload: unknown) => void }, "write")
      .mockImplementation(() => undefined);
    const params = { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", command: "touch test" };

    (client as unknown as { handleLine: (line: string) => void }).handleLine(JSON.stringify({
      id: 101,
      method: "item/commandExecution/requestApproval",
      params,
    }));
    (client as unknown as { handleLine: (line: string) => void }).handleLine(JSON.stringify({
      id: 102,
      method: "item/commandExecution/requestApproval",
      params,
    }));

    const approvals = client.listApprovals();
    expect(approvals).toHaveLength(1);
    client.resolveApproval(approvals[0].key, "accept");
    expect(write).toHaveBeenCalledWith({ id: 101, result: { decision: "accept" } });
    expect(write).toHaveBeenCalledWith({ id: 102, result: { decision: "accept" } });
    expect(client.listApprovals()).toHaveLength(0);
  });

  it("returns granted permissions and session scope for the current Codex permission protocol", () => {
    const client = new CodexClient();
    const write = vi.spyOn(client as unknown as { write: (payload: unknown) => void }, "write")
      .mockImplementation(() => undefined);

    (client as unknown as { handleLine: (line: string) => void }).handleLine(JSON.stringify({
      id: 201,
      method: "item/permissions/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-permission-1",
        permissions: {
          fileSystem: { read: ["/Users/test/Documents"], write: [] },
          network: null,
        },
      },
    }));

    const approval = client.listApprovals()[0];
    client.resolveApproval(approval.key, "acceptForSession");

    expect(write).toHaveBeenCalledWith({
      id: 201,
      result: {
        permissions: { fileSystem: { read: ["/Users/test/Documents"], write: [] } },
        scope: "session",
      },
    });
    expect(client.listApprovals()).toHaveLength(0);
  });
});
