import { getTranslations } from "next-intl/server";
import { requireKg } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { ParentPayments } from "@/components/payments/parent-view";
import { StaffPayments, type StaffParams } from "@/components/payments/staff-view";

export async function generateMetadata() {
  return { title: (await getTranslations("payments"))("title") };
}

/** SPEC §3.4 «Оплата за сад»: owner ✅, head 👁, accountant ✅, parent 🔸 own children. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<StaffParams> }) {
  const ctx = await requireKg(["owner", "head", "accountant", "parent"]);
  const t = await getTranslations("payments");
  if (ctx.role === "parent") {
    return (
      <>
        <PageHeader title={t("title")} description={t("subtitleParent")} />
        <ParentPayments ctx={ctx} />
      </>
    );
  }
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitleStaff")} />
      <StaffPayments ctx={ctx} sp={await searchParams} />
    </>
  );
}
