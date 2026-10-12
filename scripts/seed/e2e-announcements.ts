/**
 * Fixtures for announcements & events (stage 2D). Idempotent: rows are found by title and refreshed;
 * dates are relative to "today" in Asia/Almaty so the calendar/widgets always have something to show.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "./lib";

interface Ids {
  users: Record<string, string>;
  kindergartens: { A: string };
  groups: { gA1: string; gA2: string };
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const plus = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** Same month/day as `iso` in another year (birthdays). */
const inYear = (iso: string, year: number) => `${year}${iso.slice(4)}`.replace(/-02-29$/, "-02-28");

export async function seedAnnouncements(db: SupabaseClient, ids: Ids) {
  const { users: u } = ids;
  const A = ids.kindergartens.A;
  const t0 = today();

  const announcement = async (title: string, row: Record<string, unknown>, groups: string[] = []) => {
    const { data } = await db.from("announcements").select("id").eq("kindergarten_id", A).eq("title", title).maybeSingle();
    const id = data
      ? (data.id as string)
      : (must(await db.from("announcements").insert({ kindergarten_id: A, title, ...row }).select("id").single(), "announcement").id as string);
    if (data) await db.from("announcements").update(row).eq("id", id);
    if (groups.length) {
      await db.from("announcement_groups").upsert(groups.map((g) => ({ announcement_id: id, group_id: g, kindergarten_id: A })));
    }
    return id;
  };
  await announcement("Утренник «Золотая осень»", {
    author_id: u.head,
    audience: "all",
    important: true,
    body: "Дорогие родители! В пятницу в 10:00 в музыкальном зале пройдёт осенний утренник. Девочкам — платья осенних цветов, мальчикам — белые рубашки.",
  });
  await announcement(
    "Принесите сменную одежду",
    { author_id: u.teacher, audience: "groups", important: false, body: "На этой неделе гуляем много — положите, пожалуйста, в шкафчик сменные штаны и носки." },
    [ids.groups.gA1],
  );
  await announcement("Планёрка в пятницу", { author_id: u.owner, audience: "staff", important: false, body: "Собираемся в методическом кабинете в 13:30." });

  const event = async (title: string, row: Record<string, unknown>, groups: string[] = []) => {
    const { data } = await db.from("events").select("id").eq("kindergarten_id", A).eq("title", title).maybeSingle();
    const id = data ? (data.id as string) : (must(await db.from("events").insert({ kindergarten_id: A, title, ...row }).select("id").single(), "event").id as string);
    if (data) await db.from("events").update(row).eq("id", id);
    if (groups.length) await db.from("event_groups").upsert(groups.map((g) => ({ event_id: id, group_id: g, kindergarten_id: A })));
  };
  await event("Осенний утренник", { author_id: u.head, audience: "all", kind: "matinee", date: plus(t0, 7), start_time: "10:00", end_time: "11:00", place: "Музыкальный зал" });
  await event(
    "Родительское собрание",
    { author_id: u.teacher, audience: "groups", kind: "parent_meeting", date: plus(t0, 3), start_time: "18:30", end_time: null, place: "Группа «Солнышко»" },
    [ids.groups.gA1],
  );
  await event("Педсовет", { author_id: u.owner, audience: "staff", kind: "other", date: plus(t0, 5), start_time: "13:30", end_time: null, place: "Методический кабинет" });

  // Birthdays this week: a child without parents in the fixtures (Айлин) and a teacher.
  await db.from("children").update({ birth_date: inYear(plus(t0, 2), 2022) }).eq("kindergarten_id", A).eq("full_name", "Касымова Айлин Нурлановна");
  await db.from("profiles").update({ birth_date: inYear(plus(t0, 1), 1992) }).eq("id", u.teacher);
}
