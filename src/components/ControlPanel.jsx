import { useState, useEffect, useRef } from "react";
import styles from "./ControlPanel.module.css";

//  Configuração
// IP da ESP32 na rede local. Altere para o IP exibido no terminal após rodar "idf.py flash monitor" ou no Serial Monitor.
const ESP32_IP = "http://192.168.1.100";

// Endpoints da API (ESP-IDF web_api.c)
// A ESP32 usa uma única rota POST /api/command com o campo "cmd" no corpo JSON. Formato: { "cmd": "<comando>", "payload": {} }
const API = {
  TELEMETRY: `${ESP32_IP}/api/telemetry`, // GET → uptime, RSSI, sensores, atuador
  COMMAND: `${ESP32_IP}/api/command`, // POST → { cmd: "acionar" | "recolher" | "parar" | "noop" }
};

// Mapeamento de status da interface
const STATUS = {
  IDLE: { label: "AGUARDANDO", color: "var(--text-dim)", dot: "idle" },
  RISING: { label: "SUBINDO", color: "var(--accent)", dot: "active" },
  LOWERING: { label: "DESCENDO", color: "var(--warning)", dot: "warning" },
  STOPPED: { label: "PARADO", color: "var(--success)", dot: "success" },
  ERROR: { label: "ERRO", color: "var(--danger)", dot: "error" },
};

// Hook: useESP32 ; Gerencia toda a comunicação com a ESP32. Usa GET /api/telemetry para verificar conexão e obter dados dos sensores. Usa POST /api/command com {"cmd": "..."} para enviar comandos ao atuador.
function useESP32() {
  const [status, setStatus] = useState("IDLE");
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState([]);
  const [connected, setConnected] = useState(null);
  const [telemetry, setTelemetry] = useState(null); // dados brutos da ESP32

  const addLog = (msg, type = "info") => {
    const time = new Date().toLocaleTimeString("pt-BR");
    setLog((prev) => [`[${time}] ${msg}`, ...prev].slice(0, 50));
  };

  // Verifica conexão e atualiza telemetria chamando GET /api/telemetry. Retorna uptime_ms, wifi_rssi, estado do atuador, MPU6050 e QTR8RC.
  const fetchTelemetry = async (silent = false) => {
    try {
      const res = await fetch(API.TELEMETRY, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTelemetry(data);
      setConnected(true);

      // Sincroniza estado da interface com o estado real reportado pela ESP32
      if (data.atuador === "subindo") setStatus("RISING");
      if (data.atuador === "descendo") setStatus("LOWERING");
      if (data.atuador === "parado")
        setStatus((prev) => (prev === "IDLE" ? "IDLE" : "STOPPED"));

      if (!silent) addLog("Telemetria recebida", "success");
    } catch (err) {
      setConnected(false);
      setTelemetry(null);
      if (!silent) addLog(`Falha ao obter telemetria: ${err.message}`, "error");
    }
  };

  // Envia um comando para a ESP32 via POST /api/command. Formato do corpo: { "cmd": "<comando>" }
  const sendCommand = async (cmd, nextStatus, logMsg) => {
    if (loading) return;
    setLoading(true);
    setStatus(nextStatus);
    addLog(logMsg);
    try {
      const res = await fetch(API.COMMAND, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
        headers: { "Content-Type": "application/json" },
        // Formato esperado pelo dispatch_command() no web_api.c
        body: JSON.stringify({ cmd }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      addLog(`ESP32 respondeu: ${JSON.stringify(data)}`, "success");
      setConnected(true);
      // Atualiza telemetria após comando para refletir novo estado
      await fetchTelemetry(true);
    } catch (err) {
      setStatus("ERROR");
      setConnected(false);
      addLog(`Falha na comunicação: ${err.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // Funções de controle — cada uma envia o "cmd" correspondente ao web_api.c
  const acionar = () =>
    sendCommand("acionar", "RISING", "Acionando atuador — gancho subindo...");
  const recolher = () =>
    sendCommand(
      "recolher",
      "LOWERING",
      "Recolhendo atuador — gancho descendo...",
    );
  const parar = () =>
    sendCommand("parar", "STOPPED", "Comando de parada enviado");

  // Verifica conexão ao montar o componente
  useEffect(() => {
    fetchTelemetry();
  }, []);

  // Atualiza telemetria automaticamente a cada 3 segundos
  useEffect(() => {
    const interval = setInterval(() => fetchTelemetry(true), 3000);
    return () => clearInterval(interval);
  }, []);

  return {
    status,
    loading,
    log,
    connected,
    telemetry,
    acionar,
    recolher,
    parar,
    fetchTelemetry,
  };
}

// ─── Componente: StatusDot ────────────────────────────────────────────────────
function StatusDot({ type }) {
  return <span className={`${styles.dot} ${styles[`dot_${type}`]}`} />;
}

// ─── Componente: TelemetryPanel ───────────────────────────────────────────────
// Exibe os dados retornados pelo GET /api/telemetry:
// uptime, RSSI Wi-Fi, leituras do MPU6050 e estado do QTR8RC.
function TelemetryPanel({ data }) {
  if (!data) {
    return (
      <div className={styles.telemetry}>
        <span className={styles.monoText}>TELEMETRIA</span>
        <span className={styles.telemetryEmpty}>— sem dados —</span>
      </div>
    );
  }

  // Converte uptime de ms para formato legível (Xm Ys)
  const uptime = data.uptime_ms
    ? `${Math.floor(data.uptime_ms / 60000)}m ${Math.floor((data.uptime_ms % 60000) / 1000)}s`
    : "—";

  return (
    <div className={styles.telemetry}>
      <span className={styles.monoText}>TELEMETRIA</span>
      <div className={styles.telemetryGrid}>
        <div className={styles.telemetryGroup}>
          <span className={styles.telemetryLabel}>UPTIME</span>
          <span className={styles.telemetryValue}>{uptime}</span>
        </div>
        <div className={styles.telemetryGroup}>
          <span className={styles.telemetryLabel}>Wi-Fi RSSI</span>
          <span className={styles.telemetryValue}>{data.wifi_rssi} dBm</span>
        </div>
        <div className={styles.telemetryGroup}>
          <span className={styles.telemetryLabel}>ATUADOR</span>
          <span className={styles.telemetryValue}>{data.atuador ?? "—"}</span>
        </div>

        {/* MPU6050 — acelerômetro e giroscópio */}
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
          </>
        )}

        {/* QTR8RC — sensor de linha */}
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
              {/* Máscara em binário de 8 bits: cada bit representa um sensor do QTR8RC */}
              <span className={styles.telemetryValue}>
                {data.qtr8rc.black_mask.toString(2).padStart(8, "0")}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function ControlPanel() {
  const {
    status,
    loading,
    log,
    connected,
    telemetry,
    acionar,
    recolher,
    parar,
    fetchTelemetry,
  } = useESP32();
  const logRef = useRef(null);
  const current = STATUS[status];

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

      {/* status do ip */}
      <div className={styles.ipBar}>
        <span className={styles.monoText}>TARGET →</span>
        <span className={styles.ipValue}>{ESP32_IP}</span>
        <span className={styles.ipHint}>
          altere ESP32_IP em ControlPanel.jsx
        </span>
      </div>

      {/* status*/}
      <div className={styles.statusBox}>
        <span className={styles.statusLabel}>STATUS DO SISTEMA</span>
        <div className={styles.statusValue} style={{ color: current.color }}>
          <StatusDot type={current.dot} />
          {current.label}
        </div>
      </div>

      {/* animação do atuador */}
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

      {/* botoões */}
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

      {/* telemtria atualizada aa cada 3s via GET /api/telemetry */}
      <TelemetryPanel data={telemetry} />

      {/* box do log*/}
      <div className={styles.logBox} ref={logRef}>
        <div className={styles.logHeader}>
          <span className={styles.monoText}>LOG DO SISTEMA</span>
          <span className={styles.logCount}>{log.length} entradas</span>
        </div>
        <div className={styles.logEntries}>
          {log.length === 0 ? (
            <span className={styles.logEmpty}>— sem registros —</span>
          ) : (
            log.map((entry, i) => (
              <div
                key={i}
                className={`${styles.logEntry} ${
                  entry.includes("Falha") || entry.includes("ERRO")
                    ? styles.logError
                    : entry.includes("sucesso") || entry.includes("respondeu")
                      ? styles.logSuccess
                      : ""
                }`}
              >
                {entry}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
