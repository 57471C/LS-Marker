import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { ignoreLabelFolder, labellingApiPlugin } from "./scripts/labelling-api.mjs";

export default defineConfig(() => {
  const port = Number(process.env.PORT) || 8080;
  return {
    server: {
      host: "0.0.0.0",
      port,
      strictPort: process.env.STRICT_PORT === "true",
      watch: {
        ignored: ["**/data/**", "**/*.db", "**/*.db-*", ignoreLabelFolder],
      },
    },
    preview: {
      host: "127.0.0.1",
      port: Number(process.env.PREVIEW_PORT) || 8081,
      strictPort: true,
    },
    resolve: { tsconfigPaths: true },
    optimizeDeps: {
      exclude: ["onnxruntime-web"],
    },
    plugins: [labellingApiPlugin(), tailwindcss(), tanstackStart(), viteReact()],
  };
});
