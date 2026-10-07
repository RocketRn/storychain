import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <React.StrictMode>
    <main className="mx-auto max-w-[480px] p-6">
      <h1 className="text-2xl font-bold">StoryChain</h1>
      <p className="opacity-70">Placeholder</p>
    </main>
  </React.StrictMode>,
);
