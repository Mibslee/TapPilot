import { describe, expect, it } from "vitest";
import { detectImageType, isUploadId } from "./uploads.js";

describe("image upload validation", () => {
  it("recognizes supported image signatures", () => {
    expect(detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
    expect(detectImageType(Buffer.from("RIFFxxxxWEBP", "ascii"))).toBe("image/webp");
    expect(detectImageType(Buffer.from("not an image"))).toBeNull();
  });

  it("accepts only generated UUID upload ids", () => {
    expect(isUploadId("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
    expect(isUploadId("../../private/file")).toBe(false);
  });
});
