/** Demo: children's and staff documents (real tiny files in the private buckets), clubs with a queue, the waitlist. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { gradientPng } from "./e2e-clubs";
import { tinyPdf } from "./e2e-documents";
import { CLUBS } from "./demo-content";
import { addDays, at, check, hm, insertMany, pool, upload, uuid } from "./demo-lib";
import { EMAIL_DOMAIN } from "./lib";
import type { Child, Staff, World } from "./demo-world";

type Row = Record<string, unknown>;

function age(birth: string, on: string): number {
  const [by, bm, bd] = birth.split("-").map(Number);
  const [y, m, d] = on.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

// ───────────────────────────── Documents ─────────────────────────────
export interface ExpiringDoc {
  staff: Staff;
  title: string;
  expires: string;
}

export async function seedDocuments(db: SupabaseClient, w: World, recentSick: { child: Child; to: string }[]): Promise<ExpiringDoc[]> {
  const rng = w.rng;
  const kg = w.kgId;
  const head = w.s.head.id;
  const uploads: { bucket: string; path: string; body: Buffer; mime: string }[] = [];
  const childRows: Row[] = [];
  const staffRows: Row[] = [];
  const file = (bucket: string, owner: string, text: string, photo = false) => {
    const ext = photo ? "png" : "pdf";
    const path = `${kg}/${owner}/${uuid()}.${ext}`;
    const body = photo ? gradientPng(600, 800, [250, 250, 250], [180, 190, 205]) : tinyPdf(text);
    uploads.push({ bucket, path, body, mime: photo ? "image/png" : "application/pdf" });
    return { path, mime: photo ? "image/png" : "application/pdf", size: body.length };
  };

  for (const c of w.children.filter((x) => !x.leave)) {
    const demo = c.family === w.demoParent;
    const parent = c.family.parents[0].id;
    const docs: [string, string, string, string, boolean][] = [];
    if (demo || rng.chance(0.55)) docs.push(["applications", "Договор об оказании услуг", head, c.enrolled, false]);
    if (demo || rng.chance(0.35)) docs.push(["vaccination", "Прививочный паспорт", parent, addDays(c.enrolled, rng.int(0, 10)), rng.chance(0.5)]);
    if ((demo && c.group === "zhuldyz") || rng.chance(0.3)) docs.push(["medical", "Медицинская справка (форма 026/у)", parent, addDays(c.enrolled, -rng.int(1, 7)), false]);
    if (rng.chance(0.08)) docs.push(["other", "Заявление на летний отпуск", parent, addDays(w.start, rng.int(0, 20)), true]);
    for (const [category, title, by, date, photo] of docs) {
      const f = file("child-documents", c.id, `Happy Steps - ${category}`, photo);
      childRows.push({ id: uuid(), kindergarten_id: kg, child_id: c.id, category, title, path: f.path, mime: f.mime, size: f.size, uploaded_by: by, created_at: at(date < w.today ? date : w.today, "10:30") });
    }
  }
  for (const s of recentSick) {
    if (s.child.leave || !rng.chance(0.4)) continue;
    const date = addDays(s.to, 1) > w.today ? w.today : addDays(s.to, 1);
    const f = file("child-documents", s.child.id, "Happy Steps - certificate after illness", true);
    childRows.push({ id: uuid(), kindergarten_id: kg, child_id: s.child.id, category: "medical", title: "Справка после болезни", path: f.path, mime: f.mime, size: f.size, uploaded_by: s.child.family.parents[0].id, created_at: at(date, hm(Math.min(w.nowMin - 10, 8 * 60 + 15))) });
  }

  // Staff: medical book (with expiry), criminal-record certificate for teachers, employment contract.
  const expiring: ExpiringDoc[] = [];
  const soon: Record<string, number> = { teacher: 19, cook2: 6, coach: 27 };
  for (const st of w.staff.filter((x) => x.roles.length && !x.roles.every((r) => r === "owner"))) {
    const by = rng.chance(0.6) ? st.id : head;
    const medExp = st.archivedOn ? addDays(w.today, -20) : soon[st.key] !== undefined ? addDays(w.today, soon[st.key]) : addDays(w.today, rng.int(60, 330));
    const medFile = file("staff-documents", st.id, "Happy Steps - medical book", rng.chance(0.4));
    staffRows.push({ id: uuid(), kindergarten_id: kg, user_id: st.id, type: "med_book", title: "Медицинская книжка", expires_on: medExp, path: medFile.path, mime: medFile.mime, size: medFile.size, uploaded_by: by, created_at: at(addDays(medExp, -365) < st.hired ? st.hired : addDays(medExp, -365), "11:00") });
    if (soon[st.key] !== undefined) expiring.push({ staff: st, title: "Медицинская книжка", expires: medExp });
    if (st.key === "head") {
      // An older medical book replaced by the new one (D-024: the old copy stays but never reminds).
      const old = file("staff-documents", st.id, "Happy Steps - medical book (old)");
      staffRows.push({ id: uuid(), kindergarten_id: kg, user_id: st.id, type: "med_book", title: "Медицинская книжка (прошлый год)", expires_on: addDays(w.today, -40), path: old.path, mime: old.mime, size: old.size, uploaded_by: st.id, created_at: at(addDays(w.today, -405), "11:00") });
    }
    if (st.roles.includes("teacher") || st.roles.includes("club_teacher")) {
      const f = file("staff-documents", st.id, "Happy Steps - no criminal record");
      staffRows.push({ id: uuid(), kindergarten_id: kg, user_id: st.id, type: "no_criminal_record", title: "Справка о несудимости", expires_on: rng.chance(0.5) ? addDays(w.today, rng.int(120, 300)) : null, path: f.path, mime: f.mime, size: f.size, uploaded_by: head, created_at: at(st.hired, "12:00") });
    }
    const f = file("staff-documents", st.id, "Happy Steps - employment contract");
    staffRows.push({ id: uuid(), kindergarten_id: kg, user_id: st.id, type: "contract", title: "Трудовой договор", expires_on: null, path: f.path, mime: f.mime, size: f.size, uploaded_by: head, created_at: at(st.hired, "12:10") });
  }

  await pool(uploads, 8, (u) => upload(db, u.bucket, u.path, u.body, u.mime));
  await insertMany(db, "child_documents", childRows);
  await insertMany(db, "staff_documents", staffRows);
  // Reminders already sent by the cron for the documents expiring soon (so it does not send them again).
  const reminders: Row[] = [];
  for (const r of staffRows) {
    const exp = r.expires_on as string | null;
    if (!exp || exp < w.today || (r.user_id as string) === w.s.t_left.id) continue;
    for (const threshold of [30, 7]) {
      const due = addDays(exp, -threshold);
      if (due <= w.today) reminders.push({ document_id: r.id, kindergarten_id: kg, expires_on: exp, threshold, sent_at: at(due, "09:00") });
    }
  }
  await insertMany(db, "staff_document_reminders", reminders);
  return expiring;
}

// ───────────────────────────── Clubs ─────────────────────────────
export interface ClubResult {
  requests: { club: string; clubId: string; child: Child; status: string; teacher: string; created: string }[];
}

export async function seedClubs(db: SupabaseClient, w: World, password: string): Promise<ClubResult> {
  const rng = w.rng;
  const kg = w.kgId;
  const teacherOf: Record<string, Staff> = { chess: w.s.clubTeacher, art: w.s.clubTeacher, english: w.s.english, dance: w.s.music, football: w.s.coach };
  const clubRows: Row[] = [];
  for (const c of CLUBS) {
    const path = `${kg}/clubs/${uuid()}.png`;
    await upload(db, "club-photos", path, gradientPng(960, 540, c.colors[0], c.colors[1]), "image/png");
    clubRows.push({
      id: w.clubIds[c.key], kindergarten_id: kg, name: c.name, description: c.description, photo_path: path, teacher_id: teacherOf[c.key].id,
      age_from: c.ageFrom, age_to: c.ageTo, schedule: c.schedule, place: c.place, capacity: c.capacity,
    });
  }
  await insertMany(db, "clubs", clubRows);

  const active = w.children.filter((c) => !c.leave && c.enrolled < w.today);
  const clubsOf = new Map<string, number>();
  const aldiyar = w.demoParent.children.find((c) => c.group === "zhuldyz")!;
  const eligible = (key: string, exclude: Set<string>) => {
    const def = CLUBS.find((c) => c.key === key)!;
    return rng.shuffle(active.filter((c) => {
      const a = age(c.birth, w.today);
      return a >= def.ageFrom && a <= def.ageTo && !exclude.has(c.id) && (clubsOf.get(c.id) ?? 0) < 2 && c.family !== w.demoParent;
    }));
  };
  const enrollments: Row[] = [];
  const startBase = w.schoolYear >= w.start ? w.schoolYear : addDays(w.today, -40);
  const activeIn: Record<string, Set<string>> = {};
  const enroll = (key: string, c: Child, status: string, extra: Row = {}) => {
    const req = addDays(startBase, rng.int(1, 20));
    const decided = addDays(req, rng.int(1, 3));
    enrollments.push({
      id: uuid(), kindergarten_id: kg, club_id: w.clubIds[key], child_id: c.id, status, queue_no: null,
      requested_by: c.family.parents[0].id, decided_by: rng.chance(0.5) ? w.s.head.id : teacherOf[key].id, decided_at: at(decided, "12:00"),
      started_on: status === "active" ? at(decided, "12:00") : null, ended_by: null, ended_at: null, reason: null,
      created_at: at(req, "20:15"), ...extra,
    });
    if (status === "active") {
      clubsOf.set(c.id, (clubsOf.get(c.id) ?? 0) + 1);
      (activeIn[key] ??= new Set()).add(c.id);
    }
  };
  const plan: [string, number][] = [["chess", 8], ["art", 9], ["english", 7], ["dance", 11], ["football", 10]];
  for (const [key, n] of plan) for (const c of eligible(key, new Set()).slice(0, n)) enroll(key, c, "active");
  // The demo parent's daughter dances (the parent's dashboard shows «Мои кружки»).
  const aylin = w.demoParent.children.find((c) => c.group === "botakan");
  if (aylin && age(aylin.birth, w.today) >= 2) enroll("dance", aylin, "active");
  // History in «Ритмика и танцы»: left, excluded, rejected.
  const hist = eligible("dance", activeIn.dance ?? new Set()).slice(0, 3);
  if (hist[0]) enroll("dance", hist[0], "left", { ended_by: hist[0].family.parents[0].id, ended_at: at(addDays(w.today, -20), "19:00") });
  if (hist[1]) enroll("dance", hist[1], "excluded", { ended_by: w.s.head.id, ended_at: at(addDays(w.today, -12), "11:00"), reason: "Не посещает занятия больше месяца" });
  if (hist[2]) enroll("dance", hist[2], "rejected", { started_on: null, reason: "Ребёнку пока тяжело в большой группе — вернёмся к вопросу после адаптации" });
  await insertMany(db, "club_enrollments", enrollments);
  const audit: Row[] = [];
  if (hist[1]) audit.push({ kindergarten_id: kg, actor_id: w.s.head.id, action: "club.exclude", entity: "club_enrollment", entity_id: enrollments.find((e) => e.status === "excluded")!.id, details: { club_id: w.clubIds.dance, child_id: hist[1].id, reason: "Не посещает занятия больше месяца" }, created_at: at(addDays(w.today, -12), "11:00") });
  await insertMany(db, "audit_log", audit);

  // Requests and the queue through the real «Записаться» (club_request as the parent): the database decides
  // between «заявка» and «очередь» and numbers the queue.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required for the demo seed");
  const taken = new Set(Object.values(activeIn).flatMap((s) => [...s]));
  const chessQ = eligible("chess", taken);
  const requests: [string, Child, number][] = [
    ["chess", chessQ[0], 8], ["chess", aldiyar, 5], ["chess", chessQ[1], 2],
    ...eligible("art", taken).slice(0, 2).map((c, i) => ["art", c, 2 - i] as [string, Child, number]),
    ...eligible("english", new Set([...taken, ...chessQ.slice(0, 2).map((c) => c.id)])).slice(0, 1).map((c) => ["english", c, 1] as [string, Child, number]),
  ];
  const out: ClubResult["requests"] = [];
  for (const [key, child, daysAgo] of requests) {
    if (!child) continue;
    const p = child.family.parents[0];
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `${p.phone.replace(/\D/g, "")}@${EMAIL_DOMAIN}`;
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`sign in ${p.phone}: ${signIn.error.message}`);
    const res = check(await client.rpc("club_request", { p_club: w.clubIds[key], p_child: child.id }), `club_request ${key}`) as { id: string; status: string };
    await client.auth.signOut();
    const created = at(addDays(w.today, -daysAgo), hm(19 * 60 + rng.int(0, 120)));
    check(await db.from("club_enrollments").update({ created_at: created }).eq("id", res.id), "request date");
    out.push({ club: CLUBS.find((c) => c.key === key)!.name, clubId: w.clubIds[key], child, status: res.status, teacher: teacherOf[key].id, created });
  }
  return { requests: out };
}

// ───────────────────────────── Waitlist ─────────────────────────────
export interface WaitlistResult {
  fresh: { id: string; child: string; parent: string; created: string }[];
}

export async function seedWaitlist(db: SupabaseClient, w: World): Promise<WaitlistResult> {
  const kg = w.kgId;
  const head = w.s.head.id;
  const t = w.today;
  const apps: Row[] = [];
  const comments: Row[] = [];
  const audit: Row[] = [];
  const fresh: WaitlistResult["fresh"] = [];
  let n = 1;
  const phone = () => `+7707009${String(n++).padStart(4, "0")}`;
  const app = (o: { child: string; birth: string; parent: string; daysAgo: number; status: string; source?: string; desired?: string | null; comment?: string | null; phone?: string }) => {
    const id = uuid();
    const created = at(addDays(t, -o.daysAgo), o.daysAgo === 0 ? hm(Math.max(0, w.nowMin - 90)) : hm(9 * 60 + ((o.daysAgo * 97) % 600)));
    apps.push({
      id, kindergarten_id: kg, child_name: o.child, child_birth_date: o.birth, parent_name: o.parent, parent_phone: o.phone ?? phone(),
      desired_date: o.desired ?? null, comment: o.comment ?? null, source: o.source ?? "public", status: o.status === "accepted" ? "contacted" : o.status,
      status_changed_at: created, created_by: o.source === "manual" ? head : null, created_at: created,
    });
    if (o.status === "new" && o.daysAgo <= 3) fresh.push({ id, child: o.child, parent: o.parent, created });
    return { id, created };
  };
  const status = (id: string, s: string, daysAgo: number) => {
    const when = at(addDays(t, -daysAgo), "11:30");
    comments.push({ id: uuid(), kindergarten_id: kg, application_id: id, author_id: head, kind: "status", status: s, created_at: when });
    return when;
  };
  const comment = (id: string, body: string, daysAgo: number) =>
    comments.push({ id: uuid(), kindergarten_id: kg, application_id: id, author_id: head, kind: "comment", body, created_at: at(addDays(t, -daysAgo), "12:10") });
  const y = Number(t.slice(0, 4));

  app({ child: "Каримова Медина Асхатовна", birth: `${y - 2}-05-14`, parent: "Каримова Айжан Ерлановна", daysAgo: 0, status: "new", desired: addDays(t, 20), comment: "Интересует ясельная группа, полный день" });
  app({ child: "Пак Даниил Сергеевич", birth: `${y - 3}-08-02`, parent: "Пак Анна Викторовна", daysAgo: 1, status: "new", desired: addDays(t, 80) });
  app({ child: "Есенова Аружан Маратқызы", birth: `${y - 4}-11-20`, parent: "Есенова Динара Болатовна", daysAgo: 3, status: "new", source: "manual", comment: "Приходили на экскурсию, просят место во второй младшей" });
  app({ child: "Волков Матвей Алексеевич", birth: `${y - 5}-06-30`, parent: "Волкова Ирина Олеговна", daysAgo: 6, status: "new", desired: addDays(t, 45) });
  app({ child: "Жунусов Абылай Нурланович", birth: `${y - 2}-01-15`, parent: "Жунусов Нурлан Ерикович", daysAgo: 9, status: "new" });
  const c1 = app({ child: "Сарсенбаева Томирис Бауыржанқызы", birth: `${y - 3}-03-03`, parent: "Сарсенбаева Гаухар Маратовна", daysAgo: 12, status: "contacted", desired: addDays(t, 85) });
  const c1s = status(c1.id, "contacted", 11);
  comment(c1.id, "Позвонили. Ждут место в первой младшей с января, перезвонить в декабре.", 11);
  const c2 = app({ child: "Лебедева Ева Дмитриевна", birth: `${y - 4}-07-07`, parent: "Лебедев Дмитрий Андреевич", daysAgo: 20, status: "contacted", desired: addDays(t, 20) });
  const c2s = status(c2.id, "contacted", 18);
  comment(c2.id, "Экскурсия в пятницу в 10:00.", 18);
  comment(c2.id, "Понравилось, принесут документы после отпуска.", 13);
  const c3 = app({ child: "Ибраев Ислам Ерикович", birth: `${y - 2}-04-25`, parent: "Ибраева Алия Сериковна", daysAgo: 30, status: "contacted", comment: "Можно звонить в любое время" });
  const c3s = status(c3.id, "contacted", 28);
  comment(c3.id, "Ребёнку пока нет двух лет — перезвонить в ноябре.", 28);
  const d1 = app({ child: "Ким Алиса Олеговна", birth: `${y - 4}-02-11`, parent: "Ким Олег Вячеславович", daysAgo: 40, status: "declined" });
  status(d1.id, "contacted", 38);
  const d1s = status(d1.id, "declined", 33);
  comment(d1.id, "Выбрали сад ближе к дому.", 33);
  const d2 = app({ child: "Мухамедиев Ансар Даниярович", birth: `${y - 3}-09-09`, parent: "Мухамедиева Сауле Кайратовна", daysAgo: 75, status: "declined", desired: null });
  const d2s = status(d2.id, "declined", 70);
  comment(d2.id, "Не подошла стоимость.", 70);

  // Two applications accepted before 1 September — their children are in «Балапан» now.
  const newcomers = w.children.filter((c) => c.group === "balapan" && !c.leave && c.enrolled >= addDays(w.start, 7) && c.family.parents[0] && !c.family.parents[0].staffKey).slice(0, 2);
  const accepted: { id: string; c: Child; when: string }[] = [];
  for (const c of newcomers) {
    const p = c.family.parents[0];
    const acceptedOn = addDays(c.enrolled, -7);
    const a = app({ child: c.name, birth: c.birth, parent: p.name, phone: p.phone, daysAgo: Math.max(1, Math.round((Date.parse(t) - Date.parse(acceptedOn)) / 86400_000) + 21), status: "accepted", desired: c.enrolled });
    status(a.id, "contacted", Math.round((Date.parse(t) - Date.parse(acceptedOn)) / 86400_000) + 14);
    accepted.push({ id: a.id, c, when: at(acceptedOn, "15:00") });
  }

  await insertMany(db, "waitlist_applications", apps);
  await insertMany(db, "waitlist_comments", comments);
  for (const [id, when] of [[c1.id, c1s], [c2.id, c2s], [c3.id, c3s], [d1.id, d1s], [d2.id, d2s]] as const) {
    check(await db.from("waitlist_applications").update({ status_changed_at: when }).eq("id", id), "status time");
  }
  for (const a of accepted) {
    const p = a.c.family.parents[0];
    check(
      await db.from("waitlist_applications").update({ status: "accepted", child_id: a.c.id, parent_user_id: p.id, accepted_by: head, accepted_at: a.when }).eq("id", a.id),
      "accept",
    );
    check(await db.from("waitlist_applications").update({ status_changed_at: a.when }).eq("id", a.id), "accept time");
    // The status trigger wrote the timeline entry «now» without an author: give it the real one.
    check(await db.from("waitlist_comments").update({ author_id: head, created_at: a.when }).eq("application_id", a.id).eq("kind", "status").eq("status", "accepted"), "accept entry");
    audit.push({ kindergarten_id: kg, actor_id: head, action: "waitlist.accept", entity: "waitlist_application", entity_id: a.id, details: { child_id: a.c.id, parent_user_id: p.id, group_id: w.groups.get("balapan")!.id }, created_at: a.when });
  }
  await insertMany(db, "audit_log", audit);
  return { fresh };
}
