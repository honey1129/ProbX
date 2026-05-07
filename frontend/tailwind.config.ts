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
        glow: "0 0 32px rgba(155, 92, 255, 0.22)",
        yes: "0 0 30px rgba(25, 245, 140, 0.18)",
        no: "0 0 30px rgba(255, 78, 92, 0.18)"
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
