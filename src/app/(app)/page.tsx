import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireAnyContext, requireKg } from "@/lib/auth/context";
import { AdminDashboard } from "@/components/dashboard/admin";
import { ParentDashboard } from "@/components/dashboard/parent";
import { StaffDashboard } from "@/components/dashboard/staff";

export async function generateMetadata() {
  return { title: (await getTranslations("dashboard"))("title") };
}

export default async function Home() {
  const any = await requireAnyContext();
  if (any.kind === "superadmin") redirect("/admin");
  const ctx = await requireKg();
  switch (ctx.role) {
    case "owner":
    case "head":
      return <AdminDashboard ctx={ctx} />;
    case "parent":
      return <ParentDashboard ctx={ctx} />;
    default:
      return <StaffDashboard ctx={ctx} />;
  }
}
