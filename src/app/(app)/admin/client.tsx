"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Ban, CheckCircle2, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { InviteLink, type InviteLinkData } from "@/components/common/invite-link";
import { Confirm } from "@/components/common/confirm";
import { useAction } from "@/hooks/use-action";
import { createKindergartenAction, setKindergartenStatusAction, updateSubscriptionAction } from "./actions";
import { DateField } from "@/components/ui/date-field";

function slugify(s: string) {
  const map: Record<string, string> = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",ә:"a",ғ:"g",қ:"k",ң:"n",ө:"o",ұ:"u",ү:"u",һ:"h",і:"i" };
  return s.toLowerCase().split("").map((c) => map[c] ?? c).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

export function CreateKindergarten() {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const ti = useTranslations("invites");
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [phone, setPhone] = React.useState("");
  const [invite, setInvite] = React.useState<InviteLinkData | null>(null);
  const [existed, setExisted] = React.useState(false);
  const { run, pending, fieldError } = useAction(createKindergartenAction, {
    onSuccess: (d) => {
      setInvite(d.invite);
      setExisted(d.existed);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setInvite(null);
          setName("");
          setSlug("");
          setSlugTouched(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button data-testid="create-kg">
          <Plus /> {t("create")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("create")}>
        {invite || existed ? (
          <div className="space-y-4">
            <p className="text-sm font-semibold text-success">{t("created")}</p>
            {existed && !invite ? <p className="text-sm text-muted">{ti("alreadyRegistered")}</p> : null}
            {invite ? <InviteLink invite={invite} /> : null}
            <Button className="w-full" variant="outline" onClick={() => setOpen(false)}>
              {tc("close")}
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run({ name, slug, ownerName: String(f.get("ownerName")), ownerPhone: phone });
            }}
          >
            <Field label={t("name")} htmlFor="kg-name" error={fieldError("name")}>
              <Input
                id="kg-name"
                value={name}
                required
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
              />
            </Field>
            <Field label={t("slug")} htmlFor="kg-slug" hint={t("slugHint")} error={fieldError("slug")}>
              <Input id="kg-slug" value={slug} required onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} />
            </Field>
            <Field label={t("ownerName")} htmlFor="kg-owner" error={fieldError("ownerName")}>
              <Input id="kg-owner" name="ownerName" required />
            </Field>
            <Field label={t("ownerPhone")} htmlFor="kg-owner-phone" error={fieldError("ownerPhone")}>
              <PhoneInput id="kg-owner-phone" onChange={setPhone} required />
            </Field>
            <Button type="submit" className="w-full" size="lg" disabled={pending} data-testid="create-kg-submit">
              {t("create")}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function KindergartenRowActions({
  id,
  status,
  plan,
  subStatus,
  periodEnd,
}: {
  id: string;
  status: "active" | "blocked";
  plan: string;
  subStatus: string;
  periodEnd: string | null;
}) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const setStatus = useAction(setKindergartenStatusAction);
  const sub = useAction(updateSubscriptionAction, { success: tc("saved"), onSuccess: () => setOpen(false) });
  return (
    <div className="flex gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Settings2 /> {t("editSubscription")}
          </Button>
        </DialogTrigger>
        <DialogContent title={t("editSubscription")}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              sub.run(id, {
                plan: String(f.get("plan")) as "trial",
                status: String(f.get("status")) as "trial",
                currentPeriodEnd: String(f.get("periodEnd") ?? ""),
              });
            }}
          >
            <Field label={t("plan")} htmlFor={`plan-${id}`}>
              <Select id={`plan-${id}`} name="plan" defaultValue={plan}>
                {(["trial", "basic", "pro"] as const).map((p) => (
                  <option key={p} value={p}>
                    {t(`plans.${p}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("subscription")} htmlFor={`st-${id}`}>
              <Select id={`st-${id}`} name="status" defaultValue={subStatus}>
                {(["trial", "active", "past_due", "blocked"] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(`subscriptionStatus.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("subscriptionUntil")} htmlFor={`end-${id}`}>
              <DateField id={`end-${id}`} name="periodEnd" defaultValue={periodEnd ?? ""} />
            </Field>
            <Button type="submit" className="w-full" disabled={sub.pending}>
              {tc("save")}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {status === "active" ? (
        <Confirm
          trigger={
            <Button variant="outline" size="sm" className="text-danger" data-testid={`block-${id}`}>
              <Ban /> {t("block")}
            </Button>
          }
          title={t("block")}
          description={t("blockConfirm")}
          confirmLabel={t("block")}
          danger
          onConfirm={() => setStatus.run(id, "blocked")}
        />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setStatus.run(id, "active")} data-testid={`unblock-${id}`}>
          <CheckCircle2 /> {t("unblock")}
        </Button>
      )}
    </div>
  );
}
