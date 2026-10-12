import type { AnyRole } from "@/lib/auth/roles";

export type NavKey =
  | "dashboard"
  | "children"
  | "groups"
  | "staff"
  | "worktime"
  | "attendance"
  | "menu"
  | "announcements"
  | "events"
  | "chats"
  | "documents"
  | "payments"
  | "clubs"
  | "waitlist"
  | "analytics"
  | "audit"
  | "settings"
  | "admin";

export interface NavItem {
  key: NavKey;
  href: string;
}

const ALL: Record<NavKey, { href: string; roles: AnyRole[] }> = {
  dashboard: { href: "/", roles: ["owner", "head", "accountant", "teacher", "club_teacher", "cook", "parent"] },
  children: { href: "/children", roles: ["owner", "head", "accountant", "teacher"] },
  groups: { href: "/groups", roles: ["owner", "head", "accountant", "teacher"] },
  staff: { href: "/staff", roles: ["owner", "head", "accountant"] },
  attendance: { href: "/attendance", roles: ["owner", "head", "accountant", "teacher"] },
  worktime: { href: "/worktime", roles: ["owner", "head", "accountant", "teacher", "club_teacher", "cook"] },
  menu: { href: "/menu", roles: ["owner", "head", "accountant", "teacher", "club_teacher", "cook", "parent"] },
  announcements: { href: "/announcements", roles: ["owner", "head", "accountant", "teacher", "club_teacher", "cook", "parent"] },
  events: { href: "/events", roles: ["owner", "head", "accountant", "teacher", "club_teacher", "cook", "parent"] },
  chats: { href: "/chats", roles: ["owner", "head", "accountant", "teacher", "club_teacher", "cook", "parent"] },
  documents: { href: "/documents", roles: ["owner", "head", "accountant", "teacher", "club_teacher", "cook", "parent"] },
  payments: { href: "/payments", roles: ["owner", "head", "accountant", "parent"] },
  clubs: { href: "/clubs", roles: ["owner", "head", "accountant", "teacher", "club_teacher", "parent"] },
  waitlist: { href: "/waitlist", roles: ["owner", "head", "accountant"] },
  analytics: { href: "/analytics", roles: ["owner", "head", "accountant"] },
  audit: { href: "/audit", roles: ["owner", "head"] },
  settings: { href: "/settings", roles: ["owner", "head"] },
  admin: { href: "/admin", roles: ["superadmin"] },
};

/** Bottom bar on phones: 3–4 items + "More" (section 8, navigation). */
const MOBILE: Record<AnyRole, NavKey[]> = {
  owner: ["dashboard", "attendance", "chats", "payments"],
  head: ["dashboard", "attendance", "chats", "children"],
  accountant: ["dashboard", "payments", "worktime", "chats"],
  teacher: ["dashboard", "attendance", "chats", "announcements"],
  club_teacher: ["dashboard", "clubs", "chats", "worktime"],
  cook: ["dashboard", "menu", "chats", "worktime"],
  parent: ["dashboard", "chats", "payments", "clubs"],
  superadmin: ["admin"],
};

export function navFor(role: AnyRole): { all: NavItem[]; mobile: NavItem[]; more: NavItem[] } {
  const all = (Object.keys(ALL) as NavKey[])
    .filter((k) => ALL[k].roles.includes(role))
    .map((key) => ({ key, href: ALL[key].href }));
  const mobileKeys = MOBILE[role];
  const mobile = mobileKeys.map((key) => ({ key, href: ALL[key].href }));
  const more = all.filter((i) => !mobileKeys.includes(i.key));
  return { all, mobile, more };
}

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}
