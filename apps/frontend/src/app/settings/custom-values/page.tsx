"use client";

import { useCallback, useState } from "react";

import { RittenDialog } from "@/components/ritten/ritten-dialog";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { ApiError, userFacingMessage } from "@/lib/api/client";
import {
  activateCustomProperty,
  createCustomProperty,
  deactivateCustomProperty,
  isRoutePriced,
  listCustomProperties,
  updateCustomProperty,
  type CustomPropertyPayload,
} from "@/lib/api/custom-properties";
import type { CustomProperty } from "@/lib/api/types";
import { useTranslation } from "@/lib/i18n/language-provider";
import type { TranslationKey } from "@/lib/i18n/translations";
import { cn } from "@/lib/cn";

/**
 * Settings → Custom waarden.
 *
 * ── FIXED PRICE VERSUS ROUTE-PRICED ─────────────────────────────────────────
 * A property either carries a fixed price the Pricing Engine reads, or it is
 * linked to a pricing component and the amount comes from the route
 * configuration. The backend refuses a default price on a linked property, so
 * a route-priced one shows "Route-afhankelijk" and offers NO price field at
 * all — an input that could only ever be rejected is worse than none.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Prices are shown exactly as the backend formatted them. Nothing here adds,
 * multiplies or rounds money.
 *
 * No identifier appears on screen. In particular the pricing component behind a
 * route-priced property is not shown: there is no endpoint that would turn its
 * id into a name, and a raw UUID tells an operator nothing.
 */

const PAGE_SIZE = 100;

interface Feedback {
  readonly messageKey: TranslationKey;
  readonly detail?: string;
  readonly isError: boolean;
}

export default function CustomValuesPage() {
  const t = useTranslation();

  const [editing, setEditing] = useState<CustomProperty | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const properties = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        listCustomProperties({ pageSize: PAGE_SIZE }, signal),
      [],
    ),
    [],
  );

  async function runMutation(
    id: string | null,
    operation: () => Promise<unknown>,
    successKey: TranslationKey,
  ): Promise<void> {
    setBusyId(id);
    setFeedback(null);

    try {
      await operation();

      properties.reload();
      setFeedback({ messageKey: successKey, isError: false });
    } catch (error: unknown) {
      setFeedback({
        messageKey: "settings.custom.failed",
        detail: userFacingMessage(error),
        isError: true,
      });

      throw error;
    } finally {
      setBusyId(null);
    }
  }

  function save(payload: CustomPropertyPayload): Promise<void> {
    return editing
      ? runMutation(
          editing.id,
          () => updateCustomProperty(editing.id, payload),
          "settings.custom.updated",
        )
      : runMutation(
          null,
          () => createCustomProperty(payload),
          "settings.custom.created",
        );
  }

  function toggleActivation(property: CustomProperty): void {
    if (
      property.isActive &&
      !window.confirm(t("settings.custom.confirmDeactivate"))
    ) {
      return;
    }

    void runMutation(
      property.id,
      () =>
        property.isActive
          ? deactivateCustomProperty(property.id)
          : activateCustomProperty(property.id),
      property.isActive
        ? "settings.custom.deactivated"
        : "settings.custom.activated",
    ).catch(() => undefined);
  }

  const isFirstLoad = properties.isLoading && !properties.data;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">
          {t("settings.custom.title")}
        </h1>

        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setIsCreating(true);
          }}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
        >
          + {t("settings.custom.new")}
        </button>
      </div>

      {feedback ? (
        <p
          role="status"
          className={cn(
            "rounded-md border px-4 py-2 text-sm",
            feedback.isError
              ? "border-danger/30 bg-danger/5 text-foreground"
              : "border-success/30 bg-success/5 text-foreground",
          )}
        >
          <span className="font-medium">{t(feedback.messageKey)}</span>
          {feedback.detail ? ` — ${feedback.detail}` : ""}
        </p>
      ) : null}

      {isFirstLoad ? <LoadingState label={t("settings.custom.loading")} /> : null}

      {!isFirstLoad && properties.error ? (
        <ErrorState error={properties.error} onRetry={properties.reload} />
      ) : null}

      {!isFirstLoad && !properties.error && properties.data ? (
        properties.data.items.length === 0 ? (
          <EmptyState
            title={t("settings.custom.empty")}
            description={t("settings.custom.emptyDescription")}
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[700px] text-left text-sm">
              <caption className="sr-only">{t("settings.custom.title")}</caption>
              <thead className="border-b border-border bg-hover/50 text-xs uppercase tracking-wide text-muted">
                <tr>
                  {[
                    "settings.custom.name",
                    "settings.custom.description",
                    "settings.custom.price",
                    "settings.custom.status",
                    "settings.custom.actions",
                  ].map((key) => (
                    <th
                      key={key}
                      scope="col"
                      className="whitespace-nowrap px-3 py-2 font-medium"
                    >
                      {t(key as TranslationKey)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {properties.data.items.map((property) => (
                  <PropertyRow
                    key={property.id}
                    property={property}
                    isBusy={busyId === property.id}
                    onEdit={() => {
                      setEditing(property);
                      setIsCreating(false);
                    }}
                    onToggleActivation={() => toggleActivation(property)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {isCreating || editing ? (
        <CustomPropertyDialog
          property={editing}
          onSave={save}
          onClose={() => {
            setIsCreating(false);
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function PropertyRow({
  property,
  isBusy,
  onEdit,
  onToggleActivation,
}: {
  property: CustomProperty;
  isBusy: boolean;
  onEdit: () => void;
  onToggleActivation: () => void;
}) {
  const t = useTranslation();

  return (
    <tr className="border-b border-border last:border-0 hover:bg-hover">
      <td className="px-3 py-2 font-medium text-foreground">{property.name}</td>
      <td className="px-3 py-2 text-secondary">
        {property.description ?? "—"}
      </td>
      <td className="px-3 py-2">
        {isRoutePriced(property) ? (
          <Badge tone="info">{t("settings.custom.routePriced")}</Badge>
        ) : (
          // Exactly as the backend formatted it; never recomputed.
          <span className="tabular-nums text-secondary">
            {property.defaultPrice === null ? "—" : `€ ${property.defaultPrice}`}
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        <Badge tone={property.isActive ? "success" : "neutral"}>
          {property.isActive
            ? t("settings.custom.active")
            : t("settings.custom.inactive")}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <span className="flex items-center gap-3">
          <button
            type="button"
            onClick={onEdit}
            disabled={isBusy}
            className="text-sm font-medium text-primary hover:underline disabled:opacity-50"
          >
            {t("settings.custom.edit")}
          </button>
          <button
            type="button"
            onClick={onToggleActivation}
            disabled={isBusy}
            className={cn(
              "text-sm font-medium disabled:opacity-50",
              property.isActive
                ? "text-danger hover:underline"
                : "text-primary hover:underline",
            )}
          >
            {property.isActive
              ? t("settings.custom.deactivate")
              : t("settings.custom.activate")}
          </button>
        </span>
      </td>
    </tr>
  );
}

/**
 * Creating and editing a property.
 *
 * A route-priced property shows no price field at all: the backend refuses a
 * default price on a linked property, so an input here could only produce a
 * rejection. The panel explains why instead.
 */
function CustomPropertyDialog({
  property,
  onSave,
  onClose,
}: {
  property: CustomProperty | null;
  onSave: (payload: CustomPropertyPayload) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslation();
  const routePriced = property !== null && isRoutePriced(property);

  const [name, setName] = useState(property?.name ?? "");
  const [description, setDescription] = useState(property?.description ?? "");
  const [price, setPrice] = useState(property?.defaultPrice ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      await onSave({
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
        // A linked property keeps its null; the field is not even offered.
        ...(routePriced
          ? {}
          : { defaultPrice: price.trim() === "" ? null : Number(price) }),
      });
      onClose();
    } catch (caught: unknown) {
      setError(caught);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <RittenDialog
      title={
        property
          ? t("settings.custom.editTitle")
          : t("settings.custom.createTitle")
      }
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="px-4 py-3">
        {error ? <FormError error={error} /> : null}

        <div className="grid grid-cols-1 gap-4">
          <Field label={t("settings.custom.name")} htmlFor="property-name">
            <input
              id="property-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </Field>

          <Field
            label={t("settings.custom.description")}
            htmlFor="property-description"
          >
            <input
              id="property-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            />
          </Field>

          {routePriced ? (
            <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2">
              <p className="text-sm font-medium text-foreground">
                {t("settings.custom.routePriced")}
              </p>
              <p className="mt-0.5 text-xs text-secondary">
                {t("settings.custom.routePricedLocked")}
              </p>
            </div>
          ) : (
            <Field
              label={t("settings.custom.fixedPrice")}
              htmlFor="property-price"
            >
              <input
                id="property-price"
                type="number"
                step="0.01"
                min={0}
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
              />
            </Field>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isSaving ? t("settings.custom.saving") : t("settings.custom.save")}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("settings.custom.cancel")}
          </button>
        </div>
      </form>
    </RittenDialog>
  );
}

function FormError({ error }: { error: unknown }) {
  const details =
    error instanceof ApiError && Array.isArray(error.details)
      ? (error.details as string[])
      : [];

  return (
    <div
      role="alert"
      className="mb-3 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
    >
      {userFacingMessage(error)}
      {details.length > 0 ? (
        <ul className="mt-1 list-inside list-disc text-xs">
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
