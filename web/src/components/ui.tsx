import * as React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "border-input bg-input/20 placeholder:text-muted-foreground/70 h-10 w-full min-w-0 rounded-lg border px-3 text-base transition-[color,box-shadow,border-color] outline-none md:text-sm",
        "focus-visible:border-primary/60 focus-visible:ring-ring/40 focus-visible:ring-[3px]",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "border-input bg-input/20 placeholder:text-muted-foreground/70 min-h-20 w-full rounded-lg border px-3 py-2 text-base outline-none md:text-sm",
        "focus-visible:border-primary/60 focus-visible:ring-ring/40 focus-visible:ring-[3px]",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-muted-foreground text-xs font-medium tracking-wide uppercase", className)} {...props} />;
}

const badgeTones = {
  neutral: "bg-muted text-muted-foreground",
  clay: "bg-clay/15 text-clay",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/15 text-destructive",
} as const;

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.ComponentProps<"span"> & { tone?: keyof typeof badgeTones }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] leading-none font-medium",
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** A status dot; `live` adds a soft pulse ring. */
export function StatusDot({ tone, live, className }: { tone: "success" | "muted" | "danger" | "clay"; live?: boolean; className?: string }) {
  const color = {
    success: "bg-success",
    muted: "bg-muted-foreground/40",
    danger: "bg-destructive",
    clay: "bg-clay",
  }[tone];
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)}>
      {live && (
        <motion.span
          className={cn("absolute inset-0 rounded-full", color)}
          animate={{ scale: [1, 2.4], opacity: [0.6, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span className={cn("relative inline-flex size-2 rounded-full", color)} />
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-clay" />
      <path d="M9 11l5 5-5 5" fill="none" stroke="oklch(0.16 0.01 50)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.5 21.5h6.5" stroke="oklch(0.16 0.01 50)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

/** Section heading inside cards and sheets. */
export function SectionTitle({ children, right, className }: { children: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 px-1", className)}>
      <h3 className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">{children}</h3>
      {right}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <motion.span
      className={cn("inline-block size-4 rounded-full border-2 border-current border-r-transparent", className)}
      animate={{ rotate: 360 }}
      transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
    />
  );
}
