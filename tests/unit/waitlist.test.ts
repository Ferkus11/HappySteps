import { describe, expect, it } from "vitest";
import { applicationSchema, birthDateOk, desiredDateOk, shortName, statusesOf, publicApplicationSchema } from "@/lib/waitlist";

describe("waitlist helpers", () => {
  it("tabs map to statuses («Ожидают» = new + contacted)", () => {
    expect(statusesOf("waiting")).toEqual(["new", "contacted"]);
    expect(statusesOf("accepted")).toEqual(["accepted"]);
    expect(statusesOf("all")).toHaveLength(4);
  });

  it("birth date: in the past, kindergarten age (≤ 8 years)", () => {
    expect(birthDateOk("2022-05-01", "2026-10-12")).toBe(true);
    expect(birthDateOk("2026-10-12", "2026-10-12")).toBe(true);
    expect(birthDateOk("2026-10-13", "2026-10-12")).toBe(false);
    expect(birthDateOk("2018-10-11", "2026-10-12")).toBe(false);
    expect(birthDateOk("2022-02-30x", "2026-10-12")).toBe(false);
  });

  it("desired date: optional, at most 3 years ahead", () => {
    expect(desiredDateOk(null, "2026-10-12")).toBe(true);
    expect(desiredDateOk("2027-09-01", "2026-10-12")).toBe(true);
    expect(desiredDateOk("2062-09-01", "2026-10-12")).toBe(false);
  });

  it("short parent name for lists", () => {
    expect(shortName("Нурланова Жанар Сериковна")).toBe("Нурланова Ж.");
    expect(shortName("Асем")).toBe("Асем");
  });

  it("validates and normalises an application", () => {
    const r = applicationSchema("2026-10-12").safeParse({
      childName: "  Нурланов Арман ",
      childBirthDate: "2022-04-12",
      parentName: "Нурланова Жанар",
      parentPhone: "+7 (701) 111-00-01",
      desiredDate: "",
      comment: "  ",
    });
    expect(r.success && r.data).toEqual({
      childName: "Нурланов Арман",
      childBirthDate: "2022-04-12",
      parentName: "Нурланова Жанар",
      parentPhone: "+77011110001",
      desiredDate: null,
      comment: null,
    });
    const bad = applicationSchema("2026-10-12").safeParse({ childName: "А", childBirthDate: "2040-01-01", parentName: "", parentPhone: "123" });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => i.path[0]).sort()).toEqual(["childBirthDate", "childName", "parentName", "parentPhone"]);
  });

  it("the public form carries the honeypot field", () => {
    expect(publicApplicationSchema("2026-10-12").shape.website).toBeDefined();
  });

  it("date limits follow the garden's «today» (its time zone), not a fixed one", () => {
    const app = (birth: string, desired = "") => ({ childName: "Нурланов Арман", childBirthDate: birth, parentName: "Нурланова Жанар", parentPhone: "+77011110001", desiredDate: desired });
    // Born «today» in a garden already on the 13th — valid there, still the future where it is the 12th.
    expect(applicationSchema("2026-10-13").safeParse(app("2026-10-13")).success).toBe(true);
    expect(applicationSchema("2026-10-12").safeParse(app("2026-10-13")).success).toBe(false);
    expect(publicApplicationSchema("2026-10-12").safeParse(app("2022-01-01", "2029-10-12")).success).toBe(true);
    expect(publicApplicationSchema("2026-10-12").safeParse(app("2022-01-01", "2029-10-13")).success).toBe(false);
  });
});
