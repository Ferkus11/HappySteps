"use client";

import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: T.TabsListProps) {
  return (
    <T.List
      className={cn("scrollbar-none mb-4 inline-flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-surface-muted p-1", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: T.TabsTriggerProps) {
  return (
    <T.Trigger
      className={cn(
        "h-10 shrink-0 cursor-pointer rounded-xl px-4 text-sm font-semibold text-muted data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
