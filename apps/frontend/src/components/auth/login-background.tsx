import type { ReactNode } from "react";

/**
 * The full-screen backdrop behind the login card.
 *
 * ── REPLACING THE ARTWORK ───────────────────────────────────────────────────
 * The image is NOT referenced here. It comes from the `--login-background-image`
 * CSS variable in `globals.css`, which currently holds a plain navy gradient.
 * To use the real photograph, put the file in `public/` and change that one
 * variable to `url("/login-background.jpg")`. No component changes, no external
 * URL in the source, nothing to hunt for.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The three layers exist so the card stays readable whatever the artwork turns
 * out to be: the image, a dark overlay that guarantees contrast, and the
 * content. Without the overlay a bright photograph would make white text on the
 * card's surroundings unreadable.
 */
export function LoginBackground({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-navigation">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-login bg-cover bg-center"
      />

      {/* Keeps contrast predictable no matter which image is dropped in. */}
      <div aria-hidden="true" className="absolute inset-0 bg-navigation/70" />

      <div className="relative flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
        {children}
      </div>
    </div>
  );
}
