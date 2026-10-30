import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import SiteGate from "./components/SiteGate";
import { SiteContentProvider } from "./hooks/useSiteContent";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SiteContentProvider>
        <SiteGate>
          <App />
        </SiteGate>
      </SiteContentProvider>
    </BrowserRouter>
  </StrictMode>,
);
