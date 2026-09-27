import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tanstackStart(),
    process.env["ALCHEMY_CLOUDFLARE_VITE_INJECTED"] === "1"
      ? undefined
      : nitro(),
    tailwindcss(),
    viteReact(),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("src", import.meta.url)) } },
});
