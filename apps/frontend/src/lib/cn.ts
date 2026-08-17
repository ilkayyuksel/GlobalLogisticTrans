import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names, letting a caller's utility win over a component default.
 *
 * `clsx` handles conditionals; `tailwind-merge` resolves conflicts, so passing
 * `p-6` to something that defaults to `p-4` produces `p-6` rather than both.
 * This is the same helper shadcn/ui components expect, which keeps adopting
 * them a copy-in rather than a rewrite.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
