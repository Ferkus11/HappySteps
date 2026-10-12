"use server";

import { z } from "zod";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { addPersonToKindergarten, type InviteLink } from "@/lib/people";
import { createServiceClient } from "@/lib/supabase/service";
import { zDate, zMoney, zName, zOptionalText, zPhone, zUuid } from "@/lib/validation";

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

export interface ParentInviteResult {
  name: string;
  existed: boolean;
  invite: InviteLink | null;
}

export async function createChildAction(input: z.input<typeof createSchema>) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    const v = parse(createSchema, input);
    if (v.groupId && !v.confirmOverCapacity) {
      const [{ data: g }, { count }] = await Promise.all([
        supabase.from("groups").select("name, capacity").eq("id", v.groupId).single(),
        supabase.from("children").select("id", { count: "exact", head: true }).eq("group_id", v.groupId).eq("status", "active"),
      ]);
      if (g && (count ?? 0) >= g.capacity) {
        return { needsConfirm: { group: g.name as string, count: count ?? 0, capacity: g.capacity as number } } as const;
      }
    }
    const child = check(
      await supabase
        .from("children")
        .insert({
          kindergarten_id: ctx.kg.id,
          full_name: v.fullName,
          birth_date: v.birthDate,
          group_id: v.groupId,
          enrolled_on: v.enrolledOn,
          monthly_fee: v.monthlyFee,
          allergies: v.allergies,
          medical_notes: v.medicalNotes,
        })
        .select("id")
        .single(),
    );
    await audit(supabase, ctx.kg.id, "child.create", "child", child.id, { name: v.fullName });
    const invites: ParentInviteResult[] = [];
    for (const p of v.parents) {
      invites.push(await linkParent(supabase, ctx.userId, ctx.kg.id, child.id, p));
    }
    return { id: child.id as string, invites };
  });
}

async function linkParent(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  actorId: string,
  kgId: string,
  childId: string,
  p: z.infer<typeof parentSchema>,
): Promise<ParentInviteResult> {
  const res = await addPersonToKindergarten({ supabase, actorId, kgId, fullName: p.fullName, phone: p.phone, role: "parent" });
  check(
    await supabase
      .from("child_guardians")
      .upsert({ child_id: childId, user_id: res.userId, kindergarten_id: kgId, relation: p.relation }, { onConflict: "child_id,user_id" }),
  );
  await audit(supabase, kgId, "guardian.link", "child", childId, { parent: res.userId });
  return { name: p.fullName, existed: res.existed, invite: res.invite };
}

export async function addGuardianAction(childId: string, input: z.input<typeof parentSchema>) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(childId);
    const v = parse(parentSchema, input);
    const { data: child } = await supabase.from("children").select("id").eq("id", childId).eq("kindergarten_id", ctx.kg.id).maybeSingle();
    if (!child) throw new ActionError("notFound");
    return linkParent(supabase, ctx.userId, ctx.kg.id, childId, v);
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
    check(
      await supabase
        .from("children")
        .update({ status: "archived", archive_reason: reason, archived_at: new Date().toISOString() })
        .eq("id", id)
        .eq("kindergarten_id", ctx.kg.id),
    );
    await audit(supabase, ctx.kg.id, "child.archive", "child", id, { reason });
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

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function uploadChildPhotoAction(id: string, form: FormData) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(id);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("invalid");
    if (file.size > 5 * 1024 * 1024) throw new ActionError("fileTooLarge");
    if (!PHOTO_TYPES.includes(file.type)) throw new ActionError("fileType");
    // RLS-checked: the update succeeds only for admins of this kindergarten.
    const { data: child } = await supabase.from("children").select("id, photo_path").eq("id", id).eq("kindergarten_id", ctx.kg.id).single();
    if (!child) throw new ActionError("notFound");
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${ctx.kg.id}/${id}/photo-${Date.now()}.${ext}`;
    const service = createServiceClient();
    const up = await service.storage.from("child-photos").upload(path, file, { contentType: file.type });
    if (up.error) throw new ActionError("generic");
    const upd = await supabase.from("children").update({ photo_path: path }).eq("id", id).select("id");
    if (upd.error || !upd.data?.length) {
      await service.storage.from("child-photos").remove([path]);
      throw new ActionError("forbidden");
    }
    if (child.photo_path) await service.storage.from("child-photos").remove([child.photo_path]);
  });
}
