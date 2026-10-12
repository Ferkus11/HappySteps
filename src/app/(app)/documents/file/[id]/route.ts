import { loadContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { signedUrl } from "@/lib/kg-assets";
import { CHILD_BUCKET, STAFF_BUCKET } from "@/lib/documents-logic";
import { zUuid } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Opens a document: reads the row with the user's own client (RLS decides who may see it), then redirects
 * to a short-lived signed URL of the private object. `?k=s` — staff document, otherwise child document.
 * Anything not visible is a plain 404 (no hint whether it exists).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  if (!zUuid.safeParse(id).success) return notFound();
  const r = await loadContext();
  if (r.state !== "ok" || r.ctx.kind !== "kindergarten") return notFound();
  const staff = new URL(req.url).searchParams.get("k") === "s";
  const supabase = await createClient();
  const { data } = await supabase
    .from(staff ? "staff_documents" : "child_documents")
    .select("path")
    .eq("id", id)
    .eq("kindergarten_id", r.ctx.kg.id)
    .maybeSingle();
  if (!data) return notFound();
  const url = await signedUrl(staff ? STAFF_BUCKET : CHILD_BUCKET, data.path as string, 60);
  if (!url) return notFound();
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, no-store" } });
}
