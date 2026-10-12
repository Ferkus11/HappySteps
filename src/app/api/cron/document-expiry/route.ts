import { cronUnauthorized } from "@/lib/cron";
import { createServiceClient } from "@/lib/supabase/service";
import { memberIds, notify } from "@/lib/notify";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type Due = {
  kindergarten_id: string;
  document_id: string;
  user_id: string;
  person: string;
  title: string;
  doc_type: string;
  expires_on: string;
  threshold: 30 | 7;
  days_left: number;
};

/**
 * Daily: staff documents expiring in 30 and 7 days (SPEC §5.8) → notification to the employee and the
 * head(s) (the owner when there is no head). Selection lives in SQL (`document_expiry_due`, garden time zone,
 * each threshold once per document and expiry date); a reminder is sent only when this run inserted its
 * bookkeeping row, so overlapping or repeated runs never notify twice.
 */
export async function GET(req: Request) {
  const denied = cronUnauthorized(req);
  if (denied) return denied;
  const db = createServiceClient();
  const { data: due, error } = await db.rpc("document_expiry_due");
  if (error) {
    console.error("document expiry:", error.message);
    return Response.json({ error: "db" }, { status: 500 });
  }
  const admins = new Map<string, string[]>();
  let sent = 0;
  for (const r of (due ?? []) as Due[]) {
    const { data: claimed } = await db
      .from("staff_document_reminders")
      .upsert(
        { document_id: r.document_id, kindergarten_id: r.kindergarten_id, expires_on: r.expires_on, threshold: r.threshold },
        { onConflict: "document_id,expires_on,threshold", ignoreDuplicates: true },
      )
      .select("document_id");
    if (!claimed?.length) continue;
    if (!admins.has(r.kindergarten_id)) {
      let ids = await memberIds(r.kindergarten_id, ["head"]);
      if (!ids.length) ids = await memberIds(r.kindergarten_id, ["owner"]);
      admins.set(r.kindergarten_id, ids);
    }
    const params = { person: r.person, document: r.title, date: formatDate(r.expires_on) };
    await notify({ kindergartenId: r.kindergarten_id, userIds: [r.user_id], type: "document.expiring", params, url: "/documents" });
    await notify({
      kindergartenId: r.kindergarten_id,
      userIds: admins.get(r.kindergarten_id)!.filter((id) => id !== r.user_id),
      type: "document.expiring",
      params,
      url: `/documents/staff/${r.user_id}`,
    });
    sent++;
  }
  return Response.json({ ok: true, due: due?.length ?? 0, sent });
}
