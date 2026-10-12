import { NextResponse } from "next/server";
import { loadContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { signedUrl } from "@/lib/kg-assets";
import { zUuid } from "@/lib/validation";

/**
 * Opens a chat attachment: the row is read under RLS (only members of the chat see it), then the
 * browser is redirected to a short-lived signed URL of the private bucket. Works for <img> and links
 * without signed URLs expiring in a long-open conversation.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!zUuid.safeParse(id).success) return new NextResponse(null, { status: 404 });
  const r = await loadContext();
  if (r.state !== "ok" || r.ctx.kind !== "kindergarten") return new NextResponse(null, { status: 403 });
  const supabase = await createClient();
  const { data } = await supabase.from("message_files").select("path").eq("id", id).maybeSingle();
  const url = await signedUrl("chat-files", data?.path, 300);
  if (!url) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=240" } });
}
