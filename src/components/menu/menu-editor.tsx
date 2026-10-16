"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, inputClass } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Confirm } from "@/components/common/confirm";
import { useAction } from "@/hooks/use-action";
import { addDays } from "@/lib/format";
import { cn } from "@/lib/utils";
import { clearMenuAction, copyMenuAction, saveMenuAction } from "@/app/(app)/menu/actions";
import type { MealKey, MenuItem } from "./meals";
import { DateField } from "@/components/ui/date-field";

type Row = { id: number; dish: string; composition: string };

let seq = 0;
const newRow = (dish = "", composition = ""): Row => ({ id: ++seq, dish, composition });

export function MenuEditor({
  date,
  dateLabel,
  meals,
  items,
  recent,
}: {
  date: string;
  dateLabel: string;
  meals: MealKey[];
  items: MenuItem[];
  recent: { date: string; label: string }[];
}) {
  const t = useTranslations("menu");
  const router = useRouter();
  const [rows, setRows] = React.useState<Record<string, Row[]>>(() =>
    Object.fromEntries(
      meals.map((m) => {
        const own = items.filter((i) => i.meal === m).sort((a, b) => a.position - b.position);
        return [m, own.length ? own.map((i) => newRow(i.dish, i.composition ?? "")) : [newRow()]];
      }),
    ),
  );
  const [invalid, setInvalid] = React.useState<Set<number>>(new Set());
  const focusNext = React.useRef<string | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);
  const hasSaved = items.some((i) => meals.includes(i.meal));

  React.useEffect(() => {
    if (!focusNext.current) return;
    formRef.current?.querySelector<HTMLElement>(`[data-field="${focusNext.current}"]`)?.focus();
    focusNext.current = null;
  });

  const save = useAction(saveMenuAction, { success: t("saved") });
  const clear = useAction(clearMenuAction, { success: t("cleared") });

  const update = (meal: MealKey, id: number, patch: Partial<Row>) =>
    setRows((s) => ({ ...s, [meal]: s[meal].map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const addRow = (meal: MealKey) => {
    const r = newRow();
    focusNext.current = `dish-${r.id}`;
    setRows((s) => ({ ...s, [meal]: [...s[meal], r] }));
  };
  const removeRow = (meal: MealKey, id: number) =>
    setRows((s) => {
      const left = s[meal].filter((r) => r.id !== id);
      return { ...s, [meal]: left.length ? left : [newRow()] };
    });

  const submit = () => {
    const bad = new Set<number>();
    const out: { meal: MealKey; dish: string; composition: string }[] = [];
    for (const m of meals) {
      for (const r of rows[m] ?? []) {
        const dish = r.dish.trim();
        const composition = r.composition.trim();
        if (!dish && composition) bad.add(r.id);
        else if (dish) out.push({ meal: m, dish, composition });
      }
    }
    setInvalid(bad);
    if (bad.size) {
      toast.error(t("dishRequired"));
      return;
    }
    void save.run({ date, items: out });
  };

  const onKey = (meal: MealKey, index: number, field: "dish" | "composition") => (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) return submit();
    const list = rows[meal];
    const focus = (target: string) => formRef.current?.querySelector<HTMLElement>(`[data-field="${target}"]`)?.focus();
    if (field === "dish") focus(`composition-${list[index].id}`);
    else if (index < list.length - 1) focus(`dish-${list[index + 1].id}`);
    else addRow(meal);
  };

  const goTo = (d: string) => router.push(`/menu/edit?date=${d}`);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon" aria-label={t("prevDay")} onClick={() => goTo(addDays(date, -1))}>
            <ChevronLeft />
          </Button>
          <DateField
            value={date}
            aria-label={t("date")}
            className="w-[170px]"
            data-testid="menu-date"
            onChange={(v) => v && v !== date && goTo(v)}
          />
          <Button type="button" variant="outline" size="icon" aria-label={t("nextDay")} onClick={() => goTo(addDays(date, 1))}>
            <ChevronRight />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <CopyDialog date={date} dateLabel={dateLabel} recent={recent} overwrite={hasSaved} />
          {hasSaved ? (
            <Confirm
              trigger={
                <Button type="button" variant="ghost" data-testid="menu-clear">
                  <Trash2 /> {t("clear")}
                </Button>
              }
              title={t("clearTitle", { date: dateLabel })}
              description={t("clearHint")}
              confirmLabel={t("clear")}
              danger
              onConfirm={() => clear.run(date)}
            />
          ) : null}
        </div>
      </div>

      {meals.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">{t("noMeals")}</p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {meals.map((meal) => (
            <Card key={meal} data-testid={`meal-section-${meal}`} className="p-4 sm:p-5">
              <h2 className="mb-3 text-[15px] font-bold">{t(`meals.${meal}`)}</h2>
              <ul className="space-y-3">
                {rows[meal].map((r, i) => (
                  <li key={r.id} className="flex items-start gap-2">
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                      <Input
                        value={r.dish}
                        maxLength={200}
                        placeholder={t("dishPlaceholder")}
                        aria-label={`${t(`meals.${meal}`)}: ${t("dish")} ${i + 1}`}
                        aria-invalid={invalid.has(r.id) || undefined}
                        data-field={`dish-${r.id}`}
                        data-testid={`dish-${meal}-${i}`}
                        className="font-semibold"
                        onChange={(e) => update(meal, r.id, { dish: e.target.value })}
                        onKeyDown={onKey(meal, i, "dish")}
                      />
                      <AutoGrowText
                        value={r.composition}
                        maxLength={500}
                        placeholder={t("compositionPlaceholder")}
                        aria-label={`${t(`meals.${meal}`)}: ${t("composition")} ${i + 1}`}
                        data-field={`composition-${r.id}`}
                        data-testid={`composition-${meal}-${i}`}
                        onChange={(e) => update(meal, r.id, { composition: e.target.value.replace(/\s*\n\s*/g, " ") })}
                        onKeyDown={onKey(meal, i, "composition")}
                      />
                    </div>
                    <button
                      type="button"
                      className={cn(
                        "grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-faint hover:bg-surface-muted hover:text-text",
                        rows[meal].length === 1 && !r.dish && !r.composition && "invisible",
                      )}
                      aria-label={t("removeDish")}
                      onClick={() => removeRow(meal, r.id)}
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
              <Button type="button" variant="ghost" size="sm" className="mt-2 text-brand" onClick={() => addRow(meal)} data-testid={`add-dish-${meal}`}>
                <Plus /> {t("addDish")}
              </Button>
            </Card>
          ))}
        </div>
      )}

      {meals.length ? (
        <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-10 mt-4 flex items-center gap-3 rounded-2xl border border-border bg-surface/95 p-3 shadow-card backdrop-blur md:bottom-4">
          <p className="hidden min-w-0 flex-1 text-[13px] text-faint sm:block">{t("keyboardHint")}</p>
          <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={save.pending} data-testid="menu-save">
            {t("save")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function CopyDialog({ date, dateLabel, recent, overwrite }: { date: string; dateLabel: string; recent: { date: string; label: string }[]; overwrite: boolean }) {
  const t = useTranslations("menu");
  const tc = useTranslations("common");
  const [open, setOpen] = React.useState(false);
  const [from, setFrom] = React.useState(recent[0]?.date ?? addDays(date, -1));
  const copy = useAction(copyMenuAction, { onSuccess: (d) => toast.success(t("copied", { count: d.count })) });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" data-testid="menu-copy">
          <Copy /> {t("copy")}
        </Button>
      </DialogTrigger>
      <DialogContent title={t("copyTitle")}>
        <label className="mb-1.5 block text-[13px] font-semibold text-muted" htmlFor="menu-copy-from">
          {t("copyFrom")}
        </label>
        <DateField id="menu-copy-from" value={from} onChange={setFrom} data-testid="menu-copy-from" />
        {recent.length ? (
          <div className="mt-4">
            <p className="mb-2 text-[13px] font-semibold text-muted">{t("copyRecent")}</p>
            <div className="flex flex-wrap gap-2">
              {recent.map((r) => (
                <button
                  key={r.date}
                  type="button"
                  onClick={() => setFrom(r.date)}
                  className={cn(
                    "h-10 pointer-coarse:h-11 cursor-pointer rounded-xl border px-3 text-sm font-semibold",
                    from === r.date ? "border-brand bg-brand-soft text-brand" : "border-border text-text hover:bg-surface-muted",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {overwrite ? (
          <p className="mt-4 rounded-xl bg-warning-soft px-3 py-2.5 text-sm text-warning" data-testid="menu-copy-overwrite">
            {t("copyOverwrite", { date: dateLabel })}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {tc("cancel")}
          </Button>
          <Button
            type="button"
            disabled={!from || from === date || copy.pending}
            data-testid="menu-copy-confirm"
            onClick={async () => {
              const r = await copy.run({ from, to: date });
              if (r?.ok) setOpen(false);
            }}
          >
            {t("copyConfirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The ingredient line: one row that grows as the cook types, so the end of a long list stays visible on a
 * phone (UX review #22). Enter still moves to the next field (onKey), so the value stays one line.
 */
function AutoGrowText({ className, value, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const fit = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, []);
  React.useLayoutEffect(fit, [fit, value]);
  React.useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      className={cn(inputClass, "block h-auto min-h-11 resize-none overflow-hidden py-2.5 leading-snug", className)}
      {...props}
    />
  );
}
