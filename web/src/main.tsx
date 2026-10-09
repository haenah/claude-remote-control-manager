import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App";
import { queryClient } from "./lib/api";
import "./index.css";

// Phones (<600px) use mobileOffset, so both need the notch clearance.
const safeTop = "max(var(--safe-top), 16px)";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        theme="dark"
        position="top-center"
        richColors
        closeButton
        offset={{ top: safeTop }}
        mobileOffset={{ top: safeTop }}
      />
    </QueryClientProvider>
  </StrictMode>,
);
