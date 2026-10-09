import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App";
import { queryClient } from "./lib/api";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster theme="dark" position="top-center" richColors closeButton offset={{ top: "max(env(safe-area-inset-top), 16px)" }} />
    </QueryClientProvider>
  </StrictMode>,
);
