import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppShell } from "@/components/shell/app-shell";
import { requireAnyContext } from "@/lib/auth/context";
import { navFor } from "@/lib/nav";
import { formatPhone } from "@/lib/phone";
import { signedUrl } from "@/lib/kg-assets";
import { getShellCounters } from "@/lib/shell-counters";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireAnyContext();
  if (ctx.kind === "kindergarten" && !ctx.membership.consent_at) redirect("/consent");
  const tr = await getTranslations("roles");
  const role = ctx.kind === "kindergarten" ? ctx.role : "superadmin";

  const contexts = ctx.memberships.map((m) => ({
    value: `${m.kindergarten_id}:${m.role}`,
    kindergartenName: m.kindergartens?.name ?? "",
    roleLabel: tr(m.role),
  }));
  if (ctx.isSuperadmin) contexts.unshift({ value: "superadmin", kindergartenName: "Happy Steps Platform", roleLabel: tr("superadmin") });

  const logoUrl = ctx.kind === "kindergarten" ? await signedUrl("kindergarten-assets", ctx.kg.logo_path, 3600) : null;
  const counters = ctx.kind === "kindergarten" ? await getShellCounters(ctx) : { chats: 0, notifications: 0 };
  const accent = ctx.kind === "kindergarten" ? ctx.kg.accent_color : null;

  return (
    <div style={accent ? ({ "--brand": accent } as React.CSSProperties) : undefined}>
      <AppShell
        nav={navFor(role)}
        kindergarten={ctx.kind === "kindergarten" ? { name: ctx.kg.name, logoUrl } : { name: "Happy Steps" }}
        user={{ fullName: ctx.profile.full_name, phone: formatPhone(ctx.profile.phone) }}
        roleLabel={tr(role)}
        contexts={contexts}
        currentContext={ctx.contextValue}
        unreadChats={counters.chats}
        unreadNotifications={counters.notifications}
        showSearch={ctx.kind === "kindergarten" && role !== "parent"}
      >
        {children}
      </AppShell>
    </div>
  );
}
