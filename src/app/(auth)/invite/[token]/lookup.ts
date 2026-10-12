import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { hashToken } from "@/lib/people";
import { formatPhone } from "@/lib/phone";

export async function lookupInvite(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const service = createServiceClient();
  const { data } = await service
    .from("invites")
    .select("id, user_id, kind, expires_at, used_at, kindergartens(name), profiles(full_name, phone)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data || data.used_at || new Date(data.expires_at) < new Date()) return null;
  const profile = data.profiles as unknown as { full_name: string; phone: string } | null;
  const kg = data.kindergartens as unknown as { name: string } | null;
  return {
    id: data.id as string,
    userId: data.user_id as string,
    kind: data.kind as "invite" | "reset",
    phone: formatPhone(profile?.phone),
    rawPhone: profile?.phone ?? "",
    firstName: (profile?.full_name ?? "").split(" ")[1] ?? profile?.full_name ?? "",
    kindergartenName: kg?.name ?? "Happy Steps",
  };
}
