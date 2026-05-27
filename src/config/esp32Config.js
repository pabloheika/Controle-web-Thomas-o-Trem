const STORAGE_KEY = "esp32_base_url";
const DEV_PROXY_PREFIX = "/esp";

/** Le e normaliza VITE_ESP_TARGET (com ou sem http://). */
export function getEspTargetUrl() {
  const raw = import.meta.env.VITE_ESP_TARGET?.trim() ?? "";
  if (!raw) {
    return "";
  }
  if (raw === DEV_PROXY_PREFIX || raw.startsWith(`${DEV_PROXY_PREFIX}/`)) {
    return "";
  }
  let url = raw;
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url.replace(/\/+$/, "");
}

/** URL padrao da ESP — sempre derivada do .env.local */
export const DEFAULT_ESP_BASE_URL = getEspTargetUrl();

export function isDevProxyEnabled() {
  return import.meta.env.DEV && import.meta.env.VITE_ESP_USE_PROXY !== "false";
}

export function getEspProxyTarget() {
  return getEspTargetUrl();
}

function isPrivateLanHost(hostname) {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  if (hostname.startsWith("192.168.")) return true;
  if (hostname.startsWith("10.")) return true;
  return /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
}

function isPrivateNetworkUrl(url) {
  try {
    const { hostname } = new URL(url);
    return isPrivateLanHost(hostname);
  } catch {
    return false;
  }
}

export function normalizeEspBaseUrl(input) {
  let url = (input ?? "").trim();
  if (!url) {
    return getEspTargetUrl();
  }
  if (url === DEV_PROXY_PREFIX || url.startsWith(`${DEV_PROXY_PREFIX}/`)) {
    return getEspTargetUrl();
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url.replace(/\/+$/, "");
}

export function resolveFetchBaseUrl(storedUrl) {
  const normalized = normalizeEspBaseUrl(storedUrl);
  if (isDevProxyEnabled() && normalized && isPrivateNetworkUrl(normalized)) {
    return DEV_PROXY_PREFIX;
  }
  return normalized;
}

export function loadEspBaseUrl() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalizeEspBaseUrl(saved) : getEspTargetUrl();
  } catch {
    return getEspTargetUrl();
  }
}

export function loadEspFetchBaseUrl() {
  return resolveFetchBaseUrl(loadEspBaseUrl());
}

export function saveEspBaseUrl(url) {
  const normalized = normalizeEspBaseUrl(url);
  localStorage.setItem(STORAGE_KEY, normalized);
  return normalized;
}
