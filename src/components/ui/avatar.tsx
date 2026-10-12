import { cn } from "@/lib/utils";

const palette = ["#FCE4EC", "#E3F2FD", "#E8F5E9", "#FFF3E0", "#EDE7F6", "#E0F7FA"];
const fg = ["#AD1457", "#1565C0", "#2E7D32", "#B45309", "#5E35B1", "#00838F"];

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function Avatar({
  name,
  src,
  size = 40,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const i = h % palette.length;
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-bold", className)}
      style={{ width: size, height: size, background: palette[i], color: fg[i], fontSize: size * 0.38 }}
      aria-hidden
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
