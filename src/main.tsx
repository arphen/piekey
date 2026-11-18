import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initCalibration } from "./listen/calibration";
import { registerOfflineShell } from "./pwa";
import "./styles.css";

// Apply the saved microphone calibration before the first render.
initCalibration();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerOfflineShell();
