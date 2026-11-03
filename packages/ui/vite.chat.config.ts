import { defineConfig, esmExternalRequirePlugin, mergeConfig } from "vite";
import ui from "./vite.config.ts";

// Ship a self-contained library: hosts only supply React and antd. Workspace-only
// dependencies and this package's private router/store are bundled into the artifact.
const config = mergeConfig(
  ui,
  defineConfig({
    plugins: [esmExternalRequirePlugin({ external: [/^(react|react-dom|antd)(\/|$)/] })],
    build: {
      outDir: "../chat/dist",
      emptyOutDir: true,
      lib: { entry: "src/chat.ts", formats: ["es"], fileName: "index", cssFileName: "style" },
      rollupOptions: {
        external: [],
      },
    },
  }),
);

// Override the UI build externals after merging: the plugin must own peer
// resolution so CommonJS dependencies can import those peers in browsers.
config.build!.rollupOptions!.external = [];
export default config;
