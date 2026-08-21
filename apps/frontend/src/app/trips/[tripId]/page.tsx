"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";

import { PricingPanel } from "@/components/pricing/pricing-panel";
import { TripActionsBar } from "@/components/trips/trip-actions-bar";
import { PdfViewerDialog } from "@/components/ritten/pdf-viewer-dialog";
import { CostConfirmations } from "@/components/trips/cost-confirmations";
import { TripDocumentHistory } from "@/components/trips/trip-document-history";
import { fetchPdfDocument } from "@/lib/api/pdf-documents";
import { downloadBlob } from "@/lib/download";
import { TripCustomProperties } from "@/components/trips/trip-custom-properties";
import { TripEditForm } from "@/components/trips/trip-edit-form";
import { TripSummary } from "@/components/trips/trip-summary";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { ApiError, userFacingMessage } from "@/lib/api/client";
import { getVehicle, listTripCustomProperties } from "@/lib/api/fleet";
import { getPricingSnapshot, reprocessTripPricing } from "@/lib/api/pricing";
import {
  type UpdateTripPayload,
  changeTripStatus,
  deleteTrip,
  getTrip,
  restoreTrip,
  updateTrip,
} from "@/lib/api/trips";
import { useTranslation } from "@/lib/i18n/language-provider";
import type {
  ChangeableTripStatus,
  PricingSnapshot,
  Trip,
  TripCustomProperty,
  Vehicle,
} from "@/lib/api/types";

/** Everything one Trip page needs, loaded together. */
interface TripDetail {
  trip: Trip;
  vehicle: Vehicle | null;
  customProperties: TripCustomProperty[];
  pricing: PricingSnapshot | null;
}

/** What just happened, shown once and replaced by the next outcome. */
interface Feedback {
  tone: "success" | "error";
  message: string;
}

/**
 * One Trip, in full, with the operations an administrator performs on it.
 *
 * Every mutation follows the same shape: call the backend, then REFETCH. The
 * response of a status change is not treated as the new truth of the page,
 * because closing a Trip also triggers pricing — a separate operation that can
 * fail on its own. Assuming the Trip is priced because the status call
 * succeeded is exactly the mistake this avoids.
 */
export default function TripDetailPage() {
  const t = useTranslation();
  const params = useParams<{ tripId: string }>();
  const tripId = params.tripId;

  const { data, isLoading, error, reload } = useAsync(
    useCallback((signal: AbortSignal) => loadTripDetail(tripId, signal), [tripId]),
    [tripId],
  );

  if (isLoading) {
    return <LoadingState label={t("tripDetail.loading")} />;
  }

  if (error) {
    return <TripLoadFailure error={error} onRetry={reload} />;
  }

  if (!data) {
    return null;
  }

  return <TripDetailView detail={data} onChanged={reload} />;
}

function TripDetailView({
  detail,
  onChanged,
}: {
  detail: TripDetail;
  onChanged: () => void;
}) {
  const t = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  /** The stored document an operator asked to see, from the history list. */
  const [viewingDocument, setViewingDocument] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const { trip } = detail;

  /**
   * Runs one backend operation and reloads the Trip from the backend.
   *
   * The reload is the point: after any change the page shows what the backend
   * actually holds, not what this component predicted it would hold.
   */
  const runAction = useCallback(
    async (operation: () => Promise<unknown>, successMessage: string) => {
      setIsBusy(true);
      setFeedback(null);

      try {
        await operation();
        setFeedback({ tone: "success", message: successMessage });
        onChanged();
      } catch (caught: unknown) {
        setFeedback({ tone: "error", message: userFacingMessage(caught) });
      } finally {
        setIsBusy(false);
      }
    },
    [onChanged],
  );

  const handleChangeStatus = useCallback(
    (status: ChangeableTripStatus) =>
      runAction(
        () => changeTripStatus(trip.id, status),
        status === "CLOSED"
          ? t("tripDetail.feedback.closed")
          : `${t("tripDetail.feedback.statusChanged")} ${t(`status.${status}`)}`,
      ),
    [runAction, trip.id, t],
  );

  const handleSave = useCallback(
    async (payload: UpdateTripPayload) => {
      // Not wrapped in runAction: the form shows its own validation errors, so
      // the rejection has to reach it rather than becoming a page-level notice.
      await updateTrip(trip.id, payload);
      setIsEditing(false);
      setFeedback({ tone: "success", message: t("tripDetail.feedback.updated") });
      onChanged();
    },
    [onChanged, trip.id, t],
  );

  const handleReprocess = useCallback(
    () =>
      runAction(
        () => reprocessTripPricing(trip.id),
        t("tripDetail.feedback.repriced"),
      ),
    [runAction, trip.id, t],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/trips" className="text-sm text-primary hover:underline">
            ← {t("tripDetail.backToTrips")}
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-foreground">
            {t("tripDetail.heading")} {trip.bookingNumber}
          </h1>
        </div>

        <TripActionsBar
          trip={trip}
          isBusy={isBusy}
          onChangeStatus={handleChangeStatus}
          onDelete={() =>
            runAction(() => deleteTrip(trip.id), t("tripDetail.feedback.deleted"))
          }
          onRestore={() =>
            runAction(() => restoreTrip(trip.id), t("tripDetail.feedback.restored"))
          }
          onEdit={() => setIsEditing(true)}
        />
      </div>

      {feedback ? <FeedbackBanner feedback={feedback} /> : null}

      {trip.status === "DELETED" ? <DeletedNotice /> : null}

      {isEditing ? (
        <TripEditForm
          trip={trip}
          onSave={handleSave}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <TripSummary trip={trip} vehicle={detail.vehicle} />
      )}

      <TripCustomProperties properties={detail.customProperties} />

      {/*
        What Eucon confirmed it will pay. Read-only, and beside the waiting time
        rather than instead of it: the minutes and the money are different facts.
      */}
      <CostConfirmations
        confirmation={trip.costConfirmation}
        onView={setViewingDocument}
        onDownload={(confirmation) => {
          void downloadTripDocument({
            pdfDocumentId: confirmation.pdfDocumentId,
            originalFilename: `CC${confirmation.ccNumber}.pdf`,
          });
        }}
      />

      {/*
        Every document that concerned this Trip, newest first. Viewing one
        reuses the same dialog the Ritten list opens, so there is one viewer and
        one content route in the whole product.
      */}
      <TripDocumentHistory
        tripId={trip.id}
        onView={setViewingDocument}
        onDownload={(document) => {
          void downloadTripDocument(document);
        }}
      />

      <PricingPanel
        snapshot={detail.pricing}
        tripStatus={trip.status}
        isReprocessing={isBusy}
        onReprocess={handleReprocess}
        reprocessError={null}
      />

      {viewingDocument ? (
        <PdfViewerDialog
          trip={trip}
          pdfDocumentId={viewingDocument}
          onClose={() => setViewingDocument(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Saves one stored document under the name it arrived with.
 *
 * The same content endpoint the viewer uses; the filename comes from the
 * history entry, so an operator gets the document back called what the sender
 * called it rather than by a content hash.
 */
async function downloadTripDocument(document: {
  pdfDocumentId: string;
  originalFilename: string;
}): Promise<void> {
  const blob = await fetchPdfDocument(document.pdfDocumentId);

  downloadBlob(blob, document.originalFilename);
}

function FeedbackBanner({ feedback }: { feedback: Feedback }) {
  const isError = feedback.tone === "error";

  return (
    <div
      role={isError ? "alert" : "status"}
      className={
        isError
          ? "rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm font-medium text-danger"
          : "rounded-md border border-success/30 bg-success/5 px-4 py-3 text-sm font-medium text-success"
      }
    >
      {feedback.message}
    </div>
  );
}

/** A deleted Trip stays readable, but nothing about it can be changed. */
function DeletedNotice() {
  const t = useTranslation();

  return (
    <div className="rounded-md border border-border bg-hover px-4 py-3 text-sm text-secondary">
      {t("tripDetail.deletedNotice")}
    </div>
  );
}

/** A missing Trip is a page state; anything else is a failure to report. */
function TripLoadFailure({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const t = useTranslation();

  if (error instanceof ApiError && error.isNotFound) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="text-sm font-medium text-foreground">
          {t("tripDetail.notFoundTitle")}
        </p>
        <p className="mt-1 text-sm text-secondary">
          {t("tripDetail.notFoundDescription")}
        </p>
        <Link
          href="/trips"
          className="mt-4 inline-block text-sm text-primary hover:underline"
        >
          {t("tripDetail.backToTrips")}
        </Link>
      </div>
    );
  }

  return <ErrorState error={error} onRetry={onRetry} />;
}

/**
 * Fetches the Trip and everything shown alongside it.
 *
 * The vehicle and driver are looked up only when the Trip references them, so a
 * Trip with neither costs no extra requests. The driver id is an OVERRIDE: when
 * it is absent, the effective driver comes from the vehicle's assignment, which
 * no endpoint resolves for a given planning date — so nothing is inferred here.
 */
async function loadTripDetail(
  tripId: string,
  signal: AbortSignal,
): Promise<TripDetail> {
  const trip = await getTrip(tripId, signal);

  const [vehicle, customProperties, pricing] = await Promise.all([
    trip.vehicleId ? getVehicle(trip.vehicleId, signal) : Promise.resolve(null),
    listTripCustomProperties(tripId, signal),
    getPricingSnapshot(tripId, signal),
  ]);

  return { trip, vehicle, customProperties, pricing };
}
