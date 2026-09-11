import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Body = clean system sans (reads like any well-set app, no eye strain).
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        // Data, labels, code, timestamps = monospace. Signature of the dbaops /
        // DuckDB look: uppercase mono labels + tabular data on warm paper.
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "SF Mono",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      colors: {
        paper: "#f6f7f8",
        ink: "#1d1b16",
        // Warm neutral. Overrides Tailwind's cool `slate` with a stone/tan ramp
        // (same lightness steps, so contrast is preserved) so every border, table,
        // hover and body text reads warm against the paper — no cold blue-gray.
        slate: {
          50: "#f8f9fa",
          100: "#eff1f3",
          200: "#e4e6ea",
          300: "#cfd2d8",
          400: "#9ca0a8",
          500: "#71757e",
          600: "#54575f",
          700: "#3f424a",
          800: "#292c33",
          900: "#1b1d22",
          950: "#121317",
        },
        // Brand = terracotta/clay. Replaces iris/indigo entirely — no purple
        // anywhere. Warm earthy accent that sits on paper and matches the coral
        // logo + red primary action of the dbaops reference.
        brand: {
          50: "#faf1eb",
          100: "#f2ddd0",
          200: "#e6bfa8",
          300: "#d89b79",
          400: "#ca7550",
          500: "#bc5836",
          600: "#a8482a",
          700: "#8c3a22",
          800: "#722f1e",
          900: "#5e281c",
          950: "#34140d",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
