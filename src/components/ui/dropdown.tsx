"use client";

import * as React from "react";
import { DropdownMenu as M } from "radix-ui";
import { cn } from "@/lib/utils";

export const Dropdown = M.Root;
export const DropdownTrigger = M.Trigger;

export function DropdownContent({ className, align = "end", ...props }: M.DropdownMenuContentProps) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={8}
        className={cn(
          "z-50 min-w-56 rounded-2xl border border-border bg-surface p-1.5 shadow-xl focus:outline-none",
          className,
        )}
        {...props}
      />
    </M.Portal>
  );
}

export function DropdownItem({ className, ...props }: M.DropdownMenuItemProps) {
  return (
    <M.Item
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-sm text-text outline-none select-none data-[highlighted]:bg-surface-muted [&_svg]:size-4 [&_svg]:text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownLabel({ className, ...props }: M.DropdownMenuLabelProps) {
  return <M.Label className={cn("px-3 pt-2 pb-1 text-xs font-semibold text-faint", className)} {...props} />;
}

export function DropdownSeparator() {
  return <M.Separator className="my-1 h-px bg-border" />;
}
