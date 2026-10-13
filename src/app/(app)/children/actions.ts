"use server";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { KgContext } from "@/lib/auth/context";
import { commitUpload, prepareUpload, removeObject, type PreparedUpload } from "@/lib/uploads";
import { UPLOAD_SPECS, type DeclaredFile } from "@/lib/uploads-core";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { groupOverCapacity, insertChild, linkParent, type ParentInviteResult } from "@/lib/children";
import { createServiceClient } from "@/lib/supabase/service";
import { zDate, zMoney, zName, zOptionalText, zPhone, zUuid } from "@/lib/validation";
import { activeClubsOf, notifyFreedClubs } from "@/lib/clubs-notify";

const parentSchema = z.object({ fullName: zName, phone: zPhone, relation: zOptionalText(40) });

const childSchema = z.object({
  fullName: zName,
  birthDate: zDate,
  groupId: zUuid.nullable().or(z.literal("").transform(() => null)),
  enrolledOn: zDate,
  monthlyFee: zMoney,
  allergies: zOptionalText(500),
  medicalNotes: zOptionalText(2000),
});

const createSchema = childSchema.extend({
  parents: z.array(parentSchema).max(4).default([]),
  confirmOverCapacity: z.boolean().default(false),
});

export type { ParentInviteResult };

export async function createChildAction(input: z.input<typeof createSchema>) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    const v = parse(createSchema, input);
    if (!v.confirmOverCapacity) {
      const over = await groupOverCapacity(supabase, v.groupId);
      if (over) return { needsConfirm: over } as const;
    }
    const childId = await insertChild(supabase, ctx.kg.id, v);
    const invites: ParentInviteResult[] = [];
    for (const p of v.parents) {
      const { name, existed, invite } = await linkParent(supabase, ctx.userId, ctx.kg.id, childId, p);
      invites.push({ name, existed, invite });
    }
    return { id: childId, invites };
  });
}

export async function addGuardianAction(childId: string, input: z.input<typeof parentSchema>) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(childId);
    const v = parse(parentSchema, input);
    const { data: child } = await supabase.from("children").select("id").eq("id", childId).eq("kindergarten_id", ctx.kg.id).maybeSingle();
    if (!child) throw new ActionError("notFound");
    const { name, existed, invite } = await linkParent(supabase, ctx.userId, ctx.kg.id, childId, v);
    return { name, existed, invite } satisfies ParentInviteResult;
  });
}

export async function unlinkGuardianAction(childId: string, userId: string) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(childId);
    zUuid.parse(userId);
    const removed = check(
      await supabase.from("child_guardians").delete().eq("child_id", childId).eq("user_id", userId).eq("kindergarten_id", ctx.kg.id).select("user_id"),
    );
    if (!removed.length) throw new ActionError("notFound");
    await audit(supabase, ctx.kg.id, "guardian.unlink", "child", childId, { parent: userId });
    // No active children left in this kindergarten → archive the parent membership (SPEC §4).
    const service = createServiceClient();
    const { data: rest } = await service
      .from("child_guardians")
      .select("child_id, children!inner(status)")
      .eq("user_id", userId)
      .eq("kindergarten_id", ctx.kg.id)
      .eq("children.status", "active");
    if (!rest?.length) {
      await supabase
        .from("memberships")
        .update({ status: "archived", archived_at: new Date().toISOString(), archived_by: ctx.userId })
        .eq("user_id", userId)
        .eq("kindergarten_id", ctx.kg.id)
        .eq("role", "parent");
    }
  });
}

export async function updateChildAction(id: string, input: z.input<typeof childSchema>) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(id);
    const v = parse(childSchema.omit({ groupId: true }), input);
    const { data: before } = await supabase.from("children").select("monthly_fee").eq("id", id).single();
    check(
      await supabase
        .from("children")
        .update({
          full_name: v.fullName,
          birth_date: v.birthDate,
          enrolled_on: v.enrolledOn,
          monthly_fee: v.monthlyFee,
          allergies: v.allergies,
          medical_notes: v.medicalNotes,
        })
        .eq("id", id)
        .eq("kindergarten_id", ctx.kg.id),
    );
    if (before && Number(before.monthly_fee) !== v.monthlyFee) {
      await audit(supabase, ctx.kg.id, "child.fee_change", "child", id, { from: Number(before.monthly_fee), to: v.monthlyFee });
    }
  });
}

export async function transferChildAction(id: string, groupId: string, date: string) {
  return kgAction(["owner", "head"], async (_ctx, supabase) => {
    zUuid.parse(id);
    zUuid.parse(groupId);
    zDate.parse(date);
    check(await supabase.rpc("transfer_child", { p_child: id, p_group: groupId, p_date: date }));
  });
}

const reasons = ["moved", "school", "other_kindergarten", "family", "health", "other"] as const;

export async function archiveChildAction(id: string, reason: (typeof reasons)[number]) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(id);
    z.enum(reasons).parse(reason);
    // Clubs: the archive trigger releases the child's places — tell the head where a queue is waiting (SPEC §5.10).
    const clubs = await activeClubsOf(supabase, ctx.kg.id, id);
    check(
      await supabase
        .from("children")
        .update({ status: "archived", archive_reason: reason, archived_at: new Date().toISOString() })
        .eq("id", id)
        .eq("kindergarten_id", ctx.kg.id),
    );
    await audit(supabase, ctx.kg.id, "child.archive", "child", id, { reason });
    await notifyFreedClubs(supabase, ctx.kg.id, clubs);
  });
}

export async function restoreChildAction(id: string) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(id);
    check(
      await supabase
        .from("children")
        .update({ status: "active", archive_reason: null, archived_at: null })
        .eq("id", id)
        .eq("kindergarten_id", ctx.kg.id),
    );
    await audit(supabase, ctx.kg.id, "child.restore", "child", id);
  });
}

const PHOTO_BUCKET = UPLOAD_SPECS.childPhoto.bucket;
const photoPrefix = (kgId: string, childId: string) => `${kgId}/${childId}/`;

/** Owner/head and a child of this garden (RLS-checked read). */
async function photoChild(ctx: KgContext, supabase: SupabaseClient, id: string) {
  const { data: child } = await supabase.from("children").select("id, photo_path").eq("id", id).eq("kindergarten_id", ctx.kg.id).maybeSingle();
  if (!child) throw new ActionError("notFound");
  return child;
}

/** Step A of a child photo upload (D-035): checks, limits, signed upload URL for a server-chosen path. */
export async function prepareChildPhotoAction(id: string, file: DeclaredFile) {
  return kgAction(["owner", "head"], async (ctx, supabase): Promise<PreparedUpload> => {
    zUuid.parse(id);
    await photoChild(ctx, supabase, id);
    const prefix = photoPrefix(ctx.kg.id, id);
    return prepareUpload("childPhoto", ctx, { target: id, prefix, file, path: (ext, uid) => `${prefix}photo-${uid}.${ext}` });
  });
}

/** Step C: verifies the uploaded photo and makes it the child's photo (the old one is removed). */
export async function commitChildPhotoAction(id: string, ticket: string) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(id);
    const child = await photoChild(ctx, supabase, id);
    const file = await commitUpload("childPhoto", ctx, ticket, { target: id, prefix: photoPrefix(ctx.kg.id, id) });
    if (child.photo_path === file.path) return; // the same upload committed twice
    // RLS-checked: the update succeeds only for admins of this kindergarten.
    const upd = await supabase.from("children").update({ photo_path: file.path }).eq("id", id).select("id");
    if (upd.error || !upd.data?.length) {
      await removeObject(PHOTO_BUCKET, file.path);
      throw new ActionError("forbidden");
    }
    if (child.photo_path) await removeObject(PHOTO_BUCKET, child.photo_path);
  });
}
