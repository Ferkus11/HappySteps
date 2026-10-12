"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Building2, UsersRound, BriefcaseBusiness } from "lucide-react";
import { cn } from "@/lib/utils";

export type Audience = "all" | "groups" | "staff";
export interface TargetGroup {
  id: string;
  name: string;
  color: string;
}

const ICONS = { all: Building2, groups: UsersRound, staff: BriefcaseBusiness } as const;

/**
 * Audience picker shared by announcements and events. Uses native inputs so the parent form
 * reads `audience` and `groupIds` from FormData. A teacher gets only "groups" with own groups.
 */
export function AudienceFields({
  audiences,
  groups,
  defaultAudience,
  defaultGroups = [],
  error,
}: {
  audiences: Audience[];
  groups: TargetGroup[];
  defaultAudience?: Audience;
  defaultGroups?: string[];
  error?: string;
}) {
  const t = useTranslations("announcements");
  const [audience, setAudience] = React.useState<Audience>(defaultAudience && audiences.includes(defaultAudience) ? defaultAudience : audiences[0]);
  const single = audiences.length === 1;
  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-[13px] font-semibold text-muted">{t("audience")}</legend>
      {single ? (
        <input type="hidden" name="audience" value={audience} />
      ) : (
        <div className="grid grid-cols-3 gap-2" role="radiogroup">
          {audiences.map((a) => {
            const Icon = ICONS[a];
            return (
              <label
                key={a}
                className={cn(
                  "flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-center text-[13px] font-semibold",
                  audience === a ? "border-brand bg-brand-soft text-brand" : "border-border text-muted hover:bg-surface-muted",
                )}
              >
                <input type="radio" name="audience" value={a} checked={audience === a} onChange={() => setAudience(a)} className="sr-only" data-testid={`audience-${a}`} />
                <Icon className="size-4" aria-hidden />
                {t(`audiences.${a}`)}
              </label>
            );
          })}
        </div>
      )}
      {audience === "groups" ? (
        <div>
          {single ? <p className="mb-2 text-[13px] text-faint">{t("teacherGroupsHint")}</p> : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {groups.map((g) => (
              <label key={g.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3 text-sm has-[:checked]:border-brand">
                <input
                  type="checkbox"
                  name="groupIds"
                  value={g.id}
                  defaultChecked={defaultGroups.includes(g.id) || (groups.length === 1 && !defaultGroups.length)}
                  className="size-5 accent-[var(--brand)]"
                  data-testid={`group-option-${g.name}`}
                  data-group-id={g.id}
                />
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: g.color }} aria-hidden />
                <span className="truncate">{g.name}</span>
              </label>
            ))}
          </div>
          {error ? (
            <p role="alert" className="mt-1.5 text-[13px] text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}

export function readAudience(f: FormData): { audience: Audience; groupIds: string[] } {
  const audience = (String(f.get("audience") ?? "all") as Audience) || "all";
  return { audience, groupIds: audience === "groups" ? f.getAll("groupIds").map(String) : [] };
}
