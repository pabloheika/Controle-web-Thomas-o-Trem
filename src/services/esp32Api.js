import {
  getEspTargetUrl,
  normalizeEspBaseUrl,
  resolveFetchBaseUrl,
} from "../config/esp32Config.js";

const TELEMETRY_TIMEOUT_MS = 2500;
const COMMAND_TIMEOUT_MS = 5000;

/** Intervalo de polling para telemetria em tempo quase real (ms). */
export const TELEMETRY_POLL_MS = 1000;

export function buildEspApi(baseUrl) {
  const root = resolveFetchBaseUrl(baseUrl);
  return {
    baseUrl: root,
    storedBaseUrl: normalizeEspBaseUrl(baseUrl),
    telemetry: `${root}/api/telemetry`,
    logs: `${root}/api/logs`,
    command: `${root}/api/command`,
  };
}

function formatFetchError(err, url) {
  const msg = err?.message ?? String(err);
  if (msg === "Failed to fetch" || err?.name === "TypeError") {
    const esp = getEspTargetUrl() || "(defina VITE_ESP_TARGET em .env.local)";
    return (
      `Sem resposta de ${url}. Em localhost o Chrome pode bloquear IP da rede local — ` +
      `use o proxy (reinicie npm run dev) ou abra ${esp}/api/telemetry no navegador para testar.`
    );
  }
  return msg;
}

export async function fetchTelemetry(api, { signal } = {}) {
  try {
    const res = await fetch(api.telemetry, {
      signal: signal ?? AbortSignal.timeout(TELEMETRY_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  } catch (err) {
    throw new Error(formatFetchError(err, api.telemetry), { cause: err });
  }
}

export async function fetchLogs(api, { signal } = {}) {
  try {
    const res = await fetch(api.logs, {
      signal: signal ?? AbortSignal.timeout(TELEMETRY_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  } catch (err) {
    throw new Error(formatFetchError(err, api.logs), { cause: err });
  }
}

export async function sendCommand(api, cmd, payload = null, { signal } = {}) {
  try {
    const body = payload ? { cmd, payload } : { cmd };
    const res = await fetch(api.command, {
      method: "POST",
      signal: signal ?? AbortSignal.timeout(COMMAND_TIMEOUT_MS),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
  } catch (err) {
    throw new Error(formatFetchError(err, api.command), { cause: err });
  }
}
