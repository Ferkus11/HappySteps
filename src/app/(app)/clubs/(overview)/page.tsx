import { getTranslations } from "next-intl/server";
import { requireKg } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { ClubDialog } from "@/components/clubs/club-dialog";
import { AdminClubs, CatalogClubs, ParentClubs, TeacherClubs, clubTeachers } from "@/components/clubs/views";

export async function generateMetadata() {
  return { title: (await getTranslations("clubs"))("title") };
}

/** SPEC §3.4 «Кружки»: owner/head ✅, accountant/teacher 👁, club teacher 🔸 own clubs, parent 🔸 enrolment; cook —. */
export default async function ClubsPage({ searchParams }: { searchParams: Promise<{ child?: string }> }) {
  const ctx = await requireKg(["owner", "head", "accountant", "teacher", "club_teacher", "parent"]);
  const t = await getTranslations("clubs");
  const sp = await searchParams;
  switch (ctx.role) {
    case "parent":
      return (
        <>
          <PageHeader title={t("title")} description={t("subtitleParent")} />
          <ParentClubs ctx={ctx} childParam={sp.child} />
        </>
      );
    case "owner":
    case "head":
      return (
        <>
          <PageHeader title={t("title")} description={t("subtitleAdmin")} actions={<ClubDialog teachers={await clubTeachers(ctx)} />} />
          <AdminClubs ctx={ctx} />
        </>
      );
    case "club_teacher":
      return (
        <>
          <PageHeader title={t("title")} description={t("subtitleTeacher")} />
          <TeacherClubs ctx={ctx} />
        </>
      );
    default:
      return (
        <>
          <PageHeader title={t("title")} description={t("subtitleStaff")} />
          <CatalogClubs ctx={ctx} />
        </>
      );
  }
}
