"use client";

import * as React from "react";
import { Popover } from "radix-ui";
import { useTranslations } from "next-intl";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { displayToIso, isoToDisplay, maskDate, monthGrid, shiftIsoDay, shiftIsoMonth } from "@/lib/date-input";
import { formatDate } from "@/lib/format";
import { inputClass } from "./input";
import { cn } from "@/lib/utils";

type Props = {
  id?: string;
  /** Form field name: a hidden input carries the ISO value (`yyyy-mm-dd`). */
  name?: string;
  /** Controlled ISO value ("" = empty). */
  value?: string;
  defaultValue?: string | null;
  /** Called with the ISO date, or "" while the text is empty or incomplete. */
  onChange?: (iso: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  "aria-label"?: string;
  "data-testid"?: string;
};

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Date input that looks the same in every browser locale: the person types `дд.мм.гггг` (dots are added by
 * themselves) or picks a day in a small calendar whose month and weekday names come from the translation files.
 * Native `<input type="date">` renders in the browser's language, which is never Kazakh (SPEC §8, §13 scenario 12).
 */
export function DateField({
  id,
  name,
  value,
  defaultValue,
  onChange,
  min,
  max,
  required,
  disabled,
  className,
  inputClassName,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: Props) {
  const t = useTranslations("common.dateField");
  const tc = useTranslations("common");
  const controlled = value !== undefined;
  const [text, setText] = React.useState(() => isoToDisplay(controlled ? value : defaultValue));
  const [touched, setTouched] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const iso = displayToIso(text);

  // A controlled value changed from outside (e.g. "to" follows "from"): adjust the text while rendering.
  const [seenValue, setSeenValue] = React.useState(value);
  if (controlled && value !== seenValue) {
    setSeenValue(value);
    if (value !== iso) setText(isoToDisplay(value));
  }

  // form.reset() restores the initial date (hidden inputs are not reset by the browser).
  React.useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => {
      setText(isoToDisplay(controlled ? value : defaultValue));
      setTouched(false);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [controlled, value, defaultValue]);

  const problem = !text
    ? required
      ? tc("required")
      : ""
    : !iso
      ? t("invalid")
      : min && iso < min
        ? t("min", { date: formatDate(min) })
        : max && iso > max
          ? t("max", { date: formatDate(max) })
          : "";

  React.useEffect(() => {
    inputRef.current?.setCustomValidity(problem);
  }, [problem]);

  const commit = (next: string) => {
    setText(next);
    const nextIso = displayToIso(next);
    if (nextIso !== iso) onChange?.(nextIso);
  };

  return (
    <div className={cn("relative", className)}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={t("placeholder")}
        maxLength={10}
        value={text}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={touched && problem ? true : undefined}
        title={touched && problem ? problem : undefined}
        className={cn(inputClass, "pr-12 tabular-nums", inputClassName)}
        data-testid={testId}
        onChange={(e) => commit(maskDate(e.target.value))}
        onBlur={() => setTouched(true)}
        onInvalid={() => setTouched(true)}
      />
      {name ? <input type="hidden" name={name} value={iso} /> : null}
      <Calendar
        value={iso}
        min={min}
        max={max}
        disabled={disabled}
        onPick={(d) => {
          commit(isoToDisplay(d));
          setTouched(true);
          inputRef.current?.focus();
        }}
      />
    </div>
  );
}

function Calendar({
  value,
  min,
  max,
  disabled,
  onPick,
}: {
  value: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  onPick: (iso: string) => void;
}) {
  const t = useTranslations("common.dateField");
  const [open, setOpen] = React.useState(false);
  const [focus, setFocus] = React.useState("");
  const gridRef = React.useRef<HTMLDivElement>(null);
  const month = focus.slice(0, 7);
  const outOfRange = (d: string) => (!!min && d < min) || (!!max && d > max);

  const onOpenChange = (next: boolean) => {
    if (next) {
      let start = value || localToday();
      if (min && start < min) start = min;
      if (max && start > max) start = max;
      setFocus(start);
    }
    setOpen(next);
  };

  // Keep keyboard focus on the highlighted day.
  React.useEffect(() => {
    if (!open || !focus) return;
    const id = requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focus}"]`)?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, focus]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) {
      e.preventDefault();
      setFocus(shiftIsoDay(focus, step));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const m = shiftIsoMonth(month, e.key === "PageUp" ? -1 : 1);
      const day = Math.min(Number(focus.slice(8)), monthGrid(m).flat().filter(Boolean).length);
      setFocus(`${m}-${String(day).padStart(2, "0")}`);
    }
  };

  const shiftMonth = (delta: number) => setFocus(`${shiftIsoMonth(month, delta)}-01`);
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((n) => t(`weekdaysShort.${n}`));

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={t("openCalendar")}
          className="absolute inset-y-0 right-0 grid w-11 cursor-pointer place-items-center rounded-r-xl text-muted hover:text-text focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none disabled:opacity-50"
          data-testid="date-field-calendar"
        >
          <CalendarDays className="size-5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[60] w-[21rem] max-w-[calc(100vw-32px)] rounded-2xl border border-border bg-surface p-3 shadow-xl"
          data-testid="date-field-popover"
        >
          {month ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-2">
                <button type="button" onClick={() => shiftMonth(-1)} aria-label={t("prevMonth")} className="grid size-11 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface-muted">
                  <ChevronLeft className="size-5" />
                </button>
                <div className="text-[15px] font-bold" aria-live="polite" data-testid="date-field-month">
                  {t("monthYear", { month: t(`months.${Number(month.slice(5, 7))}`), year: month.slice(0, 4) })}
                </div>
                <button type="button" onClick={() => shiftMonth(1)} aria-label={t("nextMonth")} className="grid size-11 cursor-pointer place-items-center rounded-full text-muted hover:bg-surface-muted">
                  <ChevronRight className="size-5" />
                </button>
              </div>
              <div role="grid" ref={gridRef} onKeyDown={onKeyDown} className="grid grid-cols-7 gap-0.5">
                <div role="row" className="contents">
                  {weekdays.map((w) => (
                    <div key={w} role="columnheader" className="grid h-8 place-items-center text-[12px] font-semibold text-faint">
                      {w}
                    </div>
                  ))}
                </div>
                {monthGrid(month).map((week, i) => (
                  <div key={i} role="row" className="contents">
                    {week.map((d, j) =>
                      d ? (
                        <div key={d} role="gridcell" aria-selected={d === value}>
                          <button
                            type="button"
                            data-day={d}
                            tabIndex={d === focus ? 0 : -1}
                            disabled={outOfRange(d)}
                            aria-label={formatDate(d)}
                            onClick={() => {
                              onPick(d);
                              setOpen(false);
                            }}
                            className={cn(
                              "grid size-11 w-full cursor-pointer place-items-center rounded-xl text-[15px] tabular-nums hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:outline-none disabled:cursor-default disabled:text-faint disabled:opacity-40 disabled:hover:bg-transparent",
                              d === localToday() && "font-bold text-brand",
                              d === value && "bg-brand font-bold text-brand-fg hover:bg-brand-strong",
                            )}
                          >
                            {Number(d.slice(8))}
                          </button>
                        </div>
                      ) : (
                        <div key={`e${j}`} role="gridcell" />
                      ),
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
