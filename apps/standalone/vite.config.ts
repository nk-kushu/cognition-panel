import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { defineConfig } from "vite";

const ui = (path: string) =>
  fileURLToPath(new URL(`../../packages/ui/src/${path}`, import.meta.url));
const require = createRequire(import.meta.url);

export default defineConfig(async ({ command }) => ({
  plugins: [
    command === "serve" && {
      ...(await babel({
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        include: /\.[jt]sx$/,
        plugins: [require.resolve("@locator/babel-jsx")],
      })),
      enforce: "pre",
    },
    react(),
    tailwindcss(),
  ],
  resolve: {
    // Plugin entries live outside the host package; always use the host UI runtime.
    dedupe: ["react", "react-dom", "antd"],
    // Build the panel from source: HMR in dev, one Tailwind pass over the ui sources.
    alias: [
      { find: /^@kushex\/ui$/, replacement: ui("index.ts") },
      { find: /^@kushex\/ui\/style\.css$/, replacement: ui("shared/styles/index.css") },
      { find: /^@kushex\/ui\/preflight\.css$/, replacement: ui("shared/styles/preflight.css") },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000",
        changeOrigin: false,
        rewrite: (path: string) => path.replace(/^\/api(?=\/|$)/, ""),
      },
    },
  },
}));
