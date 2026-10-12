"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { EVENT_KINDS, type EventKind } from "@/lib/events";
import { createEventAction, updateEventAction } from "@/app/(app)/events/actions";
import { AudienceFields, readAudience, type Audience, type TargetGroup } from "@/components/announcements/audience-fields";

export interface EventFormValue {
  id: string;
  title: string;
  kind: EventKind;
  date: string;
  start_time: string | null;
  end_time: string | null;
  place: string | null;
  description: string | null;
  audience: Audience;
  groupIds: string[];
}

export function EventDialog({
  audiences,
  groups,
  event,
  defaultDate,
  trigger,
  onSaved,
}: {
  audiences: Audience[];
  groups: TargetGroup[];
  event?: EventFormValue;
  defaultDate: string;
  trigger?: React.ReactNode;
  onSaved?: (date: string) => void;
}) {
  const t = useTranslations("events");
  const tc = useTranslations("common");
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [groupError, setGroupError] = React.useState(false);
  const opts = {
    success: tc("saved"),
    onSuccess: (d: { id: string; date: string }) => {
      setOpen(false);
      onSaved?.(d.date);
      const month = d.date.slice(0, 7);
      router.push(`/events?month=${month}&day=${d.date}`);
    },
  };
  const create = useAction(createEventAction, opts);
  const update = useAction(updateEventAction, opts);
  const pending = create.pending || update.pending;
  const fieldError = (k: string) => create.fieldError(k) ?? update.fieldError(k);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        setGroupError(false);
      }}
    >
      <DialogTrigger asChild>
        {trigger ??
          (event ? (
            <Button variant="outline" data-testid="edit-event">
              <Pencil /> {t("edit")}
            </Button>
          ) : (
            <Button data-testid="new-event">
              <Plus /> {t("new")}
            </Button>
          ))}
      </DialogTrigger>
      <DialogContent title={event ? t("edit") : t("new")}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const { audience, groupIds } = readAudience(f);
            if (audience === "groups" && !groupIds.length) {
              setGroupError(true);
              return;
            }
            const input = {
              title: String(f.get("title") ?? ""),
              kind: String(f.get("kind")) as EventKind,
              date: String(f.get("date") ?? ""),
              startTime: String(f.get("startTime") ?? ""),
              endTime: String(f.get("endTime") ?? ""),
              place: String(f.get("place") ?? ""),
              description: String(f.get("description") ?? ""),
              audience,
              groupIds,
            };
            if (event) update.run(event.id, input);
            else create.run(input);
          }}
        >
          <Field label={t("titleField")} htmlFor="e-title" error={fieldError("title")}>
            <Input id="e-title" name="title" defaultValue={event?.title} required maxLength={200} data-testid="event-title" />
          </Field>
          <Field label={t("kind")} htmlFor="e-kind">
            <Select id="e-kind" name="kind" defaultValue={event?.kind ?? "matinee"} data-testid="event-kind">
              {/* A garden day off also blocks attendance/work-time expectations — owner/head only (they may target "all"). */}
              {EVENT_KINDS.filter((k) => k !== "day_off" || audiences.includes("all") || event?.kind === "day_off").map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
            <Field label={t("date")} htmlFor="e-date" error={fieldError("date")} className="col-span-2 sm:col-span-1">
              <Input id="e-date" name="date" type="date" defaultValue={event?.date ?? defaultDate} required data-testid="event-date" />
            </Field>
            <Field label={t("start")} htmlFor="e-start" error={fieldError("startTime")}>
              <Input id="e-start" name="startTime" type="time" defaultValue={event?.start_time ?? ""} data-testid="event-start" />
            </Field>
            <Field label={t("end")} htmlFor="e-end" error={fieldError("endTime")}>
              <Input id="e-end" name="endTime" type="time" defaultValue={event?.end_time ?? ""} />
            </Field>
          </div>
          <Field label={t("place")} htmlFor="e-place" error={fieldError("place")}>
            <Input id="e-place" name="place" defaultValue={event?.place ?? ""} maxLength={200} placeholder={t("placeHint")} />
          </Field>
          <Field label={t("description")} htmlFor="e-desc" error={fieldError("description")}>
            <Textarea id="e-desc" name="description" defaultValue={event?.description ?? ""} rows={3} maxLength={5000} />
          </Field>
          <AudienceFields
            audiences={audiences}
            groups={groups}
            defaultAudience={event?.audience}
            defaultGroups={event?.groupIds}
            error={groupError ? t("chooseGroups") : fieldError("groupIds")}
          />
          <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="event-submit">
            {event ? tc("save") : t("create")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
