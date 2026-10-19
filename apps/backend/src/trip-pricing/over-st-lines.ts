/**
 * How the Over ST lines of a snapshot name themselves.
 *
 * Written by the Pricing Engine (`combination-over-st.ts`) and read back here
 * to say whether a stored calculation applied Over ST — from the stored lines,
 * never by deciding it again. One definition for both sides, so the two can
 * never drift apart.
 */

/** An Over ST addition to the later leg's Tarief, Toll or Tunnel. */
export const OVER_ST_DESCRIPTION = "Over ST";

/** The fixed Over ST surcharge on the later leg's Tarief. */
export const OVER_ST_SURCHARGE_DESCRIPTION = "Over ST toeslag";
