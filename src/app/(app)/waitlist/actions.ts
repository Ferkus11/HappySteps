"use server";

import { z } from "zod";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { groupOverCapacity, type ParentInviteResult } from "@/lib/children";
import { createInvite, findOrCreateUser, type InviteLink } from "@/lib/people";
import { createServiceClient } from "@/lib/supabase/service";
import { applicationSchema, MANUAL_STATUSES, birthDateOk, type ApplicationInput } from "@/lib/waitlist";
import { zDate, zMoney, zName, zPhone, zUuid } from "@/lib/validation";
import { todayIn } from "@/lib/format";

/** «Добавить заявку» — the administration adds an application by hand (RLS: owner/head). */
export async function createApplicationAction(input: ApplicationInput) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    const v = parse(applicationSchema(todayIn(ctx.settings.timezone)), input);
    const row = check(
      await supabase
        .from("waitlist_applications")
        .insert({
          kindergarten_id: ctx.kg.id,
          child_name: v.childName,
          child_birth_date: v.childBirthDate,
          parent_name: v.parentName,
          parent_phone: v.parentPhone,
          desired_date: v.desiredDate,
          comment: v.comment,
        })
        .select("id")
        .single(),
    );
    return { id: row.id as string };
  });
}

export async function setApplicationStatusAction(id: string, status: (typeof MANUAL_STATUSES)[number]) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(id);
    const s = z.enum(MANUAL_STATUSES).parse(status);
    const rows = check(
      await supabase.from("waitlist_applications").update({ status: s }).eq("id", id).eq("kindergarten_id", ctx.kg.id).select("id"),
    );
    if (!rows.length) throw new ActionError("notFound");
  });
}

export async function addApplicationCommentAction(id: string, body: string) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(id);
    const text = parse(z.string().trim().min(1, "required").max(1000, "tooLong"), body);
    check(await supabase.from("waitlist_comments").insert({ kindergarten_id: ctx.kg.id, application_id: id, body: text }));
  });
}

/** Spam and duplicates. An accepted application stays (it links the child). */
export async function deleteApplicationAction(id: string) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(id);
    const rows = check(
      await supabase
        .from("waitlist_applications")
        .delete()
        .eq("id", id)
        .eq("kindergarten_id", ctx.kg.id)
        .neq("status", "accepted")
        .select("id, child_name"),
    );
    if (!rows.length) throw new ActionError("notFound");
    await audit(supabase, ctx.kg.id, "waitlist.delete", "waitlist_application", id, { name: rows[0].child_name });
  });
}

const acceptSchema = z.object({
  childName: zName,
  childBirthDate: zDate,
  parentName: zName,
  parentPhone: zPhone,
  groupId: zUuid,
  enrolledOn: zDate,
  monthlyFee: zMoney,
  confirmOverCapacity: z.boolean().default(false),
});

export type AcceptResult =
  | { needsConfirm: { group: string; count: number; capacity: number } }
  | { childId: string | null; invites: ParentInviteResult[]; already: boolean };

/**
 * «Принять»: creates the child card in the chosen group and the parent's account with an invite, links them
 * and marks the application «Принята» — one click, safe against double clicks and two admins at once.
 *
 * waitlist_begin_accept claims the application (token); only the parent's auth account is created outside the
 * database (service role). Membership, child, guardian link, status and audit happen in one transaction inside
 * waitlist_accept (which checks the caller, the claim and the group). On failure the claim is released and an
 * auth account created by this very call is deleted again — nothing else can be left half-done.
 */
export async function acceptApplicationAction(id: string, input: z.input<typeof acceptSchema>) {
  return kgAction<AcceptResult>(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(id);
    const v = parse(acceptSchema, input);
    if (!birthDateOk(v.childBirthDate, todayIn(ctx.settings.timezone))) throw new ActionError("dateInvalid");
    const { data: app } = await supabase
      .from("waitlist_applications")
      .select("id, status, child_id")
      .eq("id", id)
      .eq("kindergarten_id", ctx.kg.id)
      .maybeSingle();
    if (!app) throw new ActionError("notFound");
    if (app.status === "accepted") return { childId: app.child_id, invites: [], already: true };
    if (!v.confirmOverCapacity) {
      const over = await groupOverCapacity(supabase, v.groupId);
      if (over) return { needsConfirm: over };
    }
    const { data: mayAddParent } = await supabase.rpc("can_manage_role", { kg: ctx.kg.id, target: "parent" });
    if (!mayAddParent) throw new ActionError("forbidden");

    const claim = check(await supabase.rpc("waitlist_begin_accept", { p_app: id })) as
      | { state: "ok"; token: string }
      | { state: "accepted"; child_id: string | null }
      | { state: "busy" };
    if (claim.state === "accepted") return { childId: claim.child_id, invites: [], already: true };
    if (claim.state === "busy") throw new ActionError("waitlistBusy");

    let createdUserId: string | null = null;
    try {
      const parent = await findOrCreateUser(v.parentName, v.parentPhone);
      if (!parent.existed) createdUserId = parent.userId;
      const childId = check(
        await supabase.rpc("waitlist_accept", {
          p_app: id,
          p_token: claim.token,
          p_child_name: v.childName,
          p_birth: v.childBirthDate,
          p_group: v.groupId,
          p_enrolled: v.enrolledOn,
          p_fee: v.monthlyFee,
          p_parent: parent.userId,
          p_parent_new: !parent.existed,
        }),
      ) as string;
      createdUserId = null; // linked now — it stays
      // The invite is created only after everything is committed; if it fails, the parent can be re-invited later.
      let invite: InviteLink | null = null;
      if (!parent.activated) {
        try {
          invite = await createInvite({ userId: parent.userId, kgId: ctx.kg.id, kind: "invite", createdBy: ctx.userId });
        } catch (e) {
          console.error("waitlist accept: invite", e);
        }
      }
      return {
        childId,
        invites: [{ name: v.parentName, existed: parent.existed && parent.activated, invite }],
        already: false,
      };
    } catch (e) {
      await supabase.rpc("waitlist_abort_accept", { p_app: id, p_token: claim.token });
      if (createdUserId) await deleteUnusedUser(createdUserId);
      throw e;
    }
  });
}

/**
 * Rollback of an auth account created by a failed «Принять» (service role). Deleted only while nothing uses it yet —
 * a parallel action may have linked the same new phone in the meantime.
 */
async function deleteUnusedUser(userId: string) {
  const service = createServiceClient();
  const [{ count: memberships }, { count: guardians }] = await Promise.all([
    service.from("memberships").select("id", { count: "exact", head: true }).eq("user_id", userId),
    service.from("child_guardians").select("child_id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  if (memberships === 0 && guardians === 0) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) console.error("waitlist accept: rollback user", error.message);
  }
}
