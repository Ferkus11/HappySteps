"use client";

import * as React from "react";
import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  side,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** "right" renders a sheet on desktop; on phones every dialog is a bottom sheet. */
  side?: "center" | "right";
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-[rgb(16_24_40/0.35)] data-[state=open]:animate-in" />
      <D.Content
        className={cn(
          "fixed z-50 flex max-h-[92dvh] flex-col bg-surface shadow-xl focus:outline-none",
          "inset-x-0 bottom-0 rounded-t-3xl",
          side === "right"
            ? "md:inset-y-0 md:right-0 md:left-auto md:bottom-auto md:h-dvh md:max-h-none md:w-[480px] md:rounded-none md:rounded-l-3xl"
            : "md:inset-auto md:top-1/2 md:left-1/2 md:w-[520px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 pt-5 pb-4">
          <div className="min-w-0">
            <D.Title className="text-lg font-extrabold text-text">{title}</D.Title>
            {description ? (
              <D.Description className="mt-1 text-sm text-muted">{description}</D.Description>
            ) : (
              <D.Description className="sr-only">{typeof title === "string" ? title : ""}</D.Description>
            )}
          </div>
          <D.Close className="-mr-2 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-muted" aria-label="×">
            <X className="size-5" />
          </D.Close>
        </div>
        <div className="overflow-y-auto px-5 py-5 pb-safe">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
