export const ROLES = ["owner", "head", "accountant", "teacher", "club_teacher", "cook", "parent"] as const;
export type Role = (typeof ROLES)[number];
export type AnyRole = Role | "superadmin";

export const STAFF_ROLES: Role[] = ["owner", "head", "accountant", "teacher", "club_teacher", "cook"];
export const ADMIN_ROLES: Role[] = ["owner", "head"];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/** Section 3.3: who may create / archive whom. */
export function canManageRole(actor: Role, target: Role): boolean {
  if (actor === "owner") return true;
  if (actor === "head") return ["teacher", "club_teacher", "cook", "parent"].includes(target);
  return false;
}
