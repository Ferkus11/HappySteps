"use client";

import * as React from "react";
import { Switch as S, Checkbox as C } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: S.SwitchProps) {
  return (
    <S.Root
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full bg-[var(--ring-track)] transition-colors data-[state=checked]:bg-brand disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <S.Thumb className="block size-6 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" />
    </S.Root>
  );
}

export function Checkbox({ className, ...props }: C.CheckboxProps) {
  return (
    <C.Root
      className={cn(
        "grid size-5 shrink-0 cursor-pointer place-items-center rounded-md border border-border bg-surface data-[state=checked]:border-brand data-[state=checked]:bg-brand",
        className,
      )}
      {...props}
    >
      <C.Indicator>
        <Check className="size-3.5 text-white" strokeWidth={3} />
      </C.Indicator>
    </C.Root>
  );
}
