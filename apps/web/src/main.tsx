import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initTelegram } from "./lib/tg";
import { App, BootError } from "./App";

const root = createRoot(document.getElementById("root") as HTMLElement);

initTelegram()
  .then(() =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  )
  .catch((e: unknown) =>
    root.render(<BootError message={e instanceof Error ? e.message : String(e)} />),
  );
