/**
 * Deterministic fixtures for e2e and RLS tests. Idempotent.
 * Kindergarten A "Happy Steps E2E" and B "Солнышко E2E" (isolation tests).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureKindergarten, ensureMembership, ensureUser, must } from "./lib";
import { seedMenu } from "./e2e-menu";
import { seedAttendance } from "./e2e-attendance";

export const E2E_PASSWORD = "Test1234!";

export const P = {
  superadmin: "+77000000001",
  owner: "+77010000001",
  head: "+77010000002",
  accountant: "+77010000003",
  teacher: "+77010000004",
  clubTeacher: "+77010000005",
  cook: "+77010000006",
  parent: "+77010000007",
  teacherParent: "+77010000008",
  ownerB: "+77020000001",
  parentB: "+77020000002",
} as const;

export async function seedE2E(db: SupabaseClient) {
  const u = {
    superadmin: await ensureUser(db, P.superadmin, "Платформа Админ", E2E_PASSWORD),
    owner: await ensureUser(db, P.owner, "Сапарова Айгерим Маратовна", E2E_PASSWORD),
    head: await ensureUser(db, P.head, "Ким Елена Викторовна", E2E_PASSWORD),
    accountant: await ensureUser(db, P.accountant, "Жумабекова Динара Сериковна", E2E_PASSWORD),
    teacher: await ensureUser(db, P.teacher, "Нурланова Асель Ериковна", E2E_PASSWORD),
    clubTeacher: await ensureUser(db, P.clubTeacher, "Петров Игорь Сергеевич", E2E_PASSWORD),
    cook: await ensureUser(db, P.cook, "Абенова Гульнар Кайратовна", E2E_PASSWORD),
    parent: await ensureUser(db, P.parent, "Ахметов Данияр Болатович", E2E_PASSWORD),
    teacherParent: await ensureUser(db, P.teacherParent, "Смирнова Ольга Ивановна", E2E_PASSWORD),
    ownerB: await ensureUser(db, P.ownerB, "Омаров Берик Ержанович", E2E_PASSWORD),
    parentB: await ensureUser(db, P.parentB, "Иванова Мария Петровна", E2E_PASSWORD),
  };
  await db.from("platform_admins").upsert({ user_id: u.superadmin });

  const A = await ensureKindergarten(db, "e2e-a", "Happy Steps E2E");
  const B = await ensureKindergarten(db, "e2e-b", "Солнышко E2E");

  for (const [k, role] of [
    ["owner", "owner"],
    ["head", "head"],
    ["accountant", "accountant"],
    ["teacher", "teacher"],
    ["clubTeacher", "club_teacher"],
    ["cook", "cook"],
    ["parent", "parent"],
    ["teacherParent", "teacher"],
    ["teacherParent", "parent"],
  ] as const) {
    await ensureMembership(db, u[k], A, role);
  }
  await ensureMembership(db, u.ownerB, B, "owner");
  await ensureMembership(db, u.parentB, B, "parent");

  const group = async (kg: string, name: string, capacity: number, color: string, sort: number) => {
    const { data } = await db.from("groups").select("id").eq("kindergarten_id", kg).eq("name", name).maybeSingle();
    if (data) return data.id as string;
    return must(await db.from("groups").insert({ kindergarten_id: kg, name, capacity, color, sort_order: sort }).select("id").single(), "group").id as string;
  };
  const gA1 = await group(A, "Солнышко", 20, "#E8A33D", 1);
  const gA2 = await group(A, "Звёздочки", 2, "#7C6CD6", 2);
  const gB1 = await group(B, "Ромашка", 15, "#2E9E7A", 1);
  await db.from("group_teachers").upsert([
    { group_id: gA1, user_id: u.teacher, kindergarten_id: A },
    { group_id: gA2, user_id: u.teacherParent, kindergarten_id: A },
  ]);

  const child = async (kg: string, name: string, birth: string, groupId: string, fee: number, allergies: string | null, guardians: string[]) => {
    let id: string;
    const { data } = await db.from("children").select("id").eq("kindergarten_id", kg).eq("full_name", name).maybeSingle();
    if (data) id = data.id;
    else
      id = must(
        await db
          .from("children")
          .insert({ kindergarten_id: kg, full_name: name, birth_date: birth, group_id: groupId, monthly_fee: fee, allergies, enrolled_on: "2026-09-01" })
          .select("id")
          .single(),
        "child",
      ).id;
    for (const g of guardians) await db.from("child_guardians").upsert({ child_id: id, user_id: g, kindergarten_id: kg, relation: "родитель" });
    return id;
  };
  await child(A, "Ахметов Алихан Даниярович", "2021-05-14", gA1, 65000, "орехи", [u.parent]);
  await child(A, "Смирнов Миша Олегович", "2021-11-02", gA1, 65000, null, [u.teacherParent]);
  await child(A, "Касымова Айлин Нурлановна", "2022-02-20", gA1, 60000, null, []);
  await child(A, "Бекова Сабина Арманқызы", "2022-07-09", gA2, 60000, "молоко", []);
  await child(B, "Иванов Саша Петрович", "2021-03-03", gB1, 55000, null, [u.parentB]);

  await db.from("kindergarten_settings").update({
    requisites: { kaspi: "+7 701 000 00 00", iban: "KZ00 0000 0000 0000 0000", bank: "Kaspi Bank", recipient: "ТОО «Happy Steps»", purpose: "Оплата за детский сад" },
  }).eq("kindergarten_id", A);

  await seedMenu(db, { A });

  await seedAttendance(db, { A });
  return { users: u, kindergartens: { A, B }, groups: { gA1, gA2, gB1 } };
}
