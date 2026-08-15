import type { Config } from "tailwindcss";

// Color tokens and radii are defined once, in src/app/globals.css's
// `@theme inline` block (Tailwind v4's CSS-native theming) — not
// duplicated here. Animation utilities come from the `tw-animate-css`
// CSS import in globals.css, not a JS plugin. This file only carries
// what v4 still wants from JS: content globs and dark-mode strategy.
const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
};
export default config;
