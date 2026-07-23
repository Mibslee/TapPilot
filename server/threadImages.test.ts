import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getThreadImage, prepareThreadForWeb, readThreadImage } from "./threadImages.js";
import type { CodexThread } from "./types.js";

const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function threadWith(items: Array<Record<string, unknown>>): CodexThread {
  return {
    id: "thread-1",
    preview: "测试",
    name: null,
    cwd: "/tmp",
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    status: { type: "idle" },
    turns: [{ id: "turn-1", status: "completed", startedAt: 1, completedAt: 2, durationMs: 1, items: items.map((item) => ({ type: String(item.type), ...item })) }],
  };
}

describe("thread image bridge", () => {
  it("converts local, markdown, generated and embedded images to authenticated URLs", () => {
    const directory = mkdtempSync(join(tmpdir(), "tappilot-image-test-"));
    const path = join(directory, "image.png");
    writeFileSync(path, onePixelPng);
    const thread = threadWith([
      { type: "userMessage", content: [{ type: "text", text: "看图" }, { type: "localImage", path }] },
      { type: "agentMessage", text: `结果\n![预览](${path})` },
      { type: "imageGeneration", status: "completed", result: onePixelPng.toString("base64") },
      { type: "mcpToolCall", result: { content: [{ type: "image", data: onePixelPng.toString("base64"), mimeType: "image/png" }] } },
    ]);

    prepareThreadForWeb(thread);
    const [user, agent, generated, tool] = thread.turns[0].items;
    expect((user.content as Array<Record<string, unknown>>)[1]).toMatchObject({ type: "image", url: expect.stringMatching(/^\/api\/thread-images\//) });
    expect(agent.text).toBe("结果");
    expect(agent.images).toHaveLength(1);
    expect(generated.result).toBeUndefined();
    expect(generated.images).toHaveLength(1);
    expect((tool.result as { content: Array<Record<string, unknown>> }).content[0].data).toBeUndefined();

    const generatedImages = generated.images as Array<{ url: string }>;
    const id = String(generatedImages[0].url.split("/").at(-1));
    expect(getThreadImage(id)?.size).toBe(onePixelPng.length);
  });

  it("returns an unavailable image without crashing when macOS denies a registered path", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tappilot-protected-image-test-"));
    const path = join(directory, "protected.png");
    writeFileSync(path, onePixelPng, { mode: 0o600 });
    const thread = threadWith([{ type: "userMessage", content: [{ type: "localImage", path }] }]);
    prepareThreadForWeb(thread);
    const content = thread.turns[0].items[0].content as Array<Record<string, unknown>>;
    const id = String(String(content[0].url).split("/").at(-1));

    chmodSync(path, 0o000);
    try {
      expect(await readThreadImage(id)).toBeNull();
    } finally {
      chmodSync(path, 0o600);
    }
  });

  it("removes Codex host metadata from the mobile user-message display", () => {
    const thread = threadWith([{
      type: "userMessage",
      content: [{
        type: "text",
        text: `## 截屏2026-07-23 09.05.57.png:\n/private/var/folders/example/screenshot.png\n\n<in-app-browser-context source="ambient-ui-state">\nThis block is automatically supplied ambient UI state.\n</in-app-browser-context>\n\n## My request for Codex:\n测试过程中，移动端还是经常报这个错误`,
      }],
    }]);

    prepareThreadForWeb(thread);
    const content = thread.turns[0].items[0].content as Array<Record<string, unknown>>;
    expect(content[0].text).toBe("测试过程中，移动端还是经常报这个错误");
  });

  it("keeps ordinary user Markdown that does not contain host metadata", () => {
    const thread = threadWith([{
      type: "userMessage",
      content: [{ type: "text", text: "## My request for Codex:\n这是我自己写的标题" }],
    }]);

    prepareThreadForWeb(thread);
    const content = thread.turns[0].items[0].content as Array<Record<string, unknown>>;
    expect(content[0].text).toBe("## My request for Codex:\n这是我自己写的标题");
  });
});
