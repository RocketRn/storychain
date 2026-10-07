import { describe, expect, it } from "vitest";
import { signInitData, validateInitData, InitDataError } from "./initData";

const TOKEN = "123456:abc";
const user = { id: 42, first_name: "Ann", username: "ann", language_code: "ru", is_premium: true };

describe("validateInitData", () => {
  it("accepts a correctly signed payload", () => {
    const raw = signInitData(user, TOKEN, { startParam: "chain_abc12345" });
    const d = validateInitData(raw, TOKEN);
    expect(d.user.id).toBe(42);
    expect(d.user.is_premium).toBe(true);
    expect(d.startParam).toBe("chain_abc12345");
  });

  it("rejects a wrong bot token", () => {
    expect(() => validateInitData(signInitData(user, TOKEN), "999:other")).toThrow(InitDataError);
  });

  it("rejects tampered user data", () => {
    const params = new URLSearchParams(signInitData(user, TOKEN));
    params.set("user", JSON.stringify({ ...user, id: 43 }));
    expect(() => validateInitData(params.toString(), TOKEN)).toThrow("bad hash");
  });

  it("rejects extra/removed fields and a missing hash", () => {
    const params = new URLSearchParams(signInitData(user, TOKEN));
    params.set("start_param", "x");
    expect(() => validateInitData(params.toString(), TOKEN)).toThrow("bad hash");
    params.delete("hash");
    expect(() => validateInitData(params.toString(), TOKEN)).toThrow("missing hash");
  });

  it("rejects expired auth_date", () => {
    const old = Math.floor(Date.now() / 1000) - 7200;
    expect(() => validateInitData(signInitData(user, TOKEN, { authDate: old }), TOKEN)).toThrow(
      "expired",
    );
    // but passes with a larger window
    expect(
      validateInitData(signInitData(user, TOKEN, { authDate: old }), TOKEN, 86400).user.id,
    ).toBe(42);
  });

  it("rejects empty input", () => {
    expect(() => validateInitData("", TOKEN)).toThrow(InitDataError);
  });
});
