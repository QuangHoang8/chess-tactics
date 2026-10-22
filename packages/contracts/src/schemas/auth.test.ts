import { describe, expect, it } from "vitest";
import { loginRequestSchema, LoginRequestDto } from "./auth";

describe("loginRequestSchema", () => {
  it("accepts a valid login body", () => {
    const result = loginRequestSchema.safeParse({ email: "a@b.com", password: "secret" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed email", () => {
    const result = loginRequestSchema.safeParse({ email: "not-an-email", password: "secret" });
    expect(result.success).toBe(false);
  });

  it("exposes the schema statically on the generated DTO class", () => {
    expect(LoginRequestDto.schema).toBe(loginRequestSchema);
  });
});
