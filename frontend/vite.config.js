import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("motion") || id.includes("framer-motion")) return "motion";
          if (id.includes("react")) return "react";
          return "vendor";
        },
      },
    },
  },
});
