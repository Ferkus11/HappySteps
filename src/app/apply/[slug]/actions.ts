"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { parse, ValidationError } from "@/lib/actions/safe";
import { dbErrorCode, fail, type ActionResult } from "@/lib/actions/result";
import { createServiceClient } from "@/lib/supabase/service";
import { memberIds, notify } from "@/lib/notify";
import { publicGarden } from "@/lib/waitlist-data";
import { publicApplicationSchema } from "@/lib/waitlist";

const hash = (kind: string, value: string) => createHash("sha256").update(`hs-waitlist:${kind}:${value}`).digest("hex");

/**
 * Public application form (no login). Anonymous visitors get no table access: the server validates,
 * drops honeypot hits, and the service role calls waitlist_public_submit(), which rate-limits by IP and phone.
 */
export async function submitApplicationAction(slug: string, input: unknown): Promise<ActionResult> {
  try {
    // Honeypot: bots fill every field. Answer as if all went well and store nothing.
    const honeypot = (input as { website?: unknown } | null)?.website;
    if (typeof honeypot === "string" && honeypot.trim()) return { ok: true };
    const v = parse(publicApplicationSchema, input);
    const kg = await publicGarden(String(slug));
    if (!kg) return fail("notFound");

    const h = await headers();
    const ip = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || h.get("x-real-ip") || "local";
    const service = createServiceClient();
    const { data, error } = await service.rpc("waitlist_public_submit", {
      p_kg: kg.id,
      p_child_name: v.childName,
      p_birth: v.childBirthDate,
      p_parent_name: v.parentName,
      p_phone: v.parentPhone,
      p_desired: v.desiredDate,
      p_comment: v.comment,
      p_ip_hash: hash("ip", ip),
      p_phone_hash: hash("phone", v.parentPhone),
    });
    if (error) return fail(dbErrorCode(error));
    const res = data as { id: string; created: boolean };
    if (res.created) {
      await notify({
        kindergartenId: kg.id,
        userIds: await memberIds(kg.id, ["owner", "head"]),
        type: "waitlist.new",
        params: { child: v.childName, parent: v.parentName },
        url: `/waitlist/${res.id}`,
      });
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof ValidationError) return fail("invalid", e.fieldErrors);
    console.error("waitlist submit", e);
    return fail("generic");
  }
}
