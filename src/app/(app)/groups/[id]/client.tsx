"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, MoreHorizontal, Trash2 } from "lucide-react";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from "@/components/ui/dropdown";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/input";
import { Confirm } from "@/components/common/confirm";
import { useAction } from "@/hooks/use-action";
import { deleteGroupAction, transferGroupAction } from "../actions";
import { DateField } from "@/components/ui/date-field";

export function TransferGroup({ fromId, groups, today }: { fromId: string; groups: { id: string; name: string }[]; today: string }) {
  const t = useTranslations("groups");
  const [open, setOpen] = React.useState(false);
  const { run, pending } = useAction(transferGroupAction, {
    onSuccess: (d) => {
      toast.success(t("transferred", { count: d.count }));
      setOpen(false);
    },
  });
  if (!groups.length) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ArrowRightLeft /> {t("transfer")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("transfer")} description={t("transferHint")}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(fromId, String(f.get("to")), String(f.get("date")));
          }}
        >
          <Field label={t("transferTo")} htmlFor="tg-to">
            <Select id="tg-to" name="to" required>
              {groups.map((g) => (
                <option data-user-content key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("transferDate")} htmlFor="tg-date">
            <DateField id="tg-date" name="date" defaultValue={today} required />
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            {t("transfer")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteGroup({ id }: { id: string }) {
  const t = useTranslations("groups");
  const router = useRouter();
  const { run } = useAction(deleteGroupAction, { refresh: false, onSuccess: () => router.push("/groups") });
  const tc = useTranslations("common");
  const [confirm, setConfirm] = React.useState(false);
  // A rare, destructive action: behind a labelled «…» menu instead of a bare red icon next to the main actions.
  return (
    <>
      <Dropdown modal={false}>
        <DropdownTrigger asChild>
          <Button variant="outline" size="icon" aria-label={tc("more")} data-testid="group-more">
            <MoreHorizontal />
          </Button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem onSelect={() => setConfirm(true)} className="text-danger [&_svg]:text-danger" data-testid="group-delete">
            <Trash2 /> {t("delete")}
          </DropdownItem>
        </DropdownContent>
      </Dropdown>
      <Confirm
        open={confirm}
        onOpenChange={setConfirm}
        title={t("delete")}
        description={t("deleteConfirm")}
        confirmLabel={t("delete")}
        danger
        onConfirm={() => run(id)}
      />
    </>
  );
}
