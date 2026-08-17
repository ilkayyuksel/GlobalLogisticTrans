import type { Config } from "tailwindcss";

/**
 * The palette from `docs/03-ui/design_tokens.md`, expressed once.
 *
 * Colours are referenced through CSS variables rather than written as hex
 * values here, so light and dark themes swap by redefining the variables in
 * `globals.css` instead of by duplicating every utility with a `dark:` variant.
 * It is also the shape shadcn/ui expects, which keeps adopting its components a
 * drop-in rather than a migration.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "rgb(var(--color-background) / <alpha-value>)",
        card: "rgb(var(--color-card) / <alpha-value>)",
        sidebar: "rgb(var(--color-sidebar) / <alpha-value>)",
        border: "rgb(var(--color-border) / <alpha-value>)",
        hover: "rgb(var(--color-hover) / <alpha-value>)",
        foreground: "rgb(var(--color-text-primary) / <alpha-value>)",
        secondary: "rgb(var(--color-text-secondary) / <alpha-value>)",
        muted: "rgb(var(--color-text-muted) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--color-primary) / <alpha-value>)",
          hover: "rgb(var(--color-primary-hover) / <alpha-value>)",
          pressed: "rgb(var(--color-primary-pressed) / <alpha-value>)",
        },
        success: "rgb(var(--color-success) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        info: "rgb(var(--color-info) / <alpha-value>)",

        /* Presentation-only hues that mark the legs of one Combination. */
        combination: {
          1: "rgb(var(--color-combination-1) / <alpha-value>)",
          2: "rgb(var(--color-combination-2) / <alpha-value>)",
          3: "rgb(var(--color-combination-3) / <alpha-value>)",
          4: "rgb(var(--color-combination-4) / <alpha-value>)",
          5: "rgb(var(--color-combination-5) / <alpha-value>)",
          6: "rgb(var(--color-combination-6) / <alpha-value>)",
        },

        /* The brand navigation surface, dark in both themes. */
        navigation: {
          DEFAULT: "rgb(var(--color-navigation) / <alpha-value>)",
          raised: "rgb(var(--color-navigation-raised) / <alpha-value>)",
          foreground: "rgb(var(--color-navigation-text) / <alpha-value>)",
          muted: "rgb(var(--color-navigation-muted) / <alpha-value>)",
          border: "rgb(var(--color-navigation-border) / <alpha-value>)",
        },
      },
      backgroundImage: {
        /* Swapped for the real artwork by redefining one CSS variable. */
        login: "var(--login-background-image)",
      },
      borderColor: {
        DEFAULT: "rgb(var(--color-border) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};

export default config;
