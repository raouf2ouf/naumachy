import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

// Theme: light by default, a stored choice wins. Set before the first paint.
try {
  document.documentElement.dataset.theme = localStorage.getItem("aquascan-theme") ?? "light";
} catch {
  document.documentElement.dataset.theme = "light";
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
