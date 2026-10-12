"use server";

import { z } from "zod";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { groupOverCapacity, insertChild, linkParent, type ParentInviteResult } from "@/lib/children";
import { applicationSchema, MANUAL_STATUSES, birthDateOk } from "@/lib/waitlist";
import { zDate, zMoney, zName, zPhone, zUuid } from "@/lib/validation";
import { todayIn } from "@/lib/format";

/** «Добавить заявку» — the administration adds an application by hand (RLS: owner/head). */
export async function createApplicationAction(input: z.input<typeof applicationSchema>) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    const v = parse(applicationSchema, input);
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
 * and marks the application «Принята» — one click, safe against double clicks and two admins at once
 * (waitlist_begin_accept claims the application first).
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

    const claim = check(await supabase.rpc("waitlist_begin_accept", { p_app: id })) as "ok" | "accepted" | "busy";
    if (claim === "accepted") {
      const { data: done } = await supabase.from("waitlist_applications").select("child_id").eq("id", id).single();
      return { childId: done?.child_id ?? null, invites: [], already: true };
    }
    if (claim === "busy") throw new ActionError("waitlistBusy");

    let childId: string | null = null;
    try {
      childId = await insertChild(supabase, ctx.kg.id, {
        fullName: v.childName,
        birthDate: v.childBirthDate,
        groupId: v.groupId,
        enrolledOn: v.enrolledOn,
        monthlyFee: v.monthlyFee,
        allergies: null,
        medicalNotes: null,
      });
      const parent = await linkParent(supabase, ctx.userId, ctx.kg.id, childId, { fullName: v.parentName, phone: v.parentPhone, relation: null });
      check(await supabase.rpc("waitlist_finish_accept", { p_app: id, p_child: childId, p_parent: parent.userId }));
      return { childId, invites: [{ name: parent.name, existed: parent.existed, invite: parent.invite }], already: false };
    } catch (e) {
      // Roll back the half-done accept so the application can be accepted again.
      if (childId) await supabase.from("children").delete().eq("id", childId);
      await supabase.rpc("waitlist_abort_accept", { p_app: id });
      throw e;
    }
  });
}
