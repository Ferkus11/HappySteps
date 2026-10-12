import { describe, expect, it } from "vitest";
import { formatPhone, maskPhone, normalizePhone, phoneToAuthEmail, whatsappLink } from "@/lib/phone";

describe("phone", () => {
  it("normalizes KZ numbers", () => {
    expect(normalizePhone("+7 (701) 123-45-67")).toBe("+77011234567");
    expect(normalizePhone("87011234567")).toBe("+77011234567");
    expect(normalizePhone("7011234567")).toBe("+77011234567");
    expect(normalizePhone("+7 (701) 123")).toBeNull();
  });
  it("masks progressively", () => {
    expect(maskPhone("7")).toBe("+7");
    expect(maskPhone("+7701")).toBe("+7 (701)");
    expect(maskPhone("77011234567")).toBe("+7 (701) 123-45-67");
    expect(formatPhone("+77011234567")).toBe("+7 (701) 123-45-67");
  });
  it("builds technical email and whatsapp link", () => {
    expect(phoneToAuthEmail("+77011234567", "users.x.kz")).toBe("77011234567@users.x.kz");
    expect(whatsappLink("+77011234567", "Привет")).toBe("https://wa.me/77011234567?text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82");
  });
});
