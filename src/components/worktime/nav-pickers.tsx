"use client";

import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

/** Date / month input that navigates on change (keeps the page a Server Component). */
export function NavPicker({ type, value, param, path, label }: { type: "date" | "month"; value: string; param: string; path: string; label: string }) {
  const router = useRouter();
  return (
    <Input
      type={type}
      value={value}
      aria-label={label}
      className="w-auto min-w-0 flex-1 sm:w-44 sm:flex-none"
      data-testid={`pick-${param}`}
      onChange={(e) => {
        if (e.target.value) router.push(`${path}?${param}=${e.target.value}`);
      }}
    />
  );
}
