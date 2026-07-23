import { describe, expect, it } from "vitest";
import { cleanGhosttyOutput, parseGhosttyTerminals } from "./ghosttyClient.js";

describe("Ghostty terminal parser", () => {
  it("keeps terminal metadata without treating terminal output as product data", () => {
    const separator = String.fromCharCode(31);
    expect(parseGhosttyTerminals(`abc${separator}项目终端${separator}/Users/me/project\nxyz${separator}${separator}`)).toEqual([
      { id: "abc", title: "项目终端", workingDirectory: "/Users/me/project" },
      { id: "xyz", title: "未命名终端", workingDirectory: "—" },
    ]);
  });

  it("ignores empty AppleScript rows", () => {
    expect(parseGhosttyTerminals("\n\n")).toEqual([]);
  });
});

describe("Ghostty output cleanup", () => {
  it("keeps normal terminal text while removing non-content terminal controls", () => {
    expect(cleanGhosttyOutput("\u001b[31mhello\u001b[0m\rworld\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007")).toBe("hello\nworldlink");
  });
});
