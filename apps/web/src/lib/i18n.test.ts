import { describe, expect, it } from "vitest";
import { detectLang, dictionaries, translate, translatePlural } from "./i18n";

describe("i18n", () => {
  it("detects language with ru fallback", () => {
    expect(detectLang("en")).toBe("en");
    expect(detectLang("en-GB")).toBe("en");
    expect(detectLang("ru")).toBe("ru");
    expect(detectLang("de")).toBe("ru");
    expect(detectLang(undefined)).toBe("ru");
  });
  it("has the same keys in both languages", () => {
    expect(Object.keys(dictionaries.en).sort()).toEqual(Object.keys(dictionaries.ru).sort());
  });
  it("interpolates", () => expect(translate("en", "homeHello", { name: "Ann" })).toBe("Hi, Ann!"));
  it("pluralizes ru", () => {
    expect(translatePlural("ru", "participants", 1)).toBe("1 участник");
    expect(translatePlural("ru", "participants", 3)).toBe("3 участника");
    expect(translatePlural("ru", "participants", 5)).toBe("5 участников");
    expect(translatePlural("ru", "participants", 21)).toBe("21 участник");
    expect(translatePlural("ru", "participants", 11)).toBe("11 участников");
  });
  it("pluralizes en", () => {
    expect(translatePlural("en", "participants", 1)).toBe("1 participant");
    expect(translatePlural("en", "participants", 2)).toBe("2 participants");
  });
});
