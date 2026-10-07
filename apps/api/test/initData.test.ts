import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InitDataError, signInitData, validateInitData, type TgUser } from "../src/auth/initData";

const TOKEN = "123456789:AAH_FAKE_fixture_not_a_real_bot_token_0123456789";
const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const nowSec = NOW / 1000;
const user: TgUser = { id: 777, first_name: "Ann", username: "ann", language_code: "ru" };

/** Independent re-implementation of Telegram's algorithm, so the tests do not just mirror the code under test. */
function sign(fields: Array<[string, string]>, token = TOKEN): string {
  const check = [...fields]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`);
  const key = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", key).update(check.join("\n")).digest("hex");
  const qs = new URLSearchParams();
  for (const [k, v] of fields) qs.append(k, v);
  qs.append("hash", hash);
  return qs.toString();
}
const base = (over: Partial<Record<string, string>> = {}): Array<[string, string]> => {
  const f: Record<string, string> = {
    auth_date: String(nowSec - 10),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify(user),
    ...over,
  };
  return Object.entries(f).filter(([, v]) => v !== undefined) as Array<[string, string]>;
};
const reject = (raw: string, re: RegExp, maxAge = 3600) => {
  const run = () => validateInitData(raw, TOKEN, maxAge, NOW);
  expect(run).toThrow(InitDataError);
  expect(run).toThrow(re);
};

describe("validateInitData", () => {
  it("accepts correctly signed data, independent of parameter order", () => {
    const fields = base({ start_param: "chain_abc12345" });
    const a = validateInitData(sign(fields), TOKEN, 3600, NOW);
    const b = validateInitData(sign([...fields].reverse()), TOKEN, 3600, NOW);
    expect(a).toEqual(b);
    expect(a.user).toEqual(user);
    expect(a.startParam).toBe("chain_abc12345");
    expect(a.authDate).toBe(nowSec - 10);
  });

  it("agrees with signInitData (the helper used by tests and the dev endpoint)", () => {
    const raw = signInitData(user, TOKEN, { authDate: nowSec - 5, startParam: "x" });
    expect(validateInitData(raw, TOKEN, 3600, NOW).user.id).toBe(777);
  });

  it("keeps unknown fields in the signed string (Telegram adds fields such as `signature`)", () => {
    const raw = sign([...base(), ["signature", "dGVzdA"], ["future_field", "1"]]);
    expect(validateInitData(raw, TOKEN, 3600, NOW).user.id).toBe(777);
    // ...and dropping one after signing breaks the hash
    const stripped = new URLSearchParams(raw);
    stripped.delete("future_field");
    reject(stripped.toString(), /bad hash/);
  });

  it("rejects a different bot token", () => {
    reject(sign(base(), "987654321:AAH_FAKE_other_fixture_not_a_real_bot_token_012"), /bad hash/);
  });

  it("rejects any tampering after signing", () => {
    const qs = new URLSearchParams(sign(base()));
    // swap the user for someone else (privilege escalation / impersonation attempt)
    const swapped = new URLSearchParams(qs);
    swapped.set("user", JSON.stringify({ ...user, id: 1 }));
    reject(swapped.toString(), /bad hash/);
    // refresh the auth date to dodge expiry
    const fresh = new URLSearchParams(qs);
    fresh.set("auth_date", String(nowSec));
    reject(fresh.toString(), /bad hash/);
    // smuggle a second `user` after the signature
    reject(
      `${qs.toString()}&user=${encodeURIComponent(JSON.stringify({ ...user, id: 1 }))}`,
      /bad hash/,
    );
  });

  it("rejects a missing or malformed hash", () => {
    const qs = new URLSearchParams(sign(base()));
    const hash = qs.get("hash") as string;
    const without = new URLSearchParams(qs);
    without.delete("hash");
    reject(without.toString(), /missing hash/);
    for (const bad of ["", "zz".repeat(32), hash.slice(0, 62), `${hash}00`, "0".repeat(64)]) {
      const q = new URLSearchParams(qs);
      q.set("hash", bad);
      expect(() => validateInitData(q.toString(), TOKEN, 3600, NOW), bad).toThrow(InitDataError);
    }
    const upper = new URLSearchParams(qs);
    upper.set("hash", hash.toUpperCase());
    expect(validateInitData(upper.toString(), TOKEN, 3600, NOW).user.id).toBe(777);
  });

  it("rejects empty input and an empty bot token", () => {
    expect(() => validateInitData("", TOKEN)).toThrow(/missing initData/);
    expect(() => validateInitData(sign(base()), "", 3600, NOW)).toThrow(/missing initData/);
  });

  it("enforces the age window (inclusive) and rejects dates from the future", () => {
    const at = (age: number) => sign(base({ auth_date: String(nowSec - age) }));
    expect(validateInitData(at(3600), TOKEN, 3600, NOW).user.id).toBe(777); // exactly at the limit
    reject(at(3601), /expired/);
    expect(validateInitData(at(-60), TOKEN, 3600, NOW).user.id).toBe(777); // small clock skew is fine
    reject(at(-61), /future/);
    expect(validateInitData(at(86_400), TOKEN, 86_400, NOW).user.id).toBe(777);
  });

  it("rejects missing or non-numeric auth_date", () => {
    reject(sign(base({ auth_date: "" })), /auth_date/);
    reject(sign(base({ auth_date: "yesterday" })), /auth_date/);
    reject(sign(base({ auth_date: "0" })), /auth_date/);
    reject(sign(base({ auth_date: "-5" })), /auth_date/);
    reject(sign(base({ auth_date: "NaN" })), /auth_date/);
    reject(sign(base({ auth_date: "Infinity" })), /auth_date/);
    reject(sign(base().filter(([k]) => k !== "auth_date")), /auth_date/);
  });

  it("rejects a validly signed payload whose user is missing, not JSON, or the wrong shape", () => {
    reject(sign(base().filter(([k]) => k !== "user")), /bad user/);
    reject(sign(base({ user: "{not json" })), /bad user/);
    reject(sign(base({ user: JSON.stringify({ id: "777", first_name: "A" }) })), /bad user/);
    reject(sign(base({ user: JSON.stringify({ id: 1.5, first_name: "A" }) })), /bad user/);
    reject(sign(base({ user: JSON.stringify({ id: 1 }) })), /bad user/);
    reject(sign(base({ user: JSON.stringify([user]) })), /bad user/);
    reject(sign(base({ user: "null" })), /bad user/);
  });
});
