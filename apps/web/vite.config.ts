import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    include: [
      "@json-render/core",
      "@json-render/react",
      "@json-render/react/schema",
      "@shadcn/react/message-scroller",
    ],
  },
  plugins: [
    tanstackStart(),
    process.env["ALCHEMY_CLOUDFLARE_VITE_INJECTED"] === "1"
      ? undefined
      : nitro(),
    tailwindcss(),
    viteReact(),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("src", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
});
