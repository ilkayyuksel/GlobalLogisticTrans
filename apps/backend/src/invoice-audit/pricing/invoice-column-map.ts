import { Prisma } from "@prisma/client";

import type { EffectivePricing } from "../../trip-pricing/effective-pricing";
import type { InvoiceColumn } from "../workbook/invoice-columns";

/**
 * Which invoice column answers to which pricing component.
 *
 * ── THE INVOICE IS NOT OUR EXPORT ───────────────────────────────────────────
 * It is the customer's own weekly overview, and its columns are theirs. Most of
 * them line up with a component one to one; the toll does not, and that is the
 * one place this mapping has to say something more than a name.
 */

/** A component of the invoice, as the check compares it. */
export interface InvoiceComponent {
  /** What the report and the screen call it: the customer's own header. */
  readonly label: string;
  /**
   * The columns the invoice states this component in.
   *
   * Usually one. The toll is three, because the customer splits it by country
   * while this system holds a single figure — see `TOLL_COLUMNS`.
   */
  readonly columns: readonly InvoiceColumn[];
  /**
   * Where a correction is written when the columns disagree with us.
   *
   * For the toll this is a decision backed by the documents rather than a
   * preference: see the note on `TOLL_COLUMNS`.
   */
  readonly correctionColumn: InvoiceColumn;
  /** What this system holds for it. */
  readonly expected: (pricing: EffectivePricing) => Prisma.Decimal;
}

/**
 * ── WHY THE TOLL IS COMPARED AS A SUM AND CORRECTED IN TOL B ────────────────
 * The customer prints three toll columns — Maut, Tol B and Tol FR — while this
 * system holds ONE `tol` figure, derived from the route's kilometres and the
 * configured rate. There is no rule anywhere in this system that could split
 * that figure by country, and inventing one would put numbers in cells nobody
 * computed.
 *
 * So the three are compared as their SUM, which is the only comparison the data
 * supports. The correction goes to Tol B, and that is read off the documents
 * rather than chosen:
 *
 *   * in all four reference workbooks — two weeks, each as received and as the
 *     customer corrected it — Maut and Tol FR are EMPTY on every single data
 *     row (0 of 98, 0 of 129), while Tol B carries a figure on nearly all of
 *     them (97 of 98, 123 of 129);
 *   * Maut and Tol FR are hidden columns (width 0) in every one of those files,
 *     and Tol B is visible;
 *   * every toll correction the customer themselves made in the corrected
 *     versions — 28 cells in week 35 — is a Tol B cell.
 *
 * Writing into a hidden column the customer never fills would produce a figure
 * nobody would see, and splitting one amount across three cells would state
 * three facts we do not have. The hidden/visible state of the columns is never
 * touched.
 */
const TOLL_COLUMNS: readonly InvoiceColumn[] = ["maut", "tolB", "tolFr"];

/**
 * Every component the check compares, in the order the invoice prints them.
 *
 * The order matters only for how a report reads; nothing depends on it.
 */
export const INVOICE_COMPONENTS: readonly InvoiceComponent[] = [
  {
    label: "Tarief",
    columns: ["tarief"],
    correctionColumn: "tarief",
    expected: (pricing) => pricing.tarief,
  },
  {
    label: "Fuel",
    columns: ["fuel"],
    correctionColumn: "fuel",
    expected: (pricing) => pricing.brandstof,
  },
  {
    label: "Backload",
    columns: ["backload"],
    correctionColumn: "backload",
    /*
     * The Combination surcharge as the Engine resolved it for THIS Trip. Group
     * membership is already in that figure, so nothing here reads a partner, a
     * group or the other rows of the invoice.
     */
    expected: (pricing) => pricing.backload,
  },
  {
    label: "Tol",
    columns: TOLL_COLUMNS,
    correctionColumn: "tolB",
    expected: (pricing) => pricing.tol,
  },
  {
    label: "Tunnel",
    columns: ["tunnel"],
    correctionColumn: "tunnel",
    expected: (pricing) => pricing.tunnel,
  },
  {
    label: "Others",
    columns: ["others"],
    correctionColumn: "others",
    /*
     * Exactly what this system reports, waiting time included: `others` is the
     * effective figure and is never recomputed here. The invoice has no waiting
     * column, so the two meet in this one.
     */
    expected: (pricing) => pricing.others,
  },
  {
    label: "EK",
    columns: ["ek"],
    correctionColumn: "ek",
    /*
     * One figure however many Cost Confirmations a Trip received: the backend
     * sums them. The invoice may state them as several lines, which is why the
     * comparison adds the invoice's side up first — see the reconciliation.
     */
    expected: (pricing) => pricing.ek,
  },
];
