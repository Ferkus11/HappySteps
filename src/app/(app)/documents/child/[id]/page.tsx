import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";
import { requireKg } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { zUuid } from "@/lib/validation";
import { PageHeader } from "@/components/ui/page-header";
import { canUploadChildDocs, canViewChildDocs, listChildDocuments } from "@/lib/documents";
import { ChildFolder } from "@/components/documents/folders";

export async function generateMetadata() {
  return { title: (await getTranslations("documents"))("folder") };
}

/** A child's document folder: parents and owner/head upload, the group's teacher views. Others get 404. */
export default async function ChildDocumentsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ category?: string }> }) {
  const { id } = await params;
  const { category } = await searchParams;
  const ctx = await requireKg();
  if (!zUuid.safeParse(id).success) notFound();
  const t = await getTranslations("documents");
  const supabase = await createClient();
  if (!(await canViewChildDocs(supabase, id))) notFound();
  const { data: child } = await supabase
    .from("children")
    .select("id, full_name, groups(name)")
    .eq("id", id)
    .eq("kindergarten_id", ctx.kg.id)
    .maybeSingle();
  if (!child) notFound();
  const [docs, canUpload] = await Promise.all([listChildDocuments(supabase, ctx.kg.id, [id]), canUploadChildDocs(supabase, id)]);
  const staffView = ctx.role !== "parent";
  return (
    <>
      <Link href="/documents" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted hover:text-text">
        <ChevronLeft className="size-4" aria-hidden /> {t("title")}
      </Link>
      <PageHeader title={t("folder")} />
      <ChildFolder
        ctx={ctx}
        child={{ id: child.id, fullName: child.full_name, groupName: (child as unknown as { groups: { name: string } | null }).groups?.name }}
        docs={docs}
        canUpload={canUpload}
        initialCategory={category}
        titleHref={staffView ? `/children/${child.id}` : undefined}
      />
    </>
  );
}
