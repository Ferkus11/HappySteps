"use server";

import { z } from "zod";
import { kgAction, parse, check } from "@/lib/actions/safe";
import { ActionError } from "@/lib/actions/result";
import { createServiceClient } from "@/lib/supabase/service";
import { addPersonToKindergarten, assertCanManageUser, createInvite } from "@/lib/people";
import { audit } from "@/lib/audit";
import { zName, zPhone, zOptionalDate, zOptionalText, zUuid } from "@/lib/validation";
import { ROLES, STAFF_ROLES } from "@/lib/auth/roles";

const addStaffSchema = z.object({
  fullName: zName,
  phone: zPhone,
  role: z.enum(ROLES).refine((r) => STAFF_ROLES.includes(r), "invalid"),
  position: zOptionalText(80),
  groupIds: z.array(zUuid).default([]),
});

export async function addStaffAction(input: z.input<typeof addStaffSchema>) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    const v = parse(addStaffSchema, input);
    const res = await addPersonToKindergarten({
      supabase,
      actorId: ctx.userId,
      kgId: ctx.kg.id,
      fullName: v.fullName,
      phone: v.phone,
      role: v.role,
      position: v.position,
    });
    if (v.role === "teacher" && v.groupIds.length) {
      check(
        await supabase
          .from("group_teachers")
          .upsert(v.groupIds.map((g) => ({ group_id: g, user_id: res.userId, kindergarten_id: ctx.kg.id })), { ignoreDuplicates: true }),
      );
    }
    return { userId: res.userId, existed: res.existed, alreadyMember: res.result === "exists", invite: res.invite };
  });
}

export async function setMembershipStatusAction(membershipId: string, status: "active" | "archived") {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(membershipId);
    const row = check(
      await supabase
        .from("memberships")
        .update({
          status,
          archived_at: status === "archived" ? new Date().toISOString() : null,
          archived_by: status === "archived" ? ctx.userId : null,
        })
        .eq("id", membershipId)
        .eq("kindergarten_id", ctx.kg.id)
        .select("id, user_id, role"),
    );
    if (!row.length) throw new ActionError("forbidden");
    await audit(supabase, ctx.kg.id, status === "archived" ? "account.archive" : "account.restore", "membership", row[0].user_id, {
      role: row[0].role,
    });
  });
}

/** Archives every role of a person that the actor may manage (keeps e.g. a parent role if not allowed). */
export async function archivePersonAction(userId: string) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(userId);
    if (userId === ctx.userId) throw new ActionError("forbidden");
    const roles = await assertCanManageUser(supabase, ctx.kg.id, userId);
    const manageable = [];
    for (const r of roles) if ((await supabase.rpc("can_manage_role", { kg: ctx.kg.id, target: r })).data) manageable.push(r);
    check(
      await supabase
        .from("memberships")
        .update({ status: "archived", archived_at: new Date().toISOString(), archived_by: ctx.userId })
        .eq("kindergarten_id", ctx.kg.id)
        .eq("user_id", userId)
        .in("role", manageable)
        .eq("status", "active"),
    );
    await audit(supabase, ctx.kg.id, "account.archive", "person", userId, { roles: manageable });
  });
}

export async function restorePersonAction(userId: string) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(userId);
    const roles = await assertCanManageUser(supabase, ctx.kg.id, userId);
    const manageable = [];
    for (const r of roles) if ((await supabase.rpc("can_manage_role", { kg: ctx.kg.id, target: r })).data) manageable.push(r);
    check(
      await supabase
        .from("memberships")
        .update({ status: "active", archived_at: null, archived_by: null })
        .eq("kindergarten_id", ctx.kg.id)
        .eq("user_id", userId)
        .in("role", manageable),
    );
    await audit(supabase, ctx.kg.id, "account.restore", "person", userId, { roles: manageable });
  });
}

/** Owner only: removes the person from this kindergarten for good (SPEC §4, confirm by typing the name). */
export async function deletePersonAction(userId: string, confirmName: string) {
  return kgAction(["owner"], async (ctx, supabase) => {
    zUuid.parse(userId);
    if (!ctx.roles.includes("owner")) throw new ActionError("forbidden");
    if (confirmName.trim() !== ctx.kg.name.trim()) throw new ActionError("confirmMismatch");
    if (userId === ctx.userId) throw new ActionError("forbidden");
    await assertCanManageUser(supabase, ctx.kg.id, userId, { allRoles: true });
    const service = createServiceClient();
    const { data: profile } = await service.from("profiles").select("full_name").eq("id", userId).single();
    check(await supabase.from("child_guardians").delete().eq("kindergarten_id", ctx.kg.id).eq("user_id", userId));
    check(await supabase.from("group_teachers").delete().eq("kindergarten_id", ctx.kg.id).eq("user_id", userId));
    check(await supabase.from("memberships").delete().eq("kindergarten_id", ctx.kg.id).eq("user_id", userId));
    await audit(supabase, ctx.kg.id, "account.delete", "person", userId, { name: profile?.full_name });
    // No memberships anywhere and not platform staff → remove the login entirely.
    const [{ count }, { data: sa }] = await Promise.all([
      service.from("memberships").select("id", { count: "exact", head: true }).eq("user_id", userId),
      service.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    ]);
    if (!count && !sa) await service.auth.admin.deleteUser(userId);
  });
}

export async function resetPasswordAction(userId: string) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(userId);
    await assertCanManageUser(supabase, ctx.kg.id, userId);
    const service = createServiceClient();
    const { data: p } = await service.from("profiles").select("activated_at").eq("id", userId).single();
    const invite = await createInvite({ userId, kgId: ctx.kg.id, kind: p?.activated_at ? "reset" : "invite", createdBy: ctx.userId });
    await audit(supabase, ctx.kg.id, p?.activated_at ? "account.password_reset" : "account.invite", "person", userId);
    return invite;
  });
}

const updatePersonSchema = z.object({
  fullName: zName,
  birthDate: zOptionalDate,
  position: zOptionalText(80),
});

export async function updatePersonAction(userId: string, input: z.input<typeof updatePersonSchema>) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(userId);
    const v = parse(updatePersonSchema, input);
    await assertCanManageUser(supabase, ctx.kg.id, userId);
    // Profile is global (one person = one account); only managers of this person may rename them.
    check(await createServiceClient().from("profiles").update({ full_name: v.fullName, birth_date: v.birthDate }).eq("id", userId));
    await supabase.from("memberships").update({ position: v.position }).eq("kindergarten_id", ctx.kg.id).eq("user_id", userId).neq("role", "parent");
    await audit(supabase, ctx.kg.id, "account.update", "person", userId);
  });
}

export async function setTeacherGroupsAction(userId: string, groupIds: string[]) {
  return kgAction(["owner", "head"], async (ctx, supabase) => {
    zUuid.parse(userId);
    const ids = z.array(zUuid).parse(groupIds);
    check(await supabase.from("group_teachers").delete().eq("kindergarten_id", ctx.kg.id).eq("user_id", userId));
    if (ids.length) {
      check(
        await supabase.from("group_teachers").insert(ids.map((g) => ({ group_id: g, user_id: userId, kindergarten_id: ctx.kg.id }))),
      );
    }
  });
}
