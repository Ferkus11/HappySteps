"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/switch";
import { PhoneInput } from "@/components/ui/phone-input";
import { InviteLink, type InviteLinkData } from "@/components/common/invite-link";
import { useAction } from "@/hooks/use-action";
import { addStaffAction } from "@/lib/actions/people-actions";
import type { Role } from "@/lib/auth/roles";

export function AddStaffButton({ roles, groups }: { roles: Role[]; groups: { id: string; name: string }[] }) {
  const t = useTranslations("staff");
  const tr = useTranslations("roles");
  const tc = useTranslations("common");
  const ti = useTranslations("invites");
  const [open, setOpen] = React.useState(false);
  const [role, setRole] = React.useState<Role>(roles.includes("teacher") ? "teacher" : roles[0]);
  const [phone, setPhone] = React.useState("");
  const [groupIds, setGroupIds] = React.useState<string[]>([]);
  const [result, setResult] = React.useState<{ invite: InviteLinkData | null; existed: boolean; alreadyMember: boolean } | null>(null);
  const { run, pending, fieldError } = useAction(addStaffAction, { onSuccess: (d) => setResult(d) });

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setResult(null);
          setGroupIds([]);
          setPhone("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button data-testid="add-staff">
          <UserPlus /> {t("add")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("add")}>
        {result ? (
          <div className="space-y-4">
            {result.alreadyMember ? (
              <p className="text-sm font-semibold text-warning">{ti("alreadyMember")}</p>
            ) : result.existed ? (
              <p className="text-sm font-semibold text-success" data-testid="already-registered">{ti("alreadyRegistered")}</p>
            ) : null}
            {result.invite ? <InviteLink invite={result.invite} /> : null}
            <Button variant="outline" className="w-full" onClick={() => setOpen(false)}>
              {tc("close")}
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run({
                fullName: String(f.get("fullName")),
                phone,
                role,
                position: String(f.get("position") ?? ""),
                groupIds: role === "teacher" ? groupIds : [],
              });
            }}
          >
            <Field label={tc("fullName")} htmlFor="st-name" error={fieldError("fullName")}>
              <Input id="st-name" name="fullName" required autoComplete="off" />
            </Field>
            <Field label={tc("phone")} htmlFor="st-phone" error={fieldError("phone")}>
              <PhoneInput id="st-phone" onChange={setPhone} required />
            </Field>
            <Field label={t("role")} htmlFor="st-role">
              <Select id="st-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {tr(r)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("position")} htmlFor="st-pos" hint={t("positionHint")}>
              <Input id="st-pos" name="position" />
            </Field>
            {role === "teacher" && groups.length ? (
              <fieldset>
                <legend className="mb-2 text-[13px] font-semibold text-muted">{t("groups")}</legend>
                <div className="grid grid-cols-2 gap-2">
                  {groups.map((g) => (
                    <label key={g.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3 text-sm">
                      <Checkbox
                        checked={groupIds.includes(g.id)}
                        onCheckedChange={(v) => setGroupIds((s) => (v ? [...s, g.id] : s.filter((x) => x !== g.id)))}
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="add-staff-submit">
              {tc("add")}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
