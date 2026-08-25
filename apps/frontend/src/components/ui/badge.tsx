import { cn } from "@/lib/cn";

/**
 * A small status label.
 *
 * The tones are the semantic colours from the design tokens, named by meaning
 * rather than by colour so a component asks for "danger", not "red".
 *
 * `outline` is the odd one out, and deliberately: it is for a label that is NOT
 * a state. Every filled tone here already means something in the lifecycle —
 * info is OPEN, success is CLOSED, danger is CANCELLED, neutral is DELETED — so
 * a classification that borrowed one would read as a status the Trip does not
 * have. An outline carries no lifecycle colour at all.
 */
export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "outline";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-hover text-secondary",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  outline: "border border-border text-secondary",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
