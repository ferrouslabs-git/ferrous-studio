import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App";
import "./theme.css";

// Hash routing, not path routing: the prototype is served as one file from a
// storage URL it does not control, so the only part of the address it owns is
// what follows the #.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
