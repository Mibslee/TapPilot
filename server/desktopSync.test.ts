import { describe, expect, it } from "vitest";
import { codexThreadUrl } from "./desktopSync.js";

describe("desktop thread sync", () => {
  it("builds the Codex desktop deep link for a thread", () => {
    expect(codexThreadUrl("019f88b0-0d19-7792-a02a-7c63ea7a53ff"))
      .toBe("codex://threads/019f88b0-0d19-7792-a02a-7c63ea7a53ff");
  });

  it("rejects values that are not thread ids", () => {
    expect(() => codexThreadUrl("../../settings")).toThrow("任务 ID 无效");
  });
});
