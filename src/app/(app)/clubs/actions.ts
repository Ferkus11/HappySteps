"use server";

import { z } from "zod";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { memberIds, notify } from "@/lib/notify";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeSchedule, scheduleValid, type EnrollmentStatus } from "@/lib/clubs";
import { zOptionalText, zTime, zUuid } from "@/lib/validation";

const scheduleItem = z.object({ day: z.coerce.number().int().min(1).max(7), start: zTime, end: zTime });

const clubSchema = z
  .object({
    name: z.string().trim().min(2, "tooShort").max(80, "tooLong"),
    description: zOptionalText(2000),
    teacherId: zUuid.nullable().or(z.literal("").transform(() => null)),
    ageFrom: z.coerce.number({ message: "numberInvalid" }).int("numberInvalid").min(0, "numberInvalid").max(17, "numberInvalid"),
    ageTo: z.coerce.number({ message: "numberInvalid" }).int("numberInvalid").min(0, "numberInvalid").max(17, "numberInvalid"),
    schedule: z.array(scheduleItem).max(14, "tooLong"),
    place: zOptionalText(120),
    capacity: z.coerce.number({ message: "numberInvalid" }).int("numberInvalid").min(1, "numberInvalid").max(200, "numberInvalid"),
  })
  .refine((v) => v.ageTo >= v.ageFrom, { path: ["ageTo"], message: "clubAgeRange" })
  .transform((v) => ({ ...v, schedule: normalizeSchedule(v.schedule.map((s) => ({ ...s, start: s.start.slice(0, 5), end: s.end.slice(0, 5) }))) }))
  .refine((v) => scheduleValid(v.schedule), { path: ["schedule"], message: "clubScheduleInvalid" });

interface TransitionResult {
  id: string;
  club_id: string;
  child_id: string;
  status: EnrollmentStatus;
  position: number | null;
  freed: boolean;
  queued: number;
}

/** Heads of the garden get club notifications; when there is none — the owners. */
async function adminRecipients(kg: string) {
  const heads = await memberIds(kg, ["head"]);
  return heads.length ? heads : memberIds(kg, ["owner"]);
}

/** Names for notification texts + guardians (active parents) of the child. Service role: only after a successful, permission-checked transition. */
async function names(kg: string, clubId: string, childId: string) {
  const db = createServiceClient();
  const [{ data: club }, { data: child }, { data: guardians }] = await Promise.all([
    db.from("clubs").select("name, teacher_id").eq("id", clubId).eq("kindergarten_id", kg).single(),
    db.from("children").select("full_name").eq("id", childId).eq("kindergarten_id", kg).single(),
    db.from("child_guardians").select("user_id").eq("child_id", childId).eq("kindergarten_id", kg),
  ]);
  const parents = await memberIds(kg, ["parent"]);
  return {
    club: (club?.name as string) ?? "",
    teacherId: (club?.teacher_id as string | null) ?? null,
    child: (child?.full_name as string) ?? "",
    guardians: (guardians ?? []).map((g) => g.user_id as string).filter((id) => parents.includes(id)),
  };
}

async function spotFree(kg: string, r: TransitionResult, clubName: string) {
  if (r.freed && r.queued > 0) {
    await notify({ kindergartenId: kg, userIds: await adminRecipients(kg), type: "club.spot_free", params: { club: clubName, count: r.queued }, url: `/clubs/${r.club_id}` });
  }
}

async function decision(kg: string, r: TransitionResult) {
  const n = await names(kg, r.club_id, r.child_id);
  await notify({ kindergartenId: kg, userIds: n.guardians, type: "club.decision", params: { club: n.club, child: n.child, status: r.status }, url: `/clubs/${r.club_id}?child=${r.child_id}` });
  return n;
}

// ───────────────────────────── Catalog (owner / head) ─────────────────────────────

export async function saveClubAction(id: string | null, input: z.input<typeof clubSchema>) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    if (id) zUuid.parse(id);
    const v = parse(clubSchema, input);
    const row = {
      name: v.name,
      description: v.description,
      teacher_id: v.teacherId,
      age_from: v.ageFrom,
      age_to: v.ageTo,
      schedule: v.schedule,
      place: v.place,
      capacity: v.capacity,
    };
    if (!id) {
      const created = check(await supabase.from("clubs").insert({ ...row, kindergarten_id: ctx.kg.id }).select("id").single());
      return { id: created.id as string };
    }
    const before = check(await supabase.from("clubs").select("capacity").eq("id", id).eq("kindergarten_id", ctx.kg.id).maybeSingle());
    if (!before) throw new ActionError("notFound");
    const upd = check(await supabase.from("clubs").update(row).eq("id", id).eq("kindergarten_id", ctx.kg.id).select("id"));
    if (!upd.length) throw new ActionError("forbidden");
    if (v.capacity > (before.capacity as number)) {
      // more places: if children are waiting, the head decides who comes in
      const { data: stats } = await supabase.rpc("club_stats", { p_kg: ctx.kg.id });
      const s = ((stats ?? []) as { club_id: string; free: number; queued: number }[]).find((x) => x.club_id === id);
      if (s) await spotFree(ctx.kg.id, { id, club_id: id, child_id: "", status: "active", position: null, freed: s.free > 0, queued: s.queued }, v.name);
    }
    return { id };
  });
}

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function uploadClubPhotoAction(id: string, form: FormData) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(id);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("invalid");
    if (file.size > 5 * 1024 * 1024) throw new ActionError("photoTooLarge");
    if (!PHOTO_TYPES.includes(file.type)) throw new ActionError("fileType");
    const club = check(await supabase.from("clubs").select("id, photo_path").eq("id", id).eq("kindergarten_id", ctx.kg.id).maybeSingle());
    if (!club) throw new ActionError("notFound");
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${ctx.kg.id}/clubs/${id}-${crypto.randomUUID()}.${ext}`;
    const service = createServiceClient();
    const up = await service.storage.from("club-photos").upload(path, file, { contentType: file.type });
    if (up.error) throw new ActionError("generic");
    // RLS-checked: the update succeeds only for owner/head of this garden.
    const upd = await supabase.from("clubs").update({ photo_path: path }).eq("id", id).select("id");
    if (upd.error || !upd.data?.length) {
      await service.storage.from("club-photos").remove([path]);
      throw new ActionError("forbidden");
    }
    if (club.photo_path) await service.storage.from("club-photos").remove([club.photo_path as string]);
  });
}

export async function removeClubPhotoAction(id: string) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(id);
    const club = check(await supabase.from("clubs").select("id, photo_path").eq("id", id).eq("kindergarten_id", ctx.kg.id).maybeSingle());
    if (!club) throw new ActionError("notFound");
    const upd = check(await supabase.from("clubs").update({ photo_path: null }).eq("id", id).select("id"));
    if (!upd.length) throw new ActionError("forbidden");
    if (club.photo_path) await createServiceClient().storage.from("club-photos").remove([club.photo_path as string]);
  });
}

export async function deleteClubAction(id: string) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(id);
    const club = check(await supabase.from("clubs").select("id, name, photo_path").eq("id", id).eq("kindergarten_id", ctx.kg.id).maybeSingle());
    if (!club) throw new ActionError("notFound");
    const { data: open } = await supabase.from("club_enrollments").select("child_id, status").eq("club_id", id).in("status", ["requested", "queued", "active"]);
    const families = await Promise.all((open ?? []).map((e) => names(ctx.kg.id, id, e.child_id as string)));
    const del = check(await supabase.from("clubs").delete().eq("id", id).eq("kindergarten_id", ctx.kg.id).select("id"));
    if (!del.length) throw new ActionError("forbidden");
    await audit(supabase, ctx.kg.id, "club.delete", "club", id, { name: club.name, children: (open ?? []).filter((e) => e.status === "active").length });
    if (club.photo_path) await createServiceClient().storage.from("club-photos").remove([club.photo_path as string]);
    // tell the families whose children attended, waited or asked
    for (const n of families) {
      await notify({ kindergartenId: ctx.kg.id, userIds: n.guardians, type: "club.decision", params: { club: club.name as string, child: n.child, status: "closed" }, url: "/clubs" });
    }
  });
}

// ───────────────────────────── Enrolment ─────────────────────────────

export async function requestClubAction(clubId: string, childId: string) {
  return kgAction(["parent"], async (ctx, supabase) => {
    zUuid.parse(clubId);
    zUuid.parse(childId);
    const r = check(await supabase.rpc("club_request", { p_club: clubId, p_child: childId })) as unknown as TransitionResult;
    const n = await names(ctx.kg.id, r.club_id, r.child_id);
    const teacher = n.teacherId && (await memberIds(ctx.kg.id, ["club_teacher"])).includes(n.teacherId) ? [n.teacherId] : [];
    await notify({
      kindergartenId: ctx.kg.id,
      userIds: [...(await adminRecipients(ctx.kg.id)), ...teacher],
      type: "club.request",
      params: { club: n.club, child: n.child, status: r.status },
      url: `/clubs/${r.club_id}`,
    });
    return { status: r.status, position: r.position };
  });
}

export async function confirmClubAction(enrollmentId: string) {
  return kgAction(["owner", "head", "club_teacher"], async (ctx, supabase) => {
    zUuid.parse(enrollmentId);
    const r = check(await supabase.rpc("club_confirm", { p_enrollment: enrollmentId })) as unknown as TransitionResult;
    await decision(ctx.kg.id, r);
    return { status: r.status, position: r.position };
  });
}

const reasonSchema = zOptionalText(500);

export async function rejectClubAction(enrollmentId: string, reason?: string) {
  return kgAction(["owner", "head", "club_teacher"], async (ctx, supabase) => {
    zUuid.parse(enrollmentId);
    const why = parse(reasonSchema, reason ?? "");
    const r = check(await supabase.rpc("club_reject", { p_enrollment: enrollmentId, p_reason: why })) as unknown as TransitionResult;
    await decision(ctx.kg.id, r);
  });
}

export async function excludeClubAction(enrollmentId: string, reason?: string) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(enrollmentId);
    const why = parse(reasonSchema, reason ?? "");
    // audited inside SQL (club.exclude)
    const r = check(await supabase.rpc("club_exclude", { p_enrollment: enrollmentId, p_reason: why })) as unknown as TransitionResult;
    const n = await decision(ctx.kg.id, r);
    await spotFree(ctx.kg.id, r, n.club);
  });
}

export async function leaveClubAction(enrollmentId: string) {
  return kgAction(["parent"], async (ctx, supabase) => {
    zUuid.parse(enrollmentId);
    const r = check(await supabase.rpc("club_leave", { p_enrollment: enrollmentId })) as unknown as TransitionResult;
    if (r.freed && r.queued > 0) {
      const n = await names(ctx.kg.id, r.club_id, r.child_id);
      await spotFree(ctx.kg.id, r, n.club);
    }
  });
}
