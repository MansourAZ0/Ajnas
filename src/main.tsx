import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

async function boot() {
  // Development-only IPC mock for browser previews (`npm run dev`, then `/?mock`).
  if (import.meta.env.DEV && new URLSearchParams(location.search).has("mock"))
    await (await import("./dev/mockTauri")).installMockTauri();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
void boot();
