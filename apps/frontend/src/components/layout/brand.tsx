import Image from "next/image";

import appLogo from "@/img/applogo.png";
import longLogoDarkInk from "@/img/darkmodus long logo.png";
import longLogoLightInk from "@/img/lightmodus long logo.png";
import { cn } from "@/lib/cn";

/**
 * TRAXO — the product's identity, in one component.
 *
 * ── THE THREE ASSETS, AND WHAT THEY ACTUALLY CONTAIN ────────────────────────
 * The filenames describe the INK, not the theme they belong to, and the two are
 * opposites. Checked rather than assumed:
 *
 *   darkmodus long logo.png   2172×724, transparent, NAVY ink
 *                             → for LIGHT surfaces
 *   lightmodus long logo.png  2172×724, transparent, WHITE ink
 *                             → for DARK surfaces
 *   applogo.png               1254×1254, OPAQUE, the rounded blue app tile
 *
 * Mapping a file called "darkmodus" onto dark mode would put navy ink on navy
 * and produce an invisible logo, so the mapping below is by content.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── WHY THE MARK IS CLIPPED ─────────────────────────────────────────────────
 * applogo.png has no alpha channel: the rounded tile sits on an opaque black
 * square with a 44px margin, which would show as a black box on any surface
 * that is not black. It is therefore rendered inside a rounded, clipping
 * container and scaled just past the margin, so only the tile itself is seen.
 * The asset is used exactly as delivered; only its presentation is cropped.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The wordmark carries "TRAXO" and "Transport Operations" as artwork, so no
 * text accompanies it. The accessible name lives on the image's alt text, once.
 */

/** The product name, as the mark spells it. Not interface copy, never translated. */
const BRAND_NAME = "TRAXO";
const BRAND_TAGLINE = "Transport Operations";
const LONG_LOGO_ALT = `${BRAND_NAME} — ${BRAND_TAGLINE}`;

/** 44px of black margin on a 1254px tile; 1.08 pushes it outside the clip. */
const APP_LOGO_OVERSCAN = "scale-[1.08]";

export type BrandSize = "compact" | "header" | "hero";

/** Rendered width of the wordmark, in pixels, per size. */
const LONG_LOGO_WIDTH: Record<BrandSize, number> = {
  compact: 120,
  header: 150,
  hero: 300,
};

export function Brand({
  size = "header",
  tone = "onDark",
  className,
  priority = false,
}: {
  size?: BrandSize;
  /**
   * Which surface this sits on.
   *
   * `onDark` is the common case — the application header and the login page are
   * both navy in either theme, so the ink must not follow the theme there.
   * `auto` is for a surface that does follow it, and swaps in CSS rather than in
   * JavaScript: reading the theme during render is what produces a flash of the
   * wrong logo, or a hydration mismatch.
   */
  tone?: "onDark" | "auto";
  className?: string;
  /** Set on the login page, where the wordmark is the largest thing on screen. */
  priority?: boolean;
}) {
  const width = LONG_LOGO_WIDTH[size];
  const height = Math.round((width * longLogoLightInk.height) / longLogoLightInk.width);

  if (tone === "onDark") {
    return (
      <Image
        src={longLogoLightInk}
        alt={LONG_LOGO_ALT}
        width={width}
        height={height}
        priority={priority}
        className={cn("h-auto w-auto", className)}
      />
    );
  }

  return (
    <span className={cn("inline-block", className)}>
      <Image
        src={longLogoDarkInk}
        alt={LONG_LOGO_ALT}
        width={width}
        height={height}
        priority={priority}
        className="h-auto w-auto dark:hidden"
      />
      <Image
        src={longLogoLightInk}
        alt=""
        aria-hidden="true"
        width={width}
        height={height}
        priority={priority}
        className="hidden h-auto w-auto dark:block"
      />
    </span>
  );
}

/**
 * The square mark, for places the wordmark cannot fit.
 *
 * A separate component rather than a `variant` prop: the two are used in
 * different situations and take different props, and a component that renders
 * either shape depending on a flag reads worse at every call site than two that
 * each say what they are.
 */
export function BrandMark({
  size = 36,
  className,
  isDecorative = false,
}: {
  /** Rendered edge length in pixels. */
  size?: number;
  className?: string;
  /**
   * True where the mark sits beside the product's name in text, so a screen
   * reader is not told "TRAXO" twice.
   */
  isDecorative?: boolean;
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        // The clip is what hides the asset's opaque black margin.
        "inline-flex shrink-0 overflow-hidden rounded-[22%]",
        className,
      )}
    >
      <Image
        src={appLogo}
        alt={isDecorative ? "" : BRAND_NAME}
        aria-hidden={isDecorative || undefined}
        width={size}
        height={size}
        className={cn("h-full w-full object-cover", APP_LOGO_OVERSCAN)}
      />
    </span>
  );
}
