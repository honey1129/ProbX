import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@solana/wallet-adapter-react-ui/styles.css";
import "@/app/globals.css";
import { App } from "@/App";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
