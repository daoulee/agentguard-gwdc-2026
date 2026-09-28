import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": process.env.AGENTGUARD_API_TARGET || "http://localhost:8787"
    }
  },
  preview: {
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/api": process.env.AGENTGUARD_API_TARGET || "http://localhost:8787"
    }
  }
});
