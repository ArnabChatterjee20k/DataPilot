import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

import App from "./App.tsx";
import queryClient from "./lib/queryClient.ts";
import "./index.css";

// the devtools toggle floats over the bottom-right of the app, where it covers
// real controls - so it is a development-only affordance
const showDevtools = import.meta.env.DEV && !import.meta.env.VITE_HIDE_DEVTOOLS;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {showDevtools && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>
);
