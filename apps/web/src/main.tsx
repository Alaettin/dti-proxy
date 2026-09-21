import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./stil.css";

const wurzel = document.getElementById("wurzel");
if (wurzel === null) throw new Error("Element #wurzel fehlt in index.html");

createRoot(wurzel).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
