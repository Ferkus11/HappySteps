import { describe, expect, it } from "vitest";
import { canManageRole, ROLES } from "@/lib/auth/roles";
import { navFor } from "@/lib/nav";

describe("roles", () => {
  it("follows section 3.3", () => {
    expect(canManageRole("owner", "head")).toBe(true);
    expect(canManageRole("owner", "accountant")).toBe(true);
    expect(canManageRole("head", "teacher")).toBe(true);
    expect(canManageRole("head", "parent")).toBe(true);
    expect(canManageRole("head", "head")).toBe(false);
    expect(canManageRole("head", "owner")).toBe(false);
    expect(canManageRole("head", "accountant")).toBe(false);
    expect(canManageRole("teacher", "parent")).toBe(false);
  });
});

describe("navigation", () => {
  it("gives every role 4–5 phone items including More", () => {
    for (const r of ROLES) {
      const n = navFor(r);
      const count = n.mobile.length + (n.more.length ? 1 : 0);
      expect(count).toBeGreaterThanOrEqual(4);
      expect(count).toBeLessThanOrEqual(5);
    }
  });
  it("hides admin sections from parents", () => {
    const keys = navFor("parent").all.map((i) => i.key);
    expect(keys).not.toContain("staff");
    expect(keys).not.toContain("analytics");
    expect(keys).not.toContain("waitlist");
    expect(keys).toContain("payments");
  });
  it("hides finances from teachers", () => {
    expect(navFor("teacher").all.map((i) => i.key)).not.toContain("payments");
  });
});
