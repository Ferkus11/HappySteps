"use server";

import { z } from "zod";
import { superadminAction, parse, check } from "@/lib/actions/safe";
import { createServiceClient } from "@/lib/supabase/service";
import { createInvite, findOrCreateUser } from "@/lib/people";
import { zName, zPhone, zOptionalDate } from "@/lib/validation";
import { ActionError } from "@/lib/actions/result";

const createSchema = z.object({
  name: z.string().trim().min(2, "tooShort").max(120, "tooLong"),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "invalid"),
  ownerName: zName,
  ownerPhone: zPhone,
});

export async function createKindergartenAction(input: z.input<typeof createSchema>) {
  return superadminAction(async (actorId) => {
    const v = parse(createSchema, input);
    const service = createServiceClient();
    const kg = check(
      await service.from("kindergartens").insert({ name: v.name, slug: v.slug, created_by: actorId }).select("id").single(),
    );
    check(await service.from("kindergarten_settings").insert({ kindergarten_id: kg.id }));
    const trialEnd = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    check(await service.from("subscriptions").insert({ kindergarten_id: kg.id, plan: "trial", status: "trial", current_period_end: trialEnd }));
    const owner = await findOrCreateUser(v.ownerName, v.ownerPhone);
    check(await service.from("memberships").insert({ user_id: owner.userId, kindergarten_id: kg.id, role: "owner", created_by: actorId, consent_at: null }));
    await service.from("audit_log").insert({
      kindergarten_id: kg.id,
      actor_id: actorId,
      action: "kindergarten.create",
      entity: "kindergarten",
      entity_id: kg.id,
      details: { name: v.name, owner: owner.userId },
    });
    const invite = owner.activated ? null : await createInvite({ userId: owner.userId, kgId: kg.id, kind: "invite", createdBy: actorId });
    return { id: kg.id as string, invite, existed: owner.existed };
  });
}

export async function setKindergartenStatusAction(id: string, status: "active" | "blocked") {
  return superadminAction(async (actorId, supabase) => {
    if (!["active", "blocked"].includes(status)) throw new ActionError("invalid");
    check(await supabase.from("kindergartens").update({ status }).eq("id", id));
    await createServiceClient().from("audit_log").insert({
      kindergarten_id: id,
      actor_id: actorId,
      action: status === "blocked" ? "kindergarten.block" : "kindergarten.unblock",
      entity: "kindergarten",
      entity_id: id,
    });
  });
}

const subSchema = z.object({
  plan: z.enum(["trial", "basic", "pro"]),
  status: z.enum(["trial", "active", "past_due", "blocked"]),
  currentPeriodEnd: zOptionalDate,
});

export async function updateSubscriptionAction(id: string, input: z.input<typeof subSchema>) {
  return superadminAction(async (_actor, supabase) => {
    const v = parse(subSchema, input);
    check(
      await supabase
        .from("subscriptions")
        .upsert({ kindergarten_id: id, plan: v.plan, status: v.status, current_period_end: v.currentPeriodEnd, updated_at: new Date().toISOString() }),
    );
  });
}
