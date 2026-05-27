import { useState, useEffect, useRef, useCallback } from "react";
import styles from "./ControlPanel.module.css";
import {
  loadEspBaseUrl,
  saveEspBaseUrl,
  DEFAULT_ESP_BASE_URL,
  isDevProxyEnabled,
  getEspProxyTarget,
} from "../config/esp32Config.js";
import {
  buildEspApi,
  fetchTelemetry,
  sendCommand as postCommand,
  TELEMETRY_POLL_MS,
} from "../services/esp32Api.js";
import {
  formatMpuTemp,
  formatTelemetryLogLine,
  formatUptime,
} from "../utils/telemetryFormat.js";

const MAX_EVENT_LOG = 40;
const MAX_STREAM_LOG = 60;

function createLogId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const STATUS = {
  IDLE: { label: "AGUARDANDO", color: "var(--text-dim)", dot: "idle" },
  RISING: { label: "SUBINDO", color: "var(--accent)", dot: "active" },
  LOWERING: { label: "DESCENDO", color: "var(--warning)", dot: "warning" },
  STOPPED: { label: "PARADO", color: "var(--success)", dot: "success" },
  ERROR: { label: "ERRO", color: "var(--danger)", dot: "error" },
};

function syncStatusFromTelemetry(data, setStatus) {
  if (data.atuador === "subindo") setStatus("RISING");
  else if (data.atuador === "descendo") setStatus("LOWERING");
  else if (data.atuador === "parado") {
    setStatus((prev) => (prev === "IDLE" ? "IDLE" : "STOPPED"));
  }
}

function useESP32(espBaseUrl) {
  const [status, setStatus] = useState("IDLE");
  const [loading, setLoading] = useState(false);
  const [eventLog, setEventLog] = useState([]);
  const [streamLog, setStreamLog] = useState([]);
  const [connected, setConnected] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const api = buildEspApi(espBaseUrl);

  const addEvent = useCallback((msg, level = "info") => {
    const time = new Date().toLocaleTimeString("pt-BR");
    setEventLog((prev) =>
      [
        { id: createLogId(), time, type: "event", level, message: msg },
        ...prev,
      ].slice(0, MAX_EVENT_LOG),
    );
  }, []);

  const pushStreamEntry = useCallback((data) => {
    const time = new Date().toLocaleTimeString("pt-BR");
    setStreamLog((prev) =>
      [
        {
          id: createLogId(),
          time,
          type: "telemetry",
          message: formatTelemetryLogLine(data),
          data,
        },
        ...prev,
      ].slice(0, MAX_STREAM_LOG),
    );
  }, []);

  const applyTelemetry = useCallback(
    (data, { silent = false, logStream = true } = {}) => {
      setTelemetry(data);
      setConnected(true);
      setLastUpdated(new Date());
      syncStatusFromTelemetry(data, setStatus);
      if (logStream) pushStreamEntry(data);
      if (!silent) addEvent("Telemetria recebida", "success");
    },
    [addEvent, pushStreamEntry],
  );

  const applyTelemetryError = useCallback(
    (err, silent) => {
      setConnected(false);
      setTelemetry(null);
      setLastUpdated(null);
      if (!silent)
        addEvent(`Falha ao obter telemetria: ${err.message}`, "error");
    },
    [addEvent],
  );

  const fetchTelemetryData = useCallback(
    async (silent = false) => {
      try {
        const data = await fetchTelemetry(api);
        applyTelemetry(data, { silent, logStream: true });
      } catch (err) {
        applyTelemetryError(err, silent);
      }
    },
    [api, applyTelemetry, applyTelemetryError],
  );

  const sendCommand = useCallback(
    async (cmd, nextStatus, logMsg) => {
      if (loading) return;
      setLoading(true);
      setStatus(nextStatus);
      addEvent(logMsg);
      try {
        const data = await postCommand(api, cmd);
        addEvent(`ESP32 respondeu: ${JSON.stringify(data)}`, "success");
        setConnected(true);
        await fetchTelemetryData(true);
      } catch (err) {
        setStatus("ERROR");
        setConnected(false);
        addEvent(`Falha na comunicação: ${err.message}`, "error");
      } finally {
        setLoading(false);
      }
    },
    [api, loading, addEvent, fetchTelemetryData],
  );

  const testConnection = useCallback(async () => {
    setLoading(true);
    addEvent("Testando conexão (noop)...");
    try {
      const data = await postCommand(api, "noop");
      addEvent(`Conexão OK: ${JSON.stringify(data)}`, "success");
      setConnected(true);
      await fetchTelemetryData(true);
    } catch (err) {
      setConnected(false);
      setTelemetry(null);
      setLastUpdated(null);
      addEvent(`Teste falhou: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [api, addEvent, fetchTelemetryData]);

  const acionar = useCallback(
    () =>
      sendCommand("acionar", "RISING", "Acionando atuador — gancho subindo..."),
    [sendCommand],
  );
  const recolher = useCallback(
    () =>
      sendCommand(
        "recolher",
        "LOWERING",
        "Recolhendo atuador — gancho descendo...",
      ),
    [sendCommand],
  );
  const parar = useCallback(
    () => sendCommand("parar", "STOPPED", "Comando de parada enviado"),
    [sendCommand],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await fetchTelemetry(api);
        if (cancelled) return;
        applyTelemetry(data, { silent: true, logStream: true });
      } catch (err) {
        if (cancelled) return;
        applyTelemetryError(err, true);
      }
    })();

    const interval = setInterval(() => {
      fetchTelemetryData(true);
    }, TELEMETRY_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    espBaseUrl,
    api,
    applyTelemetry,
    applyTelemetryError,
    fetchTelemetryData,
  ]);

  return {
    status,
    loading,
    eventLog,
    streamLog,
    connected,
    telemetry,
    lastUpdated,
    espBaseUrl: api.storedBaseUrl,
    fetchBaseUrl: api.baseUrl,
    acionar,
    recolher,
    parar,
    testConnection,
    fetchTelemetry: fetchTelemetryData,
  };
}

function StatusDot({ type }) {
  return <span className={`${styles.dot} ${styles[`dot_${type}`]}`} />;
}

function EspConfigBar({ baseUrl, fetchBaseUrl, onSave, onTest, testing }) {
  const [input, setInput] = useState(baseUrl);
  const [saved, setSaved] = useState(false);

  const handleSave = (e) => {
    e.preventDefault();
    onSave(input);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <form className={styles.ipBar} onSubmit={handleSave}>
      <span className={styles.monoText}>ESP32 →</span>
      <input
        className={styles.ipInput}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={DEFAULT_ESP_BASE_URL}
        spellCheck={false}
        aria-label="Endereço da ESP32"
      />
      <button type="submit" className={styles.ipSaveBtn}>
        {saved ? "Salvo" : "Conectar"}
      </button>
      <button
        type="button"
        className={styles.ipTestBtn}
        onClick={onTest}
        disabled={testing}
      >
        Testar
      </button>
      <span className={styles.ipHint}>
        {isDevProxyEnabled() && fetchBaseUrl === "/esp"
          ? `Dev: requisições via ${fetchBaseUrl} → ${getEspProxyTarget()} (reinicie npm run dev se mudar o IP)`
          : "IP do monitor serial · GET /api/telemetry"}
      </span>
    </form>
  );
}

function LiveBadge({ connected, lastUpdated }) {
  const live = connected && lastUpdated;
  const timeStr = lastUpdated?.toLocaleTimeString("pt-BR") ?? "—";

  return (
    <span className={styles.liveBadge}>
      <span
        className={`${styles.liveDot} ${live ? styles.liveDotActive : ""}`}
      />
      {connected === null
        ? "sincronizando..."
        : connected
          ? `ao vivo · ${timeStr}`
          : "offline"}
    </span>
  );
}

function LiveTelemetryBlock({ data, connected }) {
  if (!data || !connected) {
    return (
      <div className={styles.liveBlock}>
        <span className={styles.liveBlockEmpty}>
          {connected === false
            ? "ESP offline — aguardando conexão..."
            : "Aguardando primeira leitura..."}
        </span>
      </div>
    );
  }

  const mask = data.qtr8rc
    ? Number(data.qtr8rc.black_mask).toString(2).padStart(8, "0")
    : null;

  return (
    <div className={styles.liveBlock}>
      <div className={styles.liveRow}>
        <span className={styles.liveKey}>UPTIME</span>
        <span>{formatUptime(data.uptime_ms)}</span>
        <span className={styles.liveKey}>RSSI</span>
        <span>{data.wifi_rssi ?? "—"} dBm</span>
        <span className={styles.liveKey}>ATUADOR</span>
        <span className={styles.liveHighlight}>{data.atuador ?? "—"}</span>
      </div>
      {data.mpu6050 && (
        <div className={styles.liveRow}>
          <span className={styles.liveKey}>ACCEL</span>
          <span>
            {data.mpu6050.accel_x} / {data.mpu6050.accel_y} /{" "}
            {data.mpu6050.accel_z}
          </span>
          <span className={styles.liveKey}>GYRO</span>
          <span>
            {data.mpu6050.gyro_x} / {data.mpu6050.gyro_y} /{" "}
            {data.mpu6050.gyro_z}
          </span>
          <span className={styles.liveKey}>TEMP</span>
          <span>{formatMpuTemp(data.mpu6050.temp)}</span>
        </div>
      )}
      {data.qtr8rc && (
        <div className={styles.liveRow}>
          <span className={styles.liveKey}>LINHA</span>
          <span
            className={
              data.qtr8rc.line_detected ? styles.liveSuccess : undefined
            }
          >
            {data.qtr8rc.line_detected ? "SIM" : "NÃO"}
          </span>
          <span className={styles.liveKey}>MASK</span>
          <span className={styles.liveMono}>{mask}</span>
        </div>
      )}
    </div>
  );
}

function SystemLogPanel({
  telemetry,
  connected,
  lastUpdated,
  eventLog,
  streamLog,
}) {
  const streamRef = useRef(null);

  useEffect(() => {
    if (streamRef.current) {
      streamRef.current.scrollTop = 0;
    }
  }, [streamLog]);

  return (
    <div className={styles.logBox}>
      <div className={styles.logHeader}>
        <span className={styles.monoText}>LOG DO SISTEMA</span>
        <LiveBadge connected={connected} lastUpdated={lastUpdated} />
      </div>

      <div className={styles.logSection}>
        <div className={styles.logSectionTitle}>
          <span>ESP — AO VIVO</span>
          <span className={styles.logSectionHint}>
            atualiza a cada {TELEMETRY_POLL_MS / 1000}s
          </span>
        </div>
        <LiveTelemetryBlock data={telemetry} connected={connected} />
      </div>

      <div className={styles.logSection}>
        <div className={styles.logSectionTitle}>
          <span>HISTÓRICO DE LEITURAS</span>
          <span className={styles.logSectionHint}>
            {streamLog.length} amostras
          </span>
        </div>
        <div className={styles.logStream} ref={streamRef}>
          {streamLog.length === 0 ? (
            <span className={styles.logEmpty}>— aguardando telemetria —</span>
          ) : (
            streamLog.map((entry) => (
              <div key={entry.id} className={styles.logStreamEntry}>
                <span className={styles.logTime}>{entry.time}</span>
                <span className={styles.logStreamMsg}>{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className={styles.logSection}>
        <div className={styles.logSectionTitle}>
          <span>EVENTOS</span>
          <span className={styles.logSectionHint}>
            {eventLog.length} entradas
          </span>
        </div>
        <div className={styles.logEntries}>
          {eventLog.length === 0 ? (
            <span className={styles.logEmpty}>— sem eventos —</span>
          ) : (
            eventLog.map((entry) => (
              <div
                key={entry.id}
                className={`${styles.logEntry} ${
                  entry.level === "error"
                    ? styles.logError
                    : entry.level === "success"
                      ? styles.logSuccess
                      : ""
                }`}
              >
                <span className={styles.logTime}>{entry.time}</span>
                {entry.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function TelemetryPanel({ data, connected, lastUpdated }) {
  if (!data) {
    return (
      <div className={styles.telemetry}>
        <div className={styles.telemetryHeader}>
          <span className={styles.monoText}>TELEMETRIA</span>
          <LiveBadge connected={connected} lastUpdated={lastUpdated} />
        </div>
        <span className={styles.telemetryEmpty}>— sem dados —</span>
      </div>
    );
  }

  const uptime = formatUptime(data.uptime_ms);
  const tempC = formatMpuTemp(data.mpu6050?.temp);

  return (
    <div className={styles.telemetry}>
      <div className={styles.telemetryHeader}>
        <span className={styles.monoText}>TELEMETRIA</span>
        <LiveBadge connected={connected} lastUpdated={lastUpdated} />
      </div>
      <div className={styles.telemetryGrid}>
        <div className={styles.telemetryGroup}>
          <span className={styles.telemetryLabel}>UPTIME</span>
          <span className={styles.telemetryValue}>{uptime}</span>
        </div>
        <div className={styles.telemetryGroup}>
          <span className={styles.telemetryLabel}>Wi-Fi RSSI</span>
          <span className={styles.telemetryValue}>
            {data.wifi_rssi != null ? `${data.wifi_rssi} dBm` : "—"}
          </span>
        </div>
        <div className={styles.telemetryGroup}>
          <span className={styles.telemetryLabel}>ATUADOR</span>
          <span className={styles.telemetryValue}>{data.atuador ?? "—"}</span>
        </div>

        {data.mpu6050 && (
          <>
            <div className={styles.telemetryGroup}>
              <span className={styles.telemetryLabel}>ACCEL X/Y/Z</span>
              <span className={styles.telemetryValue}>
                {data.mpu6050.accel_x} / {data.mpu6050.accel_y} /{" "}
                {data.mpu6050.accel_z}
              </span>
            </div>
            <div className={styles.telemetryGroup}>
              <span className={styles.telemetryLabel}>GYRO X/Y/Z</span>
              <span className={styles.telemetryValue}>
                {data.mpu6050.gyro_x} / {data.mpu6050.gyro_y} /{" "}
                {data.mpu6050.gyro_z}
              </span>
            </div>
            <div className={styles.telemetryGroup}>
              <span className={styles.telemetryLabel}>TEMP MPU6050</span>
              <span className={styles.telemetryValue}>{tempC}</span>
            </div>
          </>
        )}

        {data.qtr8rc && (
          <>
            <div className={styles.telemetryGroup}>
              <span className={styles.telemetryLabel}>LINHA DETECTADA</span>
              <span
                className={styles.telemetryValue}
                style={{
                  color: data.qtr8rc.line_detected
                    ? "var(--success)"
                    : "var(--text-dim)",
                }}
              >
                {data.qtr8rc.line_detected ? "SIM" : "NÃO"}
              </span>
            </div>
            <div className={styles.telemetryGroup}>
              <span className={styles.telemetryLabel}>MÁSCARA PRETO</span>
              <span className={styles.telemetryValue}>
                {Number(data.qtr8rc.black_mask).toString(2).padStart(8, "0")}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ControlPanel() {
  const [espBaseUrl, setEspBaseUrl] = useState(loadEspBaseUrl);
  const {
    status,
    loading,
    eventLog,
    streamLog,
    connected,
    telemetry,
    lastUpdated,
    espBaseUrl: activeUrl,
    fetchBaseUrl,
    acionar,
    recolher,
    parar,
    testConnection,
    fetchTelemetry,
  } = useESP32(espBaseUrl);

  const current = STATUS[status];

  const handleSaveEspUrl = (url) => {
    setEspBaseUrl(saveEspBaseUrl(url));
  };

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.tag}>PI2 • GRUPO 01</span>
          <h1 className={styles.title}>CONTROLE DO ATUADOR</h1>
          <p className={styles.subtitle}>
            SISTEMA DE ELEVAÇÃO DO ATUADOR LINEAR (GANCHO) - CARRINHO AUTÔNOMO
            THOMAS
          </p>
        </div>
        <div className={styles.headerRight}>
          <span className={styles.connLabel}>ESP32</span>
          <StatusDot
            type={connected === null ? "idle" : connected ? "success" : "error"}
          />
          <span className={styles.connStatus}>
            {connected === null
              ? "verificando..."
              : connected
                ? "online"
                : "offline"}
          </span>
          <button
            className={styles.refreshBtn}
            onClick={() => fetchTelemetry()}
            title="Atualizar telemetria"
          >
            ↻
          </button>
        </div>
      </header>

      <EspConfigBar
        key={espBaseUrl}
        baseUrl={espBaseUrl}
        fetchBaseUrl={fetchBaseUrl}
        onSave={handleSaveEspUrl}
        onTest={testConnection}
        testing={loading}
      />

      <div className={styles.apiEndpoints}>
        <span className={styles.monoText}>API</span>
        <code className={styles.endpoint}>{fetchBaseUrl}/api/telemetry</code>
        <code className={styles.endpoint}>{fetchBaseUrl}/api/command</code>
        {fetchBaseUrl !== activeUrl && (
          <span className={styles.ipHint}>→ ESP em {activeUrl}</span>
        )}
      </div>

      <div className={styles.statusBox}>
        <span className={styles.statusLabel}>STATUS DO SISTEMA</span>
        <div className={styles.statusValue} style={{ color: current.color }}>
          <StatusDot type={current.dot} />
          {current.label}
        </div>
      </div>

      <div className={styles.actuatorViz}>
        <div className={styles.rail}>
          <div
            className={`${styles.hook} ${
              status === "RISING"
                ? styles.hookUp
                : status === "LOWERING"
                  ? styles.hookDown
                  : ""
            }`}
          >
            🪝
          </div>
        </div>
        <div className={styles.railLabel}>ATUADOR LINEAR</div>
      </div>

      <div className={styles.controls}>
        <button
          className={`${styles.btn} ${styles.btnAcionar}`}
          onClick={acionar}
          disabled={loading || status === "RISING"}
        >
          <span className={styles.btnIcon}>▲</span>
          ACIONAR
          <span className={styles.btnSub}>elevar gancho</span>
        </button>

        <button
          className={`${styles.btn} ${styles.btnParar}`}
          onClick={parar}
          disabled={loading || status === "IDLE" || status === "STOPPED"}
        >
          <span className={styles.btnIcon}>■</span>
          PARAR
          <span className={styles.btnSub}>parada imediata</span>
        </button>

        <button
          className={`${styles.btn} ${styles.btnRecolher}`}
          onClick={recolher}
          disabled={loading || status === "LOWERING"}
        >
          <span className={styles.btnIcon}>▼</span>
          RECOLHER
          <span className={styles.btnSub}>baixar gancho</span>
        </button>
      </div>

      <TelemetryPanel
        data={telemetry}
        connected={connected}
        lastUpdated={lastUpdated}
      />

      <SystemLogPanel
        telemetry={telemetry}
        connected={connected}
        lastUpdated={lastUpdated}
        eventLog={eventLog}
        streamLog={streamLog}
      />
    </div>
  );
}
