import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-card border border-border/70 bg-surface p-5 shadow-card", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  href,
  action,
  className,
}: {
  title: React.ReactNode;
  href?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-center justify-between gap-3", className)}>
      <h2 className="text-[15px] font-bold text-text">
        {href ? (
          <Link href={href} className="inline-flex items-center gap-1 hover:text-brand">
            {title}
            <ChevronRight className="size-4 text-faint" aria-hidden />
          </Link>
        ) : (
          title
        )}
      </h2>
      {action}
    </div>
  );
}
