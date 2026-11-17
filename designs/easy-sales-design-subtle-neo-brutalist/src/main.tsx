import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "@fontsource-variable/inter/wght.css";
import { App } from "./App";
import { ToastProvider } from "./ui/controls";
import "./theme.css";

// Hash routing, not path routing: the prototype is served as one file from a
// storage URL it does not control, so the only part of the address it owns is
// what follows the #. Inter is bundled from the package, so no font is fetched.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </HashRouter>
  </StrictMode>,
);
