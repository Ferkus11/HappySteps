/**
 * Demo dataset «Happy Steps» (SPEC §12): 6 groups, ~120 children, ~25 staff, families, three months of attendance,
 * work time, invoices and receipts, clubs with a queue, the waitlist, announcements, events, chats, documents
 * and notifications. Run with `npm run db:seed` (without --e2e). See docs/demo.md.
 *
 * Idempotent: the demo garden (slug `happy-steps`) and every account of the demo phone range (+7 707 0…) are deleted
 * and created again; e2e fixtures (+7 700/701/702/705…) are never touched. Dates are relative to «today» in the
 * garden's time zone, so re-running the seed before a presentation refreshes the history.
 *
 * Business rules stay in the database: invoices come from invoices_accrue() and their balances/statuses from the
 * FIFO recalculation triggers, club requests and the queue from club_request() called as the parent, attendance rows
 * take their group and absence reasons from the triggers.
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate, formatMoney } from "../../src/lib/format";
import { EMAIL_DOMAIN } from "./lib";
import { DEMO_EMAIL_PREFIX, DEMO_NAME, DEMO_PHONE_PREFIX, DEMO_SLUG, TZ, addDays, at, check, inYear, insertMany, monthStart, pool, uuid } from "./demo-lib";
import { buildWorld, LOGIN_PHONES, type Child, type World } from "./demo-world";
import { seedAttendance, seedHolidays, seedMenus, seedWorktime } from "./demo-daily";
import { seedMoney, type ReceiptInfo } from "./demo-money";
import { seedAnnouncements, seedChats, seedEvents } from "./demo-social";
import { seedClubs, seedDocuments, seedWaitlist } from "./demo-misc";

type Row = Record<string, unknown>;

/** Documented default for a LOCAL stack only (docs/demo.md). Any other stack gets DEMO_PASSWORD or a random one. */
export const LOCAL_DEMO_PASSWORD = "HappySteps2026";

function demoPassword(): { password: string; source: string } {
  const env = process.env.DEMO_PASSWORD?.trim();
  if (env) {
    if (env.length < 8) throw new Error("DEMO_PASSWORD must be at least 8 characters");
    return { password: env, source: "DEMO_PASSWORD" };
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) return { password: LOCAL_DEMO_PASSWORD, source: "default for the local stack" };
  return { password: `Hs-${randomBytes(9).toString("base64url")}`, source: "generated (set DEMO_PASSWORD to choose one)" };
}

// ───────────────────────────── Cleanup ─────────────────────────────
async function cleanup(db: SupabaseClient) {
  const { data: kg } = await db.from("kindergartens").select("id, logo_path").eq("slug", DEMO_SLUG).maybeSingle();
  if (kg) {
    const id = kg.id as string;
    const paths: Record<string, string[]> = {};
    const collect = async (bucket: string, table: string, col: string) => {
      const { data } = await db.from(table).select(col).eq("kindergarten_id", id).not(col, "is", null).limit(10000);
      paths[bucket] = [...(paths[bucket] ?? []), ...((data ?? []) as unknown as Record<string, string>[]).map((r) => r[col])];
    };
    await collect("child-documents", "child_documents", "path");
    await collect("staff-documents", "staff_documents", "path");
    await collect("receipts", "payment_receipts", "file_path");
    await collect("chat-files", "message_files", "path");
    await collect("announcements", "announcement_files", "path");
    await collect("club-photos", "clubs", "photo_path");
    await collect("child-photos", "children", "photo_path");
    if (kg.logo_path) paths["kindergarten-assets"] = [kg.logo_path as string];
    for (const [bucket, list] of Object.entries(paths)) {
      for (let i = 0; i < list.length; i += 100) await db.storage.from(bucket).remove(list.slice(i, i + 100));
    }
    // Invoices/receipts first (children cannot be deleted while they have invoices), then children, then the garden.
    check(await db.from("payment_receipts").delete().eq("kindergarten_id", id), "clear receipts");
    check(await db.from("invoices").delete().eq("kindergarten_id", id), "clear invoices");
    check(await db.from("children").delete().eq("kindergarten_id", id), "clear children");
    check(await db.from("kindergartens").delete().eq("id", id), "delete garden");
  }
  // Every account of the demo phone range (auth users cascade to profiles, memberships, …).
  const ids = new Set<string>();
  const { data: profiles } = await db.from("profiles").select("id").like("phone", `${DEMO_PHONE_PREFIX}%`);
  for (const p of profiles ?? []) ids.add(p.id as string);
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    for (const u of data.users) if (u.email?.startsWith(DEMO_EMAIL_PREFIX) && u.email.endsWith(`@${EMAIL_DOMAIN}`)) ids.add(u.id);
    if (data.users.length < 1000) break;
  }
  await pool([...ids], 8, async (id) => {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error && !/not.?found/i.test(error.message)) throw new Error(`deleteUser ${id}: ${error.message}`);
  });
  return ids.size;
}

// ───────────────────────────── People ─────────────────────────────
interface Account {
  id: string;
  phone: string;
  name: string;
  birth: string | null;
  locale: string;
  created: string;
  activated: boolean;
}

async function createAccounts(db: SupabaseClient, accounts: Account[], password: string) {
  await pool(accounts, 6, async (a) => {
    const email = `${a.phone.replace(/\D/g, "")}@${EMAIL_DOMAIN}`;
    const attrs = { id: a.id, email, password, email_confirm: true, user_metadata: { full_name: a.name, phone: a.phone } };
    let res = await db.auth.admin.createUser(attrs);
    for (let i = 0; i < 5 && res.error && (res.error.status ?? 0) >= 500; i++) {
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
      res = await db.auth.admin.createUser(attrs);
    }
    if (res.error || !res.data.user) throw new Error(`createUser ${a.phone}: ${res.error?.message}`);
    if (res.data.user.id !== a.id) throw new Error(`createUser ${a.phone}: the auth server ignored the requested id`);
  });
  await insertMany(
    db,
    "profiles",
    accounts.map((a) => ({
      id: a.id, full_name: a.name, phone: a.phone, birth_date: a.birth, locale: a.locale,
      activated_at: a.activated ? at(addDays(a.created.slice(0, 10), 1), "20:00") : null, created_at: a.created, updated_at: a.created,
    })),
  );
}

async function seedPeople(db: SupabaseClient, w: World, password: string) {
  const kg = w.kgId;
  const sa = w.s.superadmin;
  const accounts: Account[] = [];
  for (const st of w.staff) accounts.push({ id: st.id, phone: st.phone, name: st.name, birth: st.birth, locale: "ru", created: at(st.hired, "10:00"), activated: true });
  for (const h of w.households) {
    const since = h.children.map((c) => c.enrolled).sort()[0];
    for (const p of h.parents) {
      if (p.staffKey) continue;
      accounts.push({ id: p.id, phone: p.phone, name: p.name, birth: null, locale: p.locale, created: at(addDays(since, -5), "11:00"), activated: p.activated });
    }
  }
  await createAccounts(db, accounts, password);
  check(await db.from("platform_admins").insert({ user_id: sa.id }), "superadmin");

  // The garden (its staff chat comes from a trigger), settings with requisites, subscription.
  check(await db.from("kindergartens").insert({ id: kg, slug: DEMO_SLUG, name: DEMO_NAME, created_at: at(addDays(w.today, -1200), "10:00"), created_by: sa.id }), "garden");
  check(
    await db.from("kindergarten_settings").insert({
      kindergarten_id: kg, timezone: TZ, default_locale: "ru", payment_due_day: 10,
      address: "г. Алматы, мкр. Самал-2, д. 58", phone: "+7 727 355 10 20",
      requisites: { kaspi: "+7 707 000 99 99", iban: "KZ86 722S 0001 2345 6789", bank: "АО «Kaspi Bank»", recipient: "ТОО «Happy Steps Kids»", purpose: "Оплата за детский сад, ФИО ребёнка, месяц" },
    }),
    "settings",
  );
  check(await db.from("subscriptions").insert({ kindergarten_id: kg, plan: "pro", status: "active", current_period_end: addDays(w.today, 200) }), "subscription");

  const memberships: Row[] = [];
  for (const st of w.staff) {
    for (const role of st.roles) {
      if (role === "parent") continue;
      memberships.push({
        id: uuid(), user_id: st.id, kindergarten_id: kg, role, status: st.archivedOn ? "archived" : "active", position: st.position,
        consent_at: at(addDays(st.hired, 1), "09:00"), archived_at: st.archivedOn ? at(st.archivedOn, "18:00") : null, archived_by: st.archivedOn ? w.s.owner.id : null,
        created_at: at(st.hired, "10:00"), created_by: st.key === "owner" ? sa.id : w.s.owner.id,
      });
    }
  }
  for (const h of w.households) {
    const since = h.children.map((c) => c.enrolled).sort()[0];
    for (const p of h.parents) {
      memberships.push({
        id: uuid(), user_id: p.id, kindergarten_id: kg, role: "parent", status: "active", position: null,
        consent_at: p.activated ? at(addDays(since, -4), "20:30") : null, archived_at: null, archived_by: null,
        created_at: at(addDays(since, -5), "11:00"), created_by: w.s.head.id,
      });
    }
  }
  await insertMany(db, "memberships", memberships);

  // Groups (each gets its chat from a trigger) and their teachers.
  let order = 1;
  await insertMany(
    db,
    "groups",
    [...w.groups.values()].map((g) => ({ id: g.id, kindergarten_id: kg, name: g.def.name, age_category: g.def.age, capacity: g.def.capacity, color: g.def.color, sort_order: order++, created_at: at(addDays(w.today, -1100), "10:00") })),
  );
  await insertMany(
    db,
    "group_teachers",
    [...w.groups.values()].flatMap((g) => g.teachers.map((t) => ({ group_id: g.id, user_id: t.id, kindergarten_id: kg }))),
  );

  // Children (the history row comes from a trigger) and guardians.
  await insertMany(
    db,
    "children",
    w.children.map((c) => ({
      id: c.id, kindergarten_id: kg, full_name: c.name, birth_date: c.birth, group_id: w.groups.get(c.group)!.id, enrolled_on: c.enrolled,
      allergies: c.allergies, medical_notes: c.notes, monthly_fee: c.fee, status: "active", created_at: at(addDays(c.enrolled, -3), "12:00"),
    })),
  );
  await insertMany(
    db,
    "child_guardians",
    w.children.flatMap((c) => c.family.parents.map((p) => ({ child_id: c.id, user_id: p.id, kindergarten_id: kg, relation: p.relation, created_at: at(addDays(c.enrolled, -3), "12:05") }))),
  );
  // Moved up a group on 1 September: the stay in the old group ends the day before (SPEC §5.1).
  const audit: Row[] = [];
  for (const c of w.children.filter((x) => x.transfer)) {
    const t = c.transfer!;
    check(
      await db.from("child_group_history").update({ group_id: w.groups.get(t.from)!.id, to_date: addDays(t.date, -1) }).eq("child_id", c.id),
      "history",
    );
    check(await db.from("child_group_history").insert({ kindergarten_id: kg, child_id: c.id, group_id: w.groups.get(c.group)!.id, from_date: t.date, created_at: at(addDays(t.date, -2), "16:00") }), "history");
    audit.push({ kindergarten_id: kg, actor_id: w.s.head.id, action: "child.transfer", entity: "child", entity_id: c.id, details: { from_group: w.groups.get(t.from)!.id, to_group: w.groups.get(c.group)!.id, date: t.date }, created_at: at(addDays(t.date, -2), "16:00") });
  }
  const archivedTeacher = w.staff.find((s) => s.archivedOn);
  if (archivedTeacher) audit.push({ kindergarten_id: kg, actor_id: w.s.owner.id, action: "account.archive", entity: "membership", entity_id: archivedTeacher.id, details: { user_id: archivedTeacher.id, role: "teacher", name: archivedTeacher.name }, created_at: at(archivedTeacher.archivedOn!, "18:00") });
  await insertMany(db, "audit_log", audit);
}

/** Archive a child who left (as the «В архив» action would), with the real date and reason. */
async function archiveChild(db: SupabaseClient, w: World, c: Child) {
  const leave = c.leave!;
  const when = at(leave.date, "17:30");
  check(await db.from("children").update({ status: "archived", archive_reason: leave.reason, archived_at: when }).eq("id", c.id), "archive");
  // The trigger closes the stay «today»; the child really left on the leave date.
  check(await db.from("child_group_history").update({ to_date: leave.date }).eq("child_id", c.id).gt("to_date", leave.date), "history end");
  check(
    await db.from("memberships").update({ archived_at: when, archived_by: w.s.head.id }).eq("kindergarten_id", w.kgId).eq("role", "parent").eq("status", "archived").in("user_id", c.family.parents.map((p) => p.id)),
    "parents archived",
  );
  check(await db.from("audit_log").insert({ kindergarten_id: w.kgId, actor_id: w.s.head.id, action: "child.archive", entity: "child", entity_id: c.id, details: { reason: leave.reason }, created_at: when }), "audit");
}

// ───────────────────────────── Notifications (the bell) ─────────────────────────────
interface NotifyCtx {
  receipts: ReceiptInfo[];
  current: { child: Child; from: string; to: string; reason: string }[];
  autoClosed: { staff: { id: string }; date: string; end: string }[];
  expiring: { staff: { id: string; name: string; key: string }; title: string; expires: string }[];
  announcements: { id: string; title: string; created: string; aud: string[]; readers: Set<string> }[];
  messages: { id: string; chat: string; author: { id: string; name: string }; body: string; at: string; to: string[] }[];
  clubs: { club: string; clubId: string; child: Child; status: string; teacher: string; created: string }[];
  waitlist: { id: string; child: string; parent: string; created: string }[];
}

async function seedNotifications(db: SupabaseClient, w: World, n: NotifyCtx) {
  const kg = w.kgId;
  const now = Date.now();
  const rows: Row[] = [];
  const add = (user: string, type: string, params: Row, url: string, created: string, read: boolean) => {
    const t = Date.parse(created);
    rows.push({
      id: uuid(), kindergarten_id: kg, user_id: user, type, params, url, created_at: created,
      read_at: read ? new Date(Math.min(now - 60_000, t + 20 * 60_000)).toISOString() : null,
      // handled: nothing is pushed for history
      pushed_at: created, deliver_after: null,
    });
  };
  const old = (iso: string, hours: number) => now - Date.parse(iso) > hours * 3600_000;
  const heads = [w.s.head.id];
  const accountants = [w.s.accountant.id, w.s.admin2.id];
  const recentFrom = monthStart(w.today, -1);

  for (const a of n.waitlist) for (const u of [...heads, w.s.owner.id]) add(u, "waitlist.new", { child: a.child, parent: a.parent }, `/waitlist/${a.id}`, a.created, false);
  for (const r of n.clubs) {
    for (const u of [...heads, r.teacher]) add(u, "club.request", { club: r.club, child: r.child.name, status: r.status }, `/clubs/${r.clubId}`, r.created, u === w.s.head.id && r.status === "queued");
    if (r.status === "queued") for (const p of r.child.family.parents) add(p.id, "club.decision", { club: r.club, child: r.child.name, status: "queued" }, `/clubs/${r.clubId}?child=${r.child.id}`, r.created, true);
  }
  for (const r of n.receipts) {
    if (r.status === "pending") {
      for (const u of accountants) add(u, "receipt.new", { child: r.child.name, amount: formatMoney(r.due), month: r.period.slice(0, 7) }, "/payments?tab=review", r.created, old(r.created, 30));
    } else if (r.reviewed && r.period >= recentFrom) {
      for (const p of r.child.family.parents) {
        const params = r.status === "accepted" ? { month: r.period.slice(0, 7), amount: formatMoney(r.amount) } : { month: r.period.slice(0, 7), reason: r.reason };
        add(p.id, r.status === "accepted" ? "receipt.accepted" : "receipt.rejected", params, "/payments", r.reviewed, old(r.reviewed, 20));
      }
    }
  }
  for (const a of n.current) {
    const g = w.groups.get(a.child.group)!;
    const period = a.from === a.to ? formatDate(a.from) : `${formatDate(a.from)} — ${formatDate(a.to)}`;
    for (const t of g.teachers) add(t.id, "absence.reported", { child: a.child.name, reason: a.reason, period }, `/attendance?group=${g.id}`, new Date(Math.min(now - 600_000, Date.parse(at(a.from <= w.today ? w.today : addDays(w.today, -1), "07:40")))).toISOString(), a.child.group !== "zhuldyz");
  }
  for (const d of n.expiring) {
    const params = { person: d.staff.name, document: d.title, date: formatDate(d.expires) };
    const due = addDays(d.expires, d.expires <= addDays(w.today, 7) ? -7 : -30);
    add(d.staff.id, "document.expiring", params, "/documents", at(due, "09:00"), d.staff.key !== "teacher");
    for (const h of heads) add(h, "document.expiring", params, `/documents/staff/${d.staff.id}`, at(due, "09:00"), d.expires > addDays(w.today, 7));
  }
  for (const a of n.autoClosed.filter((x) => x.date >= addDays(w.today, -21))) {
    add(a.staff.id, "worktime.auto_closed", { date: formatDate(a.date), time: a.end }, "/worktime", at(addDays(a.date, 0), "19:10"), true);
  }
  for (const a of n.announcements.slice(0, 4)) {
    for (const u of a.aud) add(u, "announcement.new", { title: a.title }, `/announcements/${a.id}`, a.created, a.readers.has(u));
  }
  for (const m of n.messages) {
    const fresh = !old(m.at, 6);
    for (const u of m.to) add(u, "message.new", { from: m.author.name, text: m.body.length > 100 ? `${m.body.slice(0, 99)}…` : m.body, message_id: m.id }, `/chats/${m.chat}`, m.at, !fresh);
  }
  // Today's «group not marked» reminder for the demo teacher (after the reminder time on a working day).
  if (w.workingDays.includes(w.today) && w.nowMin >= 10 * 60) {
    add(w.s.teacher.id, "attendance.not_marked", { group: w.groups.get("zhuldyz")!.def.name }, `/attendance?group=${w.groups.get("zhuldyz")!.id}`, at(w.today, "10:00"), false);
  }
  await insertMany(db, "notifications", rows, 1000);
  return rows.length;
}

// ───────────────────────────── Main ─────────────────────────────
export async function seedDemo(db: SupabaseClient) {
  const t0 = Date.now();
  const { password, source } = demoPassword();
  const log = (s: string) => console.log(`  · ${s} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  const removed = await cleanup(db);
  log(`cleanup: previous demo removed, ${removed} demo accounts deleted`);

  const w = buildWorld();
  // Birthdays this week (calendar and the teacher's dashboard): a child of «Жұлдыз», a toddler and the head.
  const zh = w.children.find((c) => c.group === "zhuldyz" && !c.leave && c.family !== w.demoParent);
  if (zh) zh.birth = inYear(addDays(w.today, 2), Number(zh.birth.slice(0, 4)));
  const bal = w.children.find((c) => c.group === "balapan" && !c.leave && !c.transfer && c.enrolled < addDays(w.today, -30));
  if (bal) bal.birth = inYear(addDays(w.today, 5), Number(bal.birth.slice(0, 4)));
  w.s.head.birth = inYear(addDays(w.today, 4), 1979);

  await seedPeople(db, w, password);
  log(`people: ${w.staff.length} staff, ${w.parents.length} parents, ${w.children.length} children`);
  await seedHolidays(db, w);
  await seedMenus(db, w);
  const att = await seedAttendance(db, w);
  log("attendance and menus");
  const wt = await seedWorktime(db, w);
  log("work time");
  const receipts = await seedMoney(db, w, (c) => archiveChild(db, w, c));
  log(`invoices and ${receipts.length} receipts`);
  const expiring = await seedDocuments(db, w, att.recentSick);
  log("documents");
  const clubs = await seedClubs(db, w, password);
  log("clubs");
  const waitlist = await seedWaitlist(db, w);
  const announcements = await seedAnnouncements(db, w);
  await seedEvents(db, w);
  const messages = await seedChats(db, w);
  log("waitlist, announcements, events, chats");
  const notifications = await seedNotifications(db, w, {
    receipts, current: att.current, autoClosed: wt.autoClosed, expiring, announcements, messages, clubs: clubs.requests, waitlist: waitlist.fresh,
  });
  log(`${notifications} notifications`);

  const count = async (table: string) => {
    const { count: n } = await db.from(table).select("*", { count: "exact", head: true }).eq("kindergarten_id", w.kgId);
    return n ?? 0;
  };
  const [att_, inv, debt] = await Promise.all([
    count("child_attendance"),
    count("invoices"),
    db.rpc("payment_debtors", { p_kg: w.kgId }),
  ]);
  const active = w.children.filter((c) => !c.leave).length;
  console.log(`
Happy Steps demo is ready — ${((Date.now() - t0) / 1000).toFixed(0)} s
  garden: «${DEMO_NAME}» (slug ${DEMO_SLUG}), ${w.groups.size} groups, ${active} active children (+${w.children.length - active} archived),
          ${w.staff.filter((s) => s.roles.length).length} staff, ${w.parents.length} parent accounts
  history: ${w.start} … ${w.today}: ${att_} attendance marks, ${inv} invoices, ${receipts.length} receipts, ${(debt.data as unknown[] | null)?.length ?? 0} debtors

  Password for every demo account: ${password}   (${source})
  Logins:`);
  const roles: [keyof typeof LOGIN_PHONES, string][] = [
    ["superadmin", "суперадмин"], ["owner", "владелец"], ["head", "заведующая"], ["accountant", "бухгалтер"], ["teacher", "воспитатель"],
    ["clubTeacher", "педагог кружка"], ["cook", "повар"], ["parent", "родитель"], ["teacherParent", "воспитатель + родитель"],
  ];
  for (const [k, label] of roles) console.log(`    ${label.padEnd(24)} ${LOGIN_PHONES[k]}`);
  console.log("  Details: docs/demo.md\n");
}
