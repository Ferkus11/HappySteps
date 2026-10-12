"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { createServiceClient } from "@/lib/supabase/service";
import { AUDIENCES, assertTargets, syncGroups } from "@/lib/audience";
import { zUuid } from "@/lib/validation";

const BUCKET = "announcements";
const MAX_FILE = 15 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const schema = z.object({
  title: z.string().trim().min(1, "required").max(200, "tooLong"),
  body: z.string().max(10000, "tooLong").default(""),
  audience: z.enum(AUDIENCES),
  groupIds: z.array(zUuid).max(100).default([]),
  important: z.boolean().default(false),
});

export type AnnouncementInput = z.input<typeof schema>;

async function audienceIds(supabase: SupabaseClient, id: string, unreadOnly = false) {
  const { data } = await supabase.rpc("announcement_audience", { p_id: id });
  return ((data ?? []) as { user_id: string; read_at: string | null }[]).filter((r) => !unreadOnly || !r.read_at).map((r) => r.user_id);
}

export async function createAnnouncementAction(input: AnnouncementInput) {
  return kgAction(["owner", "head", "teacher"], async (ctx, supabase) => {
    const v = parse(schema, input);
    const groupIds = await assertTargets(supabase, ctx, v.audience, v.groupIds);
    const row = check(
      await supabase
        .from("announcements")
        .insert({ kindergarten_id: ctx.kg.id, author_id: ctx.userId, audience: v.audience, title: v.title, body: v.body.trim(), important: v.important })
        .select("id")
        .single(),
    );
    const id = row.id as string;
    try {
      await syncGroups(supabase, "announcement_groups", "announcement_id", id, ctx.kg.id, groupIds);
    } catch (e) {
      await supabase.from("announcements").delete().eq("id", id);
      throw e;
    }
    await notify({
      kindergartenId: ctx.kg.id,
      userIds: (await audienceIds(supabase, id)).filter((u) => u !== ctx.userId),
      type: "announcement.new",
      params: { title: v.title },
      url: `/announcements/${id}`,
    });
    return { id };
  });
}

export async function updateAnnouncementAction(id: string, input: AnnouncementInput) {
  return kgAction(["owner", "head", "teacher"], async (ctx, supabase) => {
    zUuid.parse(id);
    const v = parse(schema, input);
    const groupIds = await assertTargets(supabase, ctx, v.audience, v.groupIds);
    const updated = check(
      await supabase
        .from("announcements")
        .update({ audience: v.audience, title: v.title, body: v.body.trim(), important: v.important })
        .eq("id", id)
        .eq("kindergarten_id", ctx.kg.id)
        .select("id"),
    );
    if (!updated.length) throw new ActionError("forbidden");
    await syncGroups(supabase, "announcement_groups", "announcement_id", id, ctx.kg.id, groupIds);
    return { id };
  });
}

export async function deleteAnnouncementAction(id: string) {
  return kgAction(["owner", "head", "teacher"], async (ctx, supabase) => {
    zUuid.parse(id);
    const { data: files } = await supabase.from("announcement_files").select("path").eq("announcement_id", id);
    const deleted = check(await supabase.from("announcements").delete().eq("id", id).eq("kindergarten_id", ctx.kg.id).select("id, title"));
    if (!deleted.length) throw new ActionError("forbidden");
    const paths = (files ?? []).map((f) => f.path as string);
    if (paths.length) await createServiceClient().storage.from(BUCKET).remove(paths);
    await audit(supabase, ctx.kg.id, "announcement.delete", "announcement", id, { title: deleted[0].title, files: paths.length });
  });
}

/** Uploads one photo or PDF (called once per file so each request stays under the body limit). */
export async function uploadAnnouncementFileAction(id: string, form: FormData) {
  return kgAction(["owner", "head", "teacher"], async (ctx, supabase) => {
    zUuid.parse(id);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("invalid");
    if (file.size > MAX_FILE) throw new ActionError("fileTooLarge");
    const isPdf = file.type === "application/pdf";
    const ext = isPdf ? "pdf" : PHOTO_TYPES[file.type];
    if (!ext) throw new ActionError("fileType");
    const { data: ok } = await supabase.rpc("announcement_manageable", { a: id });
    if (!ok) throw new ActionError("forbidden");
    const path = `${ctx.kg.id}/${id}/${randomUUID()}.${ext}`;
    const service = createServiceClient();
    const up = await service.storage.from(BUCKET).upload(path, file, { contentType: file.type });
    if (up.error) throw new ActionError("generic");
    const name = (file.name || `file.${ext}`).slice(0, 200);
    // Permission checked above (announcement_manageable); rows are written by the server only.
    const ins = await service
      .from("announcement_files")
      .insert({ announcement_id: id, kindergarten_id: ctx.kg.id, kind: isPdf ? "pdf" : "photo", path, name, mime: file.type, size: file.size });
    if (ins.error) {
      await service.storage.from(BUCKET).remove([path]);
      check(ins);
    }
  });
}

export async function removeAnnouncementFileAction(fileId: string) {
  return kgAction(["owner", "head", "teacher"], async (ctx, supabase) => {
    zUuid.parse(fileId);
    const removed = check(await supabase.from("announcement_files").delete().eq("id", fileId).eq("kindergarten_id", ctx.kg.id).select("path"));
    if (!removed.length) throw new ActionError("forbidden");
    await createServiceClient().storage.from(BUCKET).remove(removed.map((r) => r.path as string));
  });
}

/** Marks the announcement read for the current user (RLS: only own read of a visible announcement). */
export async function markAnnouncementReadAction(id: string) {
  return kgAction(null, async (ctx, supabase) => {
    zUuid.parse(id);
    check(
      await supabase
        .from("announcement_reads")
        .upsert({ announcement_id: id, user_id: ctx.userId, kindergarten_id: ctx.kg.id }, { onConflict: "announcement_id,user_id", ignoreDuplicates: true }),
    );
  });
}

/** "Напомнить": notifies recipients who have not read it yet; at most once per hour. */
export async function remindAnnouncementAction(id: string) {
  return kgAction(["owner", "head", "teacher"], async (ctx, supabase) => {
    zUuid.parse(id);
    const { data: a } = await supabase.from("announcements").select("id, title").eq("id", id).eq("kindergarten_id", ctx.kg.id).maybeSingle();
    if (!a) throw new ActionError("notFound");
    const claimed = check(await supabase.rpc("claim_announcement_reminder", { p_id: id }));
    if (claimed !== true) throw new ActionError("reminderTooSoon");
    const unread = await audienceIds(supabase, id, true);
    await notify({ kindergartenId: ctx.kg.id, userIds: unread, type: "announcement.reminder", params: { title: a.title }, url: `/announcements/${id}` });
    return { count: unread.length };
  });
}
