import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { zUuid } from "@/lib/validation";
import { PageHeader } from "@/components/ui/page-header";
import { canUploadStaffDocs, canViewStaffDocs, listStaffDocuments } from "@/lib/documents";
import { StaffFolder } from "@/components/documents/folders";

export async function generateMetadata() {
  return { title: (await getTranslations("documents"))("staffFolder") };
}

/** An employee's documents: owner/head/accountant (view) and the employee themself. Others get 404. */
export default async function StaffDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireKg();
  if (!zUuid.safeParse(id).success) notFound();
  const t = await getTranslations("documents");
  const supabase = await createClient();
  if (!(await canViewStaffDocs(supabase, ctx.kg.id, id))) notFound();
  const { data: staff } = await supabase
    .from("memberships")
    .select("id, profiles(full_name)")
    .eq("user_id", id)
    .eq("kindergarten_id", ctx.kg.id)
    .neq("role", "parent")
    .limit(1)
    .maybeSingle();
  if (!staff) notFound();
  const name = (staff as unknown as { profiles: { full_name: string } | null }).profiles?.full_name ?? "—";
  const [docs, canUpload] = await Promise.all([listStaffDocuments(supabase, ctx.kg.id, { userId: id }), canUploadStaffDocs(supabase, ctx.kg.id, id)]);
  return (
    <>
      <Link
        href={ctx.role === "owner" || ctx.role === "head" ? "/documents?tab=staff" : "/documents"}
        className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted hover:text-text"
      >
        <ChevronLeft className="size-4" aria-hidden /> {t("title")}
      </Link>
      <PageHeader title={t("staffFolder")} />
      <StaffFolder ctx={ctx} userId={id} title={id === ctx.userId ? t("myDocuments") : name} docs={docs} canUpload={canUpload} />
    </>
  );
}
