import { describe, expect, it } from "vitest";
import { threadState, threadTitle, uptimeText } from "./lib";
import type { CodexThread } from "./types";

function thread(overrides: Partial<CodexThread> = {}): CodexThread {
  return {
    id: "thread-1",
    name: null,
    preview: "第一行任务名称\n第二行",
    cwd: "/tmp/project",
    updatedAt: 1,
    status: { type: "idle" },
    turns: [],
    ...overrides,
  };
}

describe("thread presentation", () => {
  it("uses the explicit task name before its preview", () => {
    expect(threadTitle(thread({ name: "命名任务" }))).toBe("命名任务");
    expect(threadTitle(thread())).toBe("第一行任务名称");
  });

  it("keeps approvals ahead of the generic running state", () => {
    expect(threadState(thread({ status: { type: "active", activeFlags: ["waitingOnApproval"] } }))).toBe("waiting");
    expect(threadState(thread({ status: { type: "active", activeFlags: [] } }))).toBe("running");
  });

  it("maps interrupted and failed turns to clear states", () => {
    expect(threadState(thread({ turns: [{ id: "t", status: "interrupted", items: [], startedAt: 1, completedAt: 2, durationMs: 1 }] }))).toBe("stopped");
    expect(threadState(thread({ turns: [{ id: "t", status: "failed", items: [], startedAt: 1, completedAt: 2, durationMs: 1 }] }))).toBe("failed");
  });

  it("does not mistake an idle thread for a completed project", () => {
    expect(threadState(thread({ status: { type: "idle" } }))).toBe("ready");
  });
});

describe("uptime", () => {
  it("formats short and multi-day uptime", () => {
    expect(uptimeText(7200)).toBe("2 小时");
    expect(uptimeText(183600)).toBe("2 天 3 小时");
  });
});
