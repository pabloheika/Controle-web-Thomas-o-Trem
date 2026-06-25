import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import styles from "./ControlPanel.module.css";
import {
  loadEspBaseUrl,
  saveEspBaseUrl,
  DEFAULT_ESP_BASE_URL,
} from "../config/esp32Config.js";
import {
  buildEspApi,
  fetchTelemetry,
  fetchLogs,
  sendCommand as postCommand,
  TELEMETRY_POLL_MS,
} from "../services/esp32Api.js";

function useESP32(espBaseUrl) {
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(null);
  const [telemetry, setTelemetry] = useState(null);
  const [logs, setLogs] = useState([]);
  
  const api = useMemo(() => buildEspApi(espBaseUrl), [espBaseUrl]);

  const fetchSysLogs = useCallback(async () => {
    try {
      const data = await fetchLogs(api);
      if (data && data.logs) {
        setLogs(data.logs);
      }
    } catch (err) {
      // Ignora erro sutil para não floodar a UI se falhar apenas o log
    }
  }, [api]);

  const fetchTelemetryData = useCallback(async () => {
    try {
      const data = await fetchTelemetry(api);
      setTelemetry(data);
      setConnected(true);
    } catch (err) {
      setConnected(false);
    }
  }, [api]);

  const sendCommand = useCallback(async (cmd, payload = null) => {
    if (loading) return;
    setLoading(true);
    try {
      await postCommand(api, cmd, payload);
      setConnected(true);
      await fetchTelemetryData();
    } catch (err) {
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [api, loading, fetchTelemetryData]);

  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(() => {
      if (!cancelled) {
        fetchTelemetryData();
        fetchSysLogs();
      }
    }, TELEMETRY_POLL_MS);
    
    fetchTelemetryData();
    fetchSysLogs();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchTelemetryData, fetchSysLogs]);

  return {
    loading,
    connected,
    telemetry,
    logs,
    espBaseUrl: api.storedBaseUrl,
    sendCommand,
  };
}

export default function ControlPanel() {
  const [espBaseUrl, setEspBaseUrl] = useState(loadEspBaseUrl);
  const {
    loading,
    connected,
    telemetry,
    logs,
    sendCommand,
  } = useESP32(espBaseUrl);

  // Form states
  const [kp, setKp] = useState(0.2);
  const [ki, setKi] = useState(0.0);
  const [kd, setKd] = useState(1.0);
  const [baseSpeed, setBaseSpeed] = useState(150);

  // Manual motor states
  const [leftMotor, setLeftMotor] = useState(0);
  const [rightMotor, setRightMotor] = useState(0);

  const mode = telemetry?.mode || "idle";

  const handleSaveEspUrl = (e) => {
    e.preventDefault();
    const url = new FormData(e.target).get("url");
    setEspBaseUrl(saveEspBaseUrl(url));
  };

  const handleSetMode = (newMode) => {
    sendCommand("set_mode", { mode: newMode });
  };

  const handlePidSubmit = (e) => {
    e.preventDefault();
    sendCommand("set_pid", { kp: parseFloat(kp), ki: parseFloat(ki), kd: parseFloat(kd) });
    sendCommand("set_speed", { speed: parseInt(baseSpeed, 10) });
  };

  // Debounced manual move
  const lastMoveRef = useRef(0);
  const sendManualMove = (l, r) => {
    const now = Date.now();
    if (now - lastMoveRef.current > 100) {
      sendCommand("manual_move", { left: l, right: r });
      lastMoveRef.current = now;
    }
  };

  const handleLeftMotor = (e) => {
    const val = parseInt(e.target.value, 10);
    setLeftMotor(val);
    sendManualMove(val, rightMotor);
  };

  const handleRightMotor = (e) => {
    const val = parseInt(e.target.value, 10);
    setRightMotor(val);
    sendManualMove(leftMotor, val);
  };
  
  const handleStopManual = () => {
    setLeftMotor(0);
    setRightMotor(0);
    sendCommand("manual_move", { left: 0, right: 0 });
  };

  // Auto-scroll logs
  const terminalRef = useRef(null);
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className={styles.wrapper}>
      {/* HEADER */}
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>THOMAS, O TREM</h1>
          <p className={styles.subtitle}>Dashboard de Controle Autônomo</p>
        </div>
        
        <div className={styles.connBox}>
          <span className={connected ? styles.dotSuccess : styles.dotError} className={styles.dot}></span>
          <span style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>
            {connected === null ? "Conectando..." : connected ? "Online" : "Offline"}
          </span>
          <form className={styles.ipForm} onSubmit={handleSaveEspUrl}>
            <input 
              name="url"
              className={styles.ipInput} 
              defaultValue={espBaseUrl}
              placeholder={DEFAULT_ESP_BASE_URL}
            />
            <button className={styles.btnSm} type="submit">Conectar</button>
          </form>
        </div>
      </header>

      <div className={styles.dashboardGrid}>
        
        {/* COLUNA ESQUERDA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* MODES PANEL */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>Modo de Operação</div>
            <div className={styles.modeGrid}>
              <button 
                className={`${styles.modeBtn} ${mode === "idle" ? styles.modeBtnActive : ""}`}
                onClick={() => handleSetMode("idle")}
              >
                IDLE
                <span style={{fontSize: '0.7rem', fontWeight: 'normal'}}>Parado</span>
              </button>
              <button 
                className={`${styles.modeBtn} ${mode === "auto" ? styles.modeBtnActive : ""}`}
                onClick={() => handleSetMode("auto")}
              >
                AUTO
                <span style={{fontSize: '0.7rem', fontWeight: 'normal'}}>Seguir Linha</span>
              </button>
              <button 
                className={`${styles.modeBtn} ${mode === "manual" ? styles.modeBtnActive : ""}`}
                onClick={() => handleSetMode("manual")}
              >
                MANUAL
                <span style={{fontSize: '0.7rem', fontWeight: 'normal'}}>Controle Remoto</span>
              </button>
              <button 
                className={`${styles.modeBtn} ${mode === "calibrate" ? styles.modeBtnActive : ""}`}
                onClick={() => handleSetMode("calibrate")}
              >
                CALIBRAR
                <span style={{fontSize: '0.7rem', fontWeight: 'normal'}}>Não Necessário</span>
              </button>
            </div>
          </div>

          {/* TELEMETRIA IR */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>Sensores IR (E18-D80NK)</div>
            <div className={styles.lineContainer}>
              <div className={styles.sensorGrid}>
                {['ESQ', 'CENTRO', 'DIR'].map((label, i) => {
                  const keys = ['left', 'center', 'right'];
                  const isBlack = telemetry?.ir_sensors?.[keys[i]] || false;
                  return (
                    <div key={i} className={styles.sensorItem}>
                      <div className={`${styles.sensorDot} ${isBlack ? styles.black : ""}`}></div>
                      <span className={styles.sensorLabel2}>{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {telemetry?.ir_sensors && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                <span>Linha: {telemetry.ir_sensors.line_detected ? "SIM" : "NÃO"}</span>
                <span>Erro PID: {telemetry.pid?.error?.toFixed(1) || "0.0"}</span>
                <span>Correção: {telemetry.pid?.correction?.toFixed(1) || "0.0"}</span>
              </div>
            )}
          </div>

          {/* CONTROLE MANUAL */}
          <div className={styles.card} style={{ opacity: mode === "manual" ? 1 : 0.5 }}>
            <div className={styles.cardTitle}>
              Controle Manual dos Motores
              {mode !== "manual" && <span style={{fontSize: '0.7rem'}}>(Requer modo MANUAL)</span>}
            </div>
            
            <div className={styles.sliderGroup}>
              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>ESQ</span>
                <input 
                  type="range" min="-255" max="255" 
                  value={leftMotor} onChange={handleLeftMotor}
                  className={styles.slider}
                  disabled={mode !== "manual"}
                />
                <span className={styles.sliderVal}>{leftMotor}</span>
              </div>
              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>DIR</span>
                <input 
                  type="range" min="-255" max="255" 
                  value={rightMotor} onChange={handleRightMotor}
                  className={styles.slider}
                  disabled={mode !== "manual"}
                />
                <span className={styles.sliderVal}>{rightMotor}</span>
              </div>
              <button 
                className={styles.btnSm} 
                style={{ marginTop: '8px' }} 
                onClick={handleStopManual}
                disabled={mode !== "manual"}
              >
                Parar Rotação
              </button>
            </div>
          </div>
          
        </div>

        {/* COLUNA DIREITA */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* PID TUNING */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>Ajuste de PID e Velocidade Base</div>
            <form onSubmit={handlePidSubmit}>
              <div className={styles.formRow}>
                <div className={styles.inputGroup}>
                  <label>Kp</label>
                  <input type="number" step="0.01" value={kp} onChange={e => setKp(e.target.value)} />
                </div>
                <div className={styles.inputGroup}>
                  <label>Ki</label>
                  <input type="number" step="0.01" value={ki} onChange={e => setKi(e.target.value)} />
                </div>
                <div className={styles.inputGroup}>
                  <label>Kd</label>
                  <input type="number" step="0.01" value={kd} onChange={e => setKd(e.target.value)} />
                </div>
              </div>
              <div className={styles.formRow} style={{ marginTop: '12px' }}>
                <div className={styles.inputGroup}>
                  <label>Velocidade Base (0-255)</label>
                  <input type="number" step="1" min="0" max="255" value={baseSpeed} onChange={e => setBaseSpeed(e.target.value)} />
                </div>
                <button type="submit" className={styles.btnPrimary} style={{ padding: '8px 16px', flex: '0 0 auto' }}>
                  Aplicar Ganhos
                </button>
              </div>
            </form>
          </div>

          {/* ACTUATOR */}
          <div className={styles.card}>
            <div className={styles.cardTitle}>
              Atuador Linear (Gancho)
              <span style={{ color: 'var(--accent)'}}>{telemetry?.atuador || "parado"}</span>
            </div>
            <div className={styles.actuatorRow}>
              <button className={styles.btnPrimary} onClick={() => sendCommand("acionar")}>▲ Subir</button>
              <button className={styles.btnPrimary} onClick={() => sendCommand("recolher")}>▼ Baixar</button>
              <button className={styles.btnDanger} onClick={() => sendCommand("parar")}>■ Parar</button>
            </div>
          </div>

          {/* TERMINAL LOGS */}
          <div className={styles.card} style={{ flex: 1 }}>
            <div className={styles.cardTitle}>Logs do Sistema (Ao Vivo)</div>
            <div className={styles.terminal} ref={terminalRef}>
              {logs.length === 0 ? (
                <span style={{color: 'var(--text-muted)'}}>Nenhum log recebido...</span>
              ) : (
                logs.map((l, idx) => (
                  <div key={`${l.ts}-${idx}`} className={styles.logLine}>
                    <span className={styles.logTime}>{l.ts}</span>
                    <span className={styles.logTag}>[{l.tag}]</span>
                    <span className={styles[`log${l.level}`]}>{l.msg}</span>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
