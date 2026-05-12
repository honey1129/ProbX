import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#030609",
        panel: "rgba(6, 18, 25, 0.82)",
        line: "rgba(132, 185, 255, 0.16)",
        muted: "#8a9aae",
        yes: "#19f58c",
        no: "#ff4e5c",
        solPurple: "#9b5cff",
        solBlue: "#31b9ff"
      },
      boxShadow: {
        glow: "none",
        yes: "none",
        no: "none"
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "Segoe UI",
          "sans-serif"
        ]
      }
    }
  },
  plugins: []
};

export default config;
