/**
 * The in-memory model of the demo garden: staff, families, children and the key dates of the period.
 * Pure (no database): every id is generated here, so later steps can link rows without reading them back.
 */
import { kzHolidays } from "../../src/lib/holidays-kz";
import { CLUBS, GROUPS, ALLERGIES, MEDICAL_NOTES, type GroupDef } from "./demo-content";
import { Rng, addDays, daysBetween, monthStart, todayLocal, uuid, weekday, nowMinutesLocal } from "./demo-lib";
import { childName, fatherName, makeFamily, motherName, personName, type Family, type Gender } from "./demo-names";

export type Role = "owner" | "head" | "accountant" | "teacher" | "club_teacher" | "cook" | "parent";

export interface Shift {
  weekday: number;
  start: string;
  end: string;
}

export interface Staff {
  key: string;
  id: string;
  name: string;
  phone: string;
  gender: Gender;
  roles: Role[];
  position: string;
  groups: string[];
  schedule: Shift[];
  hired: string;
  birth: string;
  archivedOn?: string;
  login?: string;
}

export interface Parent {
  id: string;
  name: string;
  phone: string;
  relation: string;
  activated: boolean;
  locale: "ru" | "kk";
  /** set when the parent is also a staff member */
  staffKey?: string;
}

export type Payer = "punctual" | "late" | "partial" | "debtor" | "reject" | "advance";

export type LeaveReason = "moved" | "school" | "other_kindergarten" | "family" | "health" | "other";

export interface Child {
  id: string;
  name: string;
  gender: Gender;
  birth: string;
  group: string;
  enrolled: string;
  fee: number;
  allergies: string | null;
  notes: string | null;
  leave?: { date: string; reason: LeaveReason };
  transfer?: { from: string; date: string };
  family: Household;
}

export interface Household {
  idx: number;
  family: Family;
  parents: Parent[];
  children: Child[];
  payer: Payer;
}

export interface GroupRec {
  key: string;
  id: string;
  def: GroupDef;
  teachers: Staff[];
}

export interface World {
  kgId: string;
  today: string;
  /** minutes since local midnight */
  nowMin: number;
  start: string;
  schoolYear: string;
  graduation: string;
  sanitaryDay: string;
  holidays: Map<string, { name: string; kind: "holiday" | "day_off" }>;
  workingDays: string[];
  groups: Map<string, GroupRec>;
  staff: Staff[];
  s: Record<string, Staff>;
  households: Household[];
  children: Child[];
  parents: Parent[];
  demoParent: Household;
  clubIds: Record<string, string>;
  rng: Rng;
}

export const LOGIN_PHONES = {
  superadmin: "+77070000000",
  owner: "+77070000001",
  head: "+77070000002",
  accountant: "+77070000003",
  teacher: "+77070000004",
  clubTeacher: "+77070000005",
  cook: "+77070000006",
  parent: "+77070000007",
  teacherParent: "+77070000008",
} as const;

const iso = (y: number, md: string) => `${y}-${md}`;

function randomDate(rng: Rng, from: string, to: string): string {
  return addDays(from, rng.int(0, Math.max(0, daysBetween(from, to))));
}

function shiftYear(d: string, years: number): string {
  const y = Number(d.slice(0, 4)) + years;
  return `${y}${d.slice(4)}`.replace(/-02-29$/, "-02-28");
}

export function buildWorld(): World {
  const rng = new Rng(20261013);
  const today = todayLocal();
  const nowMin = nowMinutesLocal();
  const start = addDays(today, -91); // worktime_range covers 93 days, analytics «quarter» ≈ 3 months
  const [ty, tm] = today.split("-").map(Number);
  const syYear = tm >= 9 ? ty : ty - 1;
  const schoolYear = iso(syYear, "09-01");
  const yShift = syYear - 2026;
  // Key dates of the period (fall back to dates inside the window when the school-year date is too old).
  const graduation = addDays(schoolYear, -4) >= start ? addDays(schoolYear, -4) : addDays(today, -70);
  const joinBase = schoolYear >= start ? schoolYear : addDays(today, -45);

  // Holidays of RK (+ the garden's sanitary day), for the years the window touches.
  const holidays = new Map<string, { name: string; kind: "holiday" | "day_off" }>();
  for (const y of [ty - 1, ty, ty + 1]) for (const h of kzHolidays(y)) holidays.set(h.date, { name: h.name.ru, kind: "holiday" });
  let sanitaryDay = addDays(graduation, -14);
  while (weekday(sanitaryDay) !== 5) sanitaryDay = addDays(sanitaryDay, 1);
  if (holidays.has(sanitaryDay)) sanitaryDay = addDays(sanitaryDay, -7);
  holidays.set(sanitaryDay, { name: "Санитарный день", kind: "day_off" });

  const workingDays: string[] = [];
  for (let d = start; d <= today; d = addDays(d, 1)) if (weekday(d) <= 5 && !holidays.has(d)) workingDays.push(d);

  const groups = new Map<string, GroupRec>();
  for (const def of GROUPS) {
    groups.set(def.key, { key: def.key, id: uuid(), def: { ...def, born: [shiftYear(def.born[0], yShift), shiftYear(def.born[1], yShift)] }, teachers: [] });
  }

  // ───────────── Staff ─────────────
  let staffPhone = 1;
  const nextStaffPhone = () => `+7707001${String(staffPhone++).padStart(4, "0")}`;
  const staff: Staff[] = [];
  const s: Record<string, Staff> = {};
  const add = (st: Omit<Staff, "id" | "phone"> & { phone?: string }) => {
    const rec: Staff = { ...st, id: uuid(), phone: st.phone ?? nextStaffPhone() };
    staff.push(rec);
    s[rec.key] = rec;
    return rec;
  };
  const wk = (start_: string, end: string, days = [1, 2, 3, 4, 5]): Shift[] => days.map((weekday_) => ({ weekday: weekday_, start: start_, end }));
  const hired = (offsetDays: number) => addDays(today, -offsetDays);
  const birth = () => randomDate(rng, iso(ty - 55, "01-01"), iso(ty - 23, "12-31"));

  add({ key: "superadmin", name: "Нуртаев Ерлан Маратович", gender: "m", roles: [], position: "Поддержка платформы", groups: [], schedule: [], hired: hired(900), birth: birth(), phone: LOGIN_PHONES.superadmin, login: "superadmin" });
  add({ key: "owner", name: "Сейткали Айгерим Маратовна", gender: "f", roles: ["owner"], position: "Владелец", groups: [], schedule: [], hired: hired(1200), birth: "1986-03-14", phone: LOGIN_PHONES.owner, login: "owner" });
  add({ key: "head", name: "Ким Елена Викторовна", gender: "f", roles: ["head"], position: "Заведующая", groups: [], schedule: wk("08:00", "17:00"), hired: hired(1150), birth: "1979-01-01", phone: LOGIN_PHONES.head, login: "head" });
  add({ key: "accountant", name: "Жумабекова Динара Сериковна", gender: "f", roles: ["accountant"], position: "Бухгалтер", groups: [], schedule: wk("09:00", "18:00"), hired: hired(1000), birth: birth(), phone: LOGIN_PHONES.accountant, login: "accountant" });
  add({ key: "admin2", name: "Ли Марина Александровна", gender: "f", roles: ["accountant"], position: "Администратор", groups: [], schedule: wk("08:30", "17:30"), hired: hired(420), birth: birth() });
  add({ key: "teacher", name: "Нурланова Асель Ерлановна", gender: "f", roles: ["teacher"], position: "Воспитатель", groups: ["zhuldyz"], schedule: wk("08:00", "17:00"), hired: hired(800), birth: birth(), phone: LOGIN_PHONES.teacher, login: "teacher" });
  add({ key: "clubTeacher", name: "Петров Игорь Сергеевич", gender: "m", roles: ["club_teacher"], position: "Педагог: шахматы и рисование", groups: [], schedule: wk("13:00", "18:00", [1, 2, 3, 4]), hired: hired(600), birth: birth(), phone: LOGIN_PHONES.clubTeacher, login: "clubTeacher" });
  add({ key: "cook", name: "Абенова Гульнар Кайратовна", gender: "f", roles: ["cook"], position: "Шеф-повар", groups: [], schedule: wk("06:30", "15:30"), hired: hired(1100), birth: birth(), phone: LOGIN_PHONES.cook, login: "cook" });
  add({ key: "teacherParent", name: "Смирнова Ольга Ивановна", gender: "f", roles: ["teacher", "parent"], position: "Воспитатель", groups: ["kunshuak"], schedule: wk("08:00", "17:00"), hired: hired(700), birth: "1993-06-21", phone: LOGIN_PHONES.teacherParent, login: "teacherParent" });

  // Second teachers and the rest of the team.
  const teacherPlan: [string, "A" | "B"][] = [
    ["balapan", "A"], ["balapan", "B"], ["botakan", "A"], ["botakan", "B"], ["kunshuak", "B"], ["zhuldyz", "B"], ["raduga", "A"], ["raduga", "B"], ["zerde", "A"], ["zerde", "B"],
  ];
  for (const [g, slot] of teacherPlan) {
    add({
      key: `t_${g}_${slot}`, name: personName(rng, "f"), gender: "f", roles: ["teacher"], position: slot === "A" ? "Воспитатель" : "Воспитатель (вторая смена)",
      groups: [g], schedule: slot === "A" ? wk("08:00", "17:00") : wk("10:00", "19:00"),
      hired: g === "raduga" && slot === "B" ? addDays(graduation, -4) : hired(rng.int(200, 1100)), birth: birth(),
    });
  }
  // A teacher who left at the end of August (archived; her timesheet stays).
  add({ key: "t_left", name: personName(rng, "f"), gender: "f", roles: ["teacher"], position: "Воспитатель", groups: [], schedule: wk("10:00", "19:00"), hired: hired(900), birth: birth(), archivedOn: addDays(graduation, 3) });
  add({ key: "music", name: personName(rng, "f"), gender: "f", roles: ["club_teacher"], position: "Музыкальный руководитель", groups: [], schedule: wk("09:00", "14:00"), hired: hired(700), birth: birth() });
  add({ key: "english", name: personName(rng, "f", "ru"), gender: "f", roles: ["club_teacher"], position: "Педагог английского языка", groups: [], schedule: wk("09:30", "13:30", [2, 5]), hired: hired(380), birth: birth() });
  add({ key: "coach", name: personName(rng, "m"), gender: "m", roles: ["club_teacher"], position: "Тренер по футболу", groups: [], schedule: wk("15:00", "18:00", [3, 5]), hired: hired(300), birth: birth() });
  add({ key: "cook2", name: personName(rng, "f"), gender: "f", roles: ["cook"], position: "Повар", groups: [], schedule: wk("06:30", "15:30"), hired: hired(500), birth: birth() });
  add({ key: "cook3", name: personName(rng, "f"), gender: "f", roles: ["cook"], position: "Помощник повара", groups: [], schedule: wk("08:00", "17:00"), hired: hired(250), birth: birth() });

  for (const st of staff) for (const g of st.groups) groups.get(g)!.teachers.push(st);
  // Main teacher first.
  for (const g of groups.values()) g.teachers.sort((a, b) => (a.schedule[0]?.start ?? "").localeCompare(b.schedule[0]?.start ?? ""));

  // ───────────── Families and children ─────────────
  const usedSurnames = new Set<string>();
  const takenNames = new Set<string>();
  let parentPhone = 1;
  const nextParentPhone = () => `+7707002${String(parentPhone++).padStart(4, "0")}`;
  const households: Household[] = [];
  const children: Child[] = [];
  // 30 slots: mostly punctual, a few late payers, rejected receipts, one partial and one chronic debtor per ~30 families.
  const payers: Payer[] = [...Array<Payer>(22).fill("punctual"), ...Array<Payer>(4).fill("late"), "reject", "reject", "partial", "debtor"];

  const newHousehold = (family: Family, opts: { second?: boolean; grandma?: boolean } = {}): Household => {
    const h: Household = { idx: households.length, family, parents: [], children: [], payer: rng.pick(payers) };
    const motherFirst = rng.chance(0.78);
    const mother: Parent = { id: uuid(), name: motherName(family), phone: nextParentPhone(), relation: "мама", activated: rng.chance(0.95), locale: rng.chance(0.12) ? "kk" : "ru" };
    const father: Parent = { id: uuid(), name: fatherName(family), phone: nextParentPhone(), relation: "папа", activated: rng.chance(0.9), locale: rng.chance(0.12) ? "kk" : "ru" };
    h.parents.push(motherFirst ? mother : father);
    if (opts.second ?? rng.chance(0.3)) h.parents.push(motherFirst ? father : mother);
    if (opts.grandma) {
      h.parents.push({ id: uuid(), name: personName(rng, "f", family.ethnicity), phone: nextParentPhone(), relation: "бабушка", activated: true, locale: family.ethnicity === "kz" ? "kk" : "ru" });
    }
    households.push(h);
    return h;
  };

  const addChild = (h: Household, groupKey: string, o: Partial<Child> & { gender?: Gender; firstName?: string } = {}): Child => {
    const g = groups.get(groupKey)!;
    const gender = o.gender ?? (rng.chance(0.5) ? "m" : "f");
    let name = childName(rng, h.family, gender, takenNames);
    if (o.firstName) {
      const parts = name.split(" ");
      name = `${parts[0]} ${o.firstName} ${parts[2]}`;
    }
    const born = o.birth ?? randomDate(rng, g.def.born[0], g.def.born[1]);
    // Enrolled: usually on a 1 September after turning ~1.5 years; never later than the window start unless told so.
    let enrolled = o.enrolled;
    if (!enrolled) {
      const minAge = addDays(born, 540);
      const candidates = [0, 1, 2, 3].map((k) => iso(syYear - k, "09-01")).filter((d) => d >= minAge && d < start);
      enrolled = candidates.length ? rng.pick(candidates) : addDays(start, -rng.int(10, 120));
      if (enrolled < minAge) enrolled = minAge;
    }
    const allergic = rng.chance(0.11);
    const c: Child = {
      id: uuid(), name, gender, birth: born, group: groupKey, enrolled,
      fee: g.def.fee, allergies: o.allergies !== undefined ? o.allergies : allergic ? rng.pick(ALLERGIES) : null,
      notes: o.notes !== undefined ? o.notes : rng.chance(0.04) ? rng.pick(MEDICAL_NOTES) : null,
      leave: o.leave, transfer: o.transfer, family: h,
    };
    h.children.push(c);
    children.push(c);
    return c;
  };

  const size = new Map<string, number>(GROUPS.map((g) => [g.key, 0]));
  const bump = (g: string) => size.set(g, (size.get(g) ?? 0) + 1);

  // The demo parent: two children in «Жұлдыз» and «Ботақан», both parents have accounts.
  const omarov: Family = {
    ethnicity: "kz", surname: "Омаров", kzPatronymic: false,
    father: { first: "Ерлан", patronymic: "Нурланович" },
    mother: { first: "Жанар", patronymic: "Сериковна", surname: "Омарова" },
  };
  usedSurnames.add("Омаров");
  const demo: Household = { idx: households.length, family: omarov, parents: [], children: [], payer: "reject" };
  households.push(demo);
  demo.parents.push({ id: uuid(), name: "Омаров Ерлан Нурланович", phone: LOGIN_PHONES.parent, relation: "папа", activated: true, locale: "ru" });
  demo.parents.push({ id: uuid(), name: "Омарова Жанар Сериковна", phone: nextParentPhone(), relation: "мама", activated: true, locale: "ru" });
  const zh = groups.get("zhuldyz")!.def;
  addChild(demo, "zhuldyz", { gender: "m", firstName: "Алдияр", birth: addDays(zh.born[0], 40), allergies: "мёд", enrolled: iso(syYear - 2, "09-01") });
  addChild(demo, "botakan", { gender: "f", firstName: "Айлин", enrolled: iso(syYear - 1, "09-01") });
  bump("zhuldyz");
  bump("botakan");

  // The teacher who is also a parent: her son in «Балапан» (staff discount 50 %).
  const smirnova: Household = {
    idx: households.length,
    family: { ethnicity: "ru", surname: "Смирнов", kzPatronymic: false, father: { first: "Андрей", patronymic: "Петрович" }, mother: { first: "Ольга", patronymic: "Ивановна", surname: "Смирнова" } },
    parents: [{ id: s.teacherParent.id, name: s.teacherParent.name, phone: s.teacherParent.phone, relation: "мама", activated: true, locale: "ru", staffKey: "teacherParent" }],
    children: [],
    payer: "punctual",
  };
  households.push(smirnova);
  usedSurnames.add("Смирнов");
  const lev = addChild(smirnova, "balapan", { gender: "m", firstName: "Лев", enrolled: joinBase });
  lev.fee = Math.round(lev.fee / 2);
  bump("balapan");

  // Siblings: families with two children in different groups (the second child gets 10 % off).
  const keys = GROUPS.map((g) => g.key);
  for (let i = 0; i < 12; i++) {
    const h = newHousehold(makeFamily(rng, usedSurnames), { second: rng.chance(0.55), grandma: i === 3 });
    const a = rng.int(0, keys.length - 3);
    const b = rng.int(a + 2, keys.length - 1);
    for (const gk of [keys[a], keys[b]]) {
      if ((size.get(gk) ?? 0) >= GROUPS.find((g) => g.key === gk)!.size) continue;
      const c = addChild(h, gk);
      bump(gk);
      if (h.children.length === 2) c.fee = Math.round((c.fee * 0.9) / 500) * 500;
    }
    if (!h.children.length) households.pop();
  }

  // Newcomers of this school year (part of the group sizes): «Балапан» mostly new, a few in «Ботақан».
  const newcomers: [string, number][] = [["balapan", 8], ["botakan", 3]];
  for (const [gk, n] of newcomers) {
    for (let i = 0; i < n && (size.get(gk) ?? 0) < GROUPS.find((g) => g.key === gk)!.size; i++) {
      const h = newHousehold(makeFamily(rng, usedSurnames));
      addChild(h, gk, { enrolled: addDays(joinBase, rng.int(0, 14)) });
      bump(gk);
    }
  }
  // Two older «Балапан» children moved up to «Ботақан» on 1 September.
  for (let i = 0; i < 2; i++) {
    const h = newHousehold(makeFamily(rng, usedSurnames));
    const b = groups.get("botakan")!.def.born;
    addChild(h, "botakan", { birth: randomDate(rng, addDays(b[1], -120), b[1]), enrolled: addDays(start, -rng.int(60, 200)), transfer: { from: "balapan", date: joinBase } });
    bump("botakan");
  }
  // Mid-period joiners: summer and one start in the middle of the current month.
  {
    const h1 = newHousehold(makeFamily(rng, usedSurnames));
    addChild(h1, "zhuldyz", { enrolled: addDays(start, 7) });
    bump("zhuldyz");
    const h2 = newHousehold(makeFamily(rng, usedSurnames));
    addChild(h2, "kunshuak", { enrolled: addDays(start, 21) });
    bump("kunshuak");
    const h3 = newHousehold(makeFamily(rng, usedSurnames));
    let mid = addDays(monthStart(today), 4);
    if (mid > addDays(today, -1)) mid = addDays(today, -2);
    while (weekday(mid) > 5) mid = addDays(mid, -1);
    addChild(h3, "raduga", { enrolled: mid });
    bump("raduga");
  }
  // Fill the groups with single-child families.
  for (const g of GROUPS) {
    while ((size.get(g.key) ?? 0) < g.size) {
      const h = newHousehold(makeFamily(rng, usedSurnames));
      addChild(h, g.key);
      bump(g.key);
    }
  }

  // Children who left during the period (archived with a reason): graduates and a few others.
  const leavers: [string, number | "graduation", LeaveReason][] = [
    ["zerde", "graduation", "school"], ["zerde", "graduation", "school"], ["zerde", "graduation", "school"], ["zerde", "graduation", "school"],
    ["zerde", "graduation", "school"], ["zerde", "graduation", "school"], ["zerde", "graduation", "school"],
    ["botakan", 80, "health"], ["raduga", 66, "other_kindergarten"], ["kunshuak", 25, "moved"], ["zhuldyz", 11, "family"],
  ];
  for (const [gk, when, reason] of leavers) {
    const h = newHousehold(makeFamily(rng, usedSurnames));
    let date = when === "graduation" ? graduation : addDays(today, -when);
    while (weekday(date) > 5 || holidays.has(date)) date = addDays(date, -1);
    const gb = groups.get(gk)!.def.born;
    const born = reason === "school" ? randomDate(rng, shiftYear(gb[0], -1), addDays(gb[0], -20)) : undefined;
    addChild(h, gk, { birth: born, enrolled: addDays(start, -rng.int(200, 700)), leave: { date, reason } });
  }
  // Leavers must have started before they left.
  for (const c of children) if (c.leave && c.enrolled > c.leave.date) c.enrolled = addDays(c.leave.date, -200);

  // A couple of children whose fee is reduced (benefit for large families).
  for (const c of rng.shuffle(children.filter((x) => !x.leave && x.family.children.length === 1)).slice(0, 2)) c.fee = 70000;

  const parents = households.flatMap((h) => h.parents).filter((p) => !p.staffKey);
  return {
    kgId: uuid(), today, nowMin, start, schoolYear, graduation, sanitaryDay, holidays, workingDays,
    groups, staff, s, households, children, parents, demoParent: demo,
    clubIds: Object.fromEntries(CLUBS.map((c) => [c.key, uuid()])),
    rng,
  };
}

/** Active children of a group (now). */
export function activeIn(w: World, groupKey: string): Child[] {
  return w.children.filter((c) => c.group === groupKey && !c.leave);
}

/** Group of a child on a date (history: transfer and leave). */
export function groupOn(c: Child, d: string): string | null {
  if (d < c.enrolled) return null;
  if (c.leave && d > c.leave.date) return null;
  if (c.transfer && d < c.transfer.date) return c.transfer.from;
  return c.group;
}

/** The staff member's shift on a date by the weekly template (null = day off). */
export function shiftOn(st: Staff, d: string): Shift | null {
  return st.schedule.find((x) => x.weekday === weekday(d)) ?? null;
}
