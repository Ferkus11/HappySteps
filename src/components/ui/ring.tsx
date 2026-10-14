import { cn } from "@/lib/utils";

/**
 * Circular progress indicator (0..100). Big number lives next to it, not inside.
 * `pending`: nothing to measure yet (no group marked, no payment in the month) — a dashed grey ring with «—»
 * instead of an empty 0% ring, which reads as an emergency.
 */
export function Ring({
  value,
  size = 64,
  stroke = 7,
  color = "var(--brand)",
  label,
  pending = false,
  className,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  pending?: boolean;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }} data-pending={pending ? "true" : undefined}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? (pending ? "—" : `${Math.round(v)}%`)}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={pending ? "#c3c9d4" : "var(--ring-track)"}
          strokeWidth={pending ? Math.max(2, stroke - 3) : stroke}
          strokeDasharray={pending ? "4 5" : undefined}
        />
        {pending ? null : (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (v / 100) * c}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        )}
      </svg>
      <span className={cn("absolute inset-0 grid place-items-center text-[13px] font-bold", pending ? "text-faint" : "text-text")}>
        {pending ? "—" : `${Math.round(v)}%`}
      </span>
    </div>
  );
}
