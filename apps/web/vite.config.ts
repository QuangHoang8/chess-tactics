import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // @chess-tactics/domain resolves to a pnpm workspace symlink pointing outside
    // node_modules, so Rollup's commonjs plugin skips it under the default `include`
    // (node_modules-only) and its named-export detection never runs on the CJS build.
    commonjsOptions: { include: [/node_modules/, /packages\/domain/] },
  },
  optimizeDeps: {
    // Same symlink issue affects the dev server: Vite only pre-bundles (and
    // CJS->ESM converts) deps it finds in node_modules, so this workspace
    // package must be force-included or its named exports 404 at runtime.
    include: ["@chess-tactics/domain"],
  },
});
