"use client";

import { useRouter } from "next/navigation";
import { DateField } from "@/components/ui/date-field";

/** Date field that navigates once a full date is typed or picked (keeps the page a Server Component). */
export function NavPicker({ value, param, path, label }: { value: string; param: string; path: string; label: string }) {
  const router = useRouter();
  return (
    <DateField
      value={value}
      aria-label={label}
      className="min-w-0 flex-1 sm:w-44 sm:flex-none"
      data-testid={`pick-${param}`}
      onChange={(v) => {
        if (v && v !== value) router.push(`${path}?${param}=${v}`);
      }}
    />
  );
}
