import { defineConfig, mergeConfig } from "vite";
import ui from "./vite.config.ts";

// Ship a self-contained library: hosts only supply React and antd. Workspace-only
// dependencies and this package's private router/store are bundled into the artifact.
export default mergeConfig(
  ui,
  defineConfig({
    build: {
      outDir: "../chat/dist",
      emptyOutDir: true,
      lib: { entry: "src/chat.ts", formats: ["es"], fileName: "index", cssFileName: "style" },
      rollupOptions: {
        external: (id: string) => /^(react|react-dom|antd)(\/|$)/.test(id),
      },
    },
  }),
);
