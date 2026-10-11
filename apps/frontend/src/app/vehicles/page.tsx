"use client";

import { Suspense, useCallback, useState } from "react";

import { DriversSection } from "@/components/drivers/drivers-section";
import { VehicleDriverLinksSection } from "@/components/fleet/vehicle-driver-links-section";
import { VehiclesSection } from "@/components/vehicles/vehicles-section";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Vehicles & drivers — one page for the fleet and the people who drive it.
 *
 *   A. today's driver per truck, linked and ended from the row;
 *   B. the drivers;
 *   C. the vehicles.
 *
 * The sections own their own data. `version` is the one thing they share: any
 * change in one — a new link, a deactivated driver, a new truck — makes the
 * others read again, so the three never disagree about who drives what.
 *
 * `/drivers` redirects here (to `#chauffeurs`); `/vehicles/{id}` keeps the
 * detail page with the dated assignment history.
 */
export default function FleetPage() {
  // useSearchParams needs a Suspense boundary on a statically rendered page.
  return (
    <Suspense fallback={null}>
      <FleetSections />
    </Suspense>
  );
}

function FleetSections() {
  const t = useTranslation();
  const [version, setVersion] = useState(0);
  const changed = useCallback(() => setVersion((current) => current + 1), []);

  return (
    <div className="mx-auto max-w-[1400px] space-y-8">
      <h1 className="text-xl font-semibold text-foreground">{t("fleet.title")}</h1>

      <VehicleDriverLinksSection version={version} onChanged={changed} />
      <DriversSection version={version} onChanged={changed} />
      <VehiclesSection version={version} onChanged={changed} />
    </div>
  );
}
