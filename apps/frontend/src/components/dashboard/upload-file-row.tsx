"use client";

import Link from "next/link";
import { Fragment } from "react";

import { useTranslation } from "@/lib/i18n/language-provider";
import type { ConfirmedCost } from "@/lib/api/imports";
import { formatFileSize, type SelectedFile } from "./upload-file";

/**
 * One file and what became of it.
 *
 * A successful import shows the booking numbers it produced, each linking to
 * the Trip: an operator's next question after "did it arrive?" is "where is
 * it?". A failure shows the backend's own message, which is written for an
 * operator; the error code stays out of sight, because it is for matching
 * rather than for reading.
 */
export function UploadFileRow({
  selected,
  onRemove,
}: {
  selected: SelectedFile;
  onRemove: () => void;
}) {
  const t = useTranslation();

  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground">
          {selected.file.name}
        </span>
        <span className="mt-0.5 block text-xs">
          <span className="text-muted">
            {formatFileSize(selected.file.size)}
          </span>{" "}
          <Status selected={selected} />
        </span>
      </span>

      {selected.state === "uploading" ? null : (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-xs font-medium text-secondary hover:text-danger"
        >
          {t("upload.remove")}
        </button>
      )}
    </li>
  );
}

function Status({ selected }: { selected: SelectedFile }) {
  const t = useTranslation();

  if (!selected.isPdf) {
    return <span className="text-warning">· {t("upload.rejected")}</span>;
  }

  if (selected.state === "uploading") {
    // Text rather than a spinner: `fetch` reports no upload progress, so an
    // animation would suggest a measurement that does not exist.
    return <span className="text-secondary">· {t("upload.uploading")}</span>;
  }

  if (selected.state === "imported" && selected.result) {
    return <Imported result={selected.result} />;
  }

  if (selected.state === "failed") {
    return (
      <span className="text-danger">
        · ✗ {t("upload.failed")}
        {selected.result?.message ? ` — ${selected.result.message}` : ""}
      </span>
    );
  }

  return <span className="text-secondary">· {t("upload.pending")}</span>;
}

function Imported({
  result,
}: {
  result: NonNullable<SelectedFile["result"]>;
}) {
  const t = useTranslation();
  const trips = result.trips ?? [];
  const cancellations = result.cancellations ?? [];

  /*
   * A Cost Confirmation attaches a confirmed amount to a Trip that already
   * exists. Saying "imported" here, or showing the empty Trip list the way an
   * order's would be shown, would report an import that never happened.
   */
  if (result.kind === "COST_CONFIRMATION") {
    return <CostConfirmed confirmations={result.costConfirmations ?? []} />;
  }

  /*
   * A cancelled order was handled, not imported: it creates no Trip. Saying
   * "imported" here would tell the operator the opposite of what happened.
   */
  if (cancellations.length > 0) {
    const cancelled = cancellations.some(
      (entry) => entry.outcome === "CANCELLED",
    );

    return (
      <span className="text-secondary">
        · {cancelled ? t("upload.cancelled") : t("upload.cancelledNoTrip")}
      </span>
    );
  }

  return (
    <span className="text-success">
      · ✓{" "}
      {result.combination
        ? `${t("upload.combinationImported")} — ${trips.length} ${t("upload.tripsCreated")}`
        : t("upload.imported")}{" "}
      {trips.map((trip, index) => (
        <Fragment key={trip.id}>
          {index > 0 ? ", " : null}
          <Link
            href={`/trips/${trip.id}`}
            className="font-medium text-primary hover:underline"
          >
            {trip.bookingNumber}
          </Link>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * A Cost Confirmation that was applied.
 *
 * It names the Trip it was attached to, because that is the operator's next
 * question — the confirmation is money against a transport they already know.
 * The amount is shown exactly as the backend formatted it: nothing here parses
 * or rounds a figure.
 *
 * `ALREADY_RECORDED` is reported separately rather than as a success or a
 * failure: the same confirmation arriving twice changed nothing, and saying
 * "processed" would suggest a second amount was added.
 */
function CostConfirmed({
  confirmations,
}: {
  confirmations: readonly ConfirmedCost[];
}) {
  const t = useTranslation();

  return (
    <span className="text-success">
      · ✓ {t("upload.costConfirmed")}{" "}
      {confirmations.map((confirmation, index) => (
        <Fragment key={confirmation.ccNumber}>
          {index > 0 ? ", " : null}
          <span className="text-secondary">
            CC{confirmation.ccNumber} ·{" "}
          </span>
          <Link
            href={`/trips/${confirmation.tripId}`}
            className="font-medium text-primary hover:underline"
          >
            {confirmation.bookingNumber}
          </Link>
          <span className="text-secondary">
            {" "}
            · {confirmation.currency} {confirmation.amount}
            {confirmation.outcome === "ALREADY_RECORDED"
              ? ` · ${t("upload.costAlreadyRecorded")}`
              : ""}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
