import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/** Mesma variavel que src/config/esp32Config.js — edite apenas em .env.local */
function normalizeEspTarget(raw) {
  const value = (raw ?? "").trim();
  if (!value) return "";
  let url = value;
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url.replace(/\/+$/, "");
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const espTarget = normalizeEspTarget(env.VITE_ESP_TARGET);

  if (mode === "development" && !espTarget) {
    console.warn(
      "[vite] VITE_ESP_TARGET nao definido. Copie .env.example para .env.local e defina o IP da ESP.",
    );
  }

  return {
    plugins: [react()],
    server: {
      proxy: espTarget
        ? {
            "/esp": {
              target: espTarget,
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/esp/, ""),
            },
          }
        : undefined,
    },
  };
});
