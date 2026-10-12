"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface RequisiteItem {
  key: string;
  label: string;
  value: string;
}

/** Requisites next to the amount, each with «Скопировать» (SPEC §5.9). */
export function Requisites({ items }: { items: RequisiteItem[] }) {
  const t = useTranslations("payments");
  const [copied, setCopied] = React.useState<string | null>(null);
  async function copy(item: RequisiteItem) {
    try {
      await navigator.clipboard.writeText(item.value);
    } catch {
      // Fallback for browsers without the async clipboard (older iOS in-app browsers).
      const ta = document.createElement("textarea");
      ta.value = item.value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(item.key);
    toast.success(t("copied"));
    window.setTimeout(() => setCopied((c) => (c === item.key ? null : c)), 2000);
  }
  return (
    <ul className="divide-y divide-border rounded-2xl border border-border" data-testid="requisites">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-3 py-2 pr-1.5 pl-3.5">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-faint">{item.label}</div>
            <div className="text-[15px] font-semibold break-words" data-testid={`requisite-${item.key}`}>
              {item.value}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-sky-strong"
            aria-label={t("copyLabel", { field: item.label })}
            title={t("copy")}
            data-testid={`copy-${item.key}`}
            onClick={() => copy(item)}
          >
            {copied === item.key ? <Check /> : <Copy />}
          </Button>
        </li>
      ))}
    </ul>
  );
}
