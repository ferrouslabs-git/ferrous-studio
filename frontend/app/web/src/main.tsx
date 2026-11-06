import React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./styles/index.css";

const container = document.getElementById("root")!;
const tree = (
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// The landing page is prerendered into index.html at build time; hydrate it
// rather than throwing the markup away. The server sends that same index.html
// for every route, so anywhere but "/" the markup is the wrong page: hydrating
// it fails (#425/#423) and React re-renders the whole root to recover. Drop it
// and render fresh instead.
if (container.hasChildNodes() && window.location.pathname === "/") {
  hydrateRoot(container, tree);
} else {
  container.replaceChildren();
  createRoot(container).render(tree);
}
