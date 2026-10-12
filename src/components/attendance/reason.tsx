import { House, MessageCircle, Plane, Thermometer, type LucideIcon } from "lucide-react";
import type { AbsenceReason } from "@/lib/attendance-logic";
import { cn } from "@/lib/utils";

export const REASON_ICONS: Record<AbsenceReason, LucideIcon> = {
  sick: Thermometer,
  vacation: Plane,
  family: House,
  other: MessageCircle,
};

export function ReasonIcon({ reason, className }: { reason: AbsenceReason | null; className?: string }) {
  const Icon = reason ? REASON_ICONS[reason] : MessageCircle;
  return <Icon className={cn("size-4 shrink-0", className)} aria-hidden />;
}
