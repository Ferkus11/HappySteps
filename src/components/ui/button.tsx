import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        primary: "bg-brand text-brand-fg hover:bg-brand-strong shadow-sm",
        secondary: "bg-sky-soft text-sky-strong hover:bg-sky/20",
        outline: "border border-border bg-surface text-text hover:bg-surface-muted",
        ghost: "text-text hover:bg-surface-muted",
        danger: "bg-danger text-white hover:bg-danger/90",
        link: "text-brand underline-offset-4 hover:underline px-0 h-auto",
      },
      size: {
        sm: "h-9 px-3 text-[13px] pointer-coarse:h-11", // ≥44px touch targets on phones (SPEC §8)
        md: "h-11 px-4",
        lg: "h-14 px-6 text-base rounded-2xl",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  // data-variant: offline styling dims real buttons that would run an action (globals.css); links don't get it.
  return <Comp className={cn(buttonVariants({ variant, size }), className)} data-variant={asChild ? undefined : (variant ?? "primary")} {...props} />;
}
