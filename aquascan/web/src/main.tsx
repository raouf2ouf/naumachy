import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

// Theme: a stored choice wins, then the system preference. Set before the first paint.
try {
  const stored = localStorage.getItem("aquascan-theme");
  document.documentElement.dataset.theme = stored ?? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
} catch {
  document.documentElement.dataset.theme = "dark";
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
