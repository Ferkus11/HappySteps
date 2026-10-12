/**
 * Fixtures for the waitlist (stage 4B). Idempotent: the seeded applications are found by parent phone and re-created.
 * Garden A: two «Новая», one «Связались» (with a comment), one «Отказались» and one «Принята» (Алихан — he came
 * through the waitlist, so no extra child is created). Garden B: one «Новая» (isolation tests).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "./lib";

interface Ids {
  users: Record<string, string>;
  kindergartens: { A: string; B: string };
}

export const WAITLIST_SEED_PHONES = ["+77011110001", "+77011110002", "+77011110003", "+77011110004", "+77010000007", "+77021110001"];

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const plusDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysAgo = (days: number, hour = 10) => new Date(Date.now() - days * 86400_000 - (hour % 3) * 3600_000).toISOString();

export async function seedWaitlist(db: SupabaseClient, ids: Ids) {
  const { A, B } = ids.kindergartens;
  const { head, parent } = ids.users;
  const t = today();
  must(await db.from("waitlist_applications").delete().in("kindergarten_id", [A, B]).in("parent_phone", WAITLIST_SEED_PHONES), "waitlist cleanup");

  const insert = async (row: Record<string, unknown>) =>
    must(await db.from("waitlist_applications").insert(row).select("id").single(), "waitlist insert").id as string;

  await insert({
    kindergarten_id: A, source: "public", created_by: null, created_at: daysAgo(1),
    child_name: "Нурланов Арман Ерланович", child_birth_date: "2022-04-12",
    parent_name: "Нурланова Жанар Сериковна", parent_phone: "+77011110001",
    desired_date: plusDays(t, 30), comment: "Удобно звонить после 18:00",
  });
  await insert({
    kindergarten_id: A, source: "public", created_by: null, created_at: daysAgo(0, 1),
    child_name: "Омаров Тимур Русланович", child_birth_date: "2023-01-15",
    parent_name: "Омарова Айгерим Болатовна", parent_phone: "+77011110004",
  });
  const contacted = await insert({
    kindergarten_id: A, source: "manual", created_by: head, created_at: daysAgo(6),
    child_name: "Ким Алиса Дмитриевна", child_birth_date: "2021-08-30",
    parent_name: "Ким Дмитрий Олегович", parent_phone: "+77011110002", desired_date: plusDays(t, 14),
  });
  must(await db.from("waitlist_applications").update({ status: "contacted" }).eq("id", contacted), "contacted");
  must(
    await db.from("waitlist_comments").insert({
      kindergarten_id: A, application_id: contacted, author_id: head, kind: "comment",
      body: "Позвонили, придут на экскурсию в пятницу в 10:00.",
    }),
    "comment",
  );
  const declined = await insert({
    kindergarten_id: A, source: "public", created_by: null, created_at: daysAgo(12),
    child_name: "Серикова Томирис Айдаровна", child_birth_date: "2022-12-05",
    parent_name: "Серикова Асем Маратовна", parent_phone: "+77011110003",
  });
  must(await db.from("waitlist_applications").update({ status: "declined" }).eq("id", declined), "declined");

  const { data: alikhan } = await db.from("children").select("id").eq("kindergarten_id", A).eq("full_name", "Ахметов Алихан Даниярович").single();
  const accepted = await insert({
    kindergarten_id: A, source: "public", created_by: null, created_at: daysAgo(50),
    child_name: "Ахметов Алихан Даниярович", child_birth_date: "2021-05-14",
    parent_name: "Ахметов Данияр Болатович", parent_phone: "+77010000007", desired_date: "2026-09-01",
  });
  must(
    await db
      .from("waitlist_applications")
      .update({ status: "accepted", child_id: alikhan!.id, parent_user_id: parent, accepted_by: head, accepted_at: daysAgo(42) })
      .eq("id", accepted),
    "accepted",
  );

  await insert({
    kindergarten_id: B, source: "public", created_by: null, created_at: daysAgo(2),
    child_name: "Петров Илья Сергеевич", child_birth_date: "2022-06-01",
    parent_name: "Петрова Анна Ивановна", parent_phone: "+77021110001",
  });
}
