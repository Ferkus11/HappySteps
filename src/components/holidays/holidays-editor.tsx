"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CalendarPlus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAction } from "@/hooks/use-action";
import { formatDate } from "@/lib/format";
import { addHolidayAction, fillKzHolidaysAction, removeHolidayAction } from "./actions";

type Item = { id: string; date: string; name: string; kind: "holiday" | "day_off" | "working_day" };

export function HolidaysEditor({ year, items }: { year: number; items: Item[] }) {
  const t = useTranslations("holidays");
  const fill = useAction(fillKzHolidaysAction, { onSuccess: (d) => toast.success(t("filled", { count: d.count })) });
  const add = useAction(addHolidayAction);
  const remove = useAction(removeHolidayAction);
  const formRef = React.useRef<HTMLFormElement>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => fill.run(year)} disabled={fill.pending}>
          <Sparkles /> {t("fill", { year })}
        </Button>
        <Button variant="outline" onClick={() => fill.run(year + 1)} disabled={fill.pending}>
          {t("fill", { year: year + 1 })}
        </Button>
      </div>
      <form
        ref={formRef}
        className="grid gap-2 sm:grid-cols-[160px_1fr_200px_auto]"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const r = await add.run({ date: String(f.get("date")), name: String(f.get("name")), kind: String(f.get("kind")) as Item["kind"] });
          if (r?.ok) formRef.current?.reset();
        }}
      >
        <Input type="date" name="date" required aria-label={t("date")} />
        <Input name="name" required placeholder={t("name")} aria-label={t("name")} />
        <Select name="kind" aria-label={t("kind")} defaultValue="day_off">
          {(["holiday", "day_off", "working_day"] as const).map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline" disabled={add.pending}>
          <CalendarPlus /> {t("add")}
        </Button>
      </form>
      {items.length ? (
        <ul className="grid gap-x-6 sm:grid-cols-2">
          {items.map((h) => (
            <li key={h.id} className="flex min-h-11 items-center gap-3 border-b border-border text-sm">
              <span className="w-24 shrink-0 font-semibold">{formatDate(h.date)}</span>
              <span className="min-w-0 flex-1 truncate">{h.name}</span>
              {h.kind !== "holiday" ? <Badge tone={h.kind === "working_day" ? "sky" : "lavender"}>{t(`kinds.${h.kind}`)}</Badge> : null}
              <button type="button" className="grid size-9 cursor-pointer place-items-center rounded-full text-faint hover:bg-surface-muted" aria-label={t("remove")} onClick={() => remove.run(h.id)}>
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{t("empty")}</p>
      )}
    </div>
  );
}
