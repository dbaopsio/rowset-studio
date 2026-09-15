import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";
import { router } from "./app/router";
import { initAuth } from "./lib/auth";
import { ApiError } from "./lib/api";
import "./index.css";

// A browser tab can outlive a desktop-app update. If it then opens a lazy
// route, its old bundle asks the new server for a chunk that no longer exists.
// Vite exposes that exact failure so we can load the new index and asset set
// automatically instead of leaving the URL on the new route with stale UI.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  window.location.reload();
});

// Restore any persisted JWT into the api layer before the first request.
initAuth();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => !(error instanceof ApiError && [401, 403, 429].includes(error.status)) && failureCount < 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
