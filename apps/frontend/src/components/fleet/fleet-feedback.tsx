"use client";

import { cn } from "@/lib/cn";

export interface FleetFeedbackMessage {
  readonly text: string;
  readonly detail?: string;
  readonly isError: boolean;
}

/** The outcome of the last change in one section of the fleet page. */
export function FleetFeedback({ feedback }: { feedback: FleetFeedbackMessage | null }) {
  if (!feedback) {
    return null;
  }

  return (
    <p
      role="status"
      className={cn(
        "rounded-md border px-4 py-2 text-sm",
        feedback.isError
          ? "border-danger/30 bg-danger/5 text-foreground"
          : "border-success/30 bg-success/5 text-foreground",
      )}
    >
      <span className="font-medium">{feedback.text}</span>
      {feedback.detail ? ` — ${feedback.detail}` : ""}
    </p>
  );
}
