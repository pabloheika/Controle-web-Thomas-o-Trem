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

/* ============ Compute motors from joystick position ============ */
function computeMotorsFromXY(x, y, radius) {
  if (radius <= 0) return { left: 0, right: 0 };
  // Y-axis = throttle (up = forward), X-axis = steering
  const throttle = -y / radius; // -1 (back) to 1 (forward)
  const steering = x / radius;  // -1 (left) to 1 (right)
  let left = throttle - steering;
  let right = throttle + steering;
  // Normalize to -1..1
  const maxVal = Math.max(Math.abs(left), Math.abs(right), 1);
  left = left / maxVal;
  right = right / maxVal;
  // Scale to -255..255
  return {
    left: Math.round(left * 255),
    right: Math.round(right * 255),
  };
}

/* ============ VIRTUAL JOYSTICK ============ */
function VirtualJoystick({ disabled, onMove, onRelease }) {
  const zoneRef = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const activePointer = useRef(null);

  const clampToCircle = (dx, dy, radius) => {
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= radius) return { x: dx, y: dy };
    return { x: (dx / dist) * radius, y: (dy / dist) * radius };
  };

  const getRelativePos = (clientX, clientY) => {
    const rect = zoneRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width / 2 - 25; // knob radius offset
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    return clampToCircle(dx, dy, radius);
  };

  const getRadius = () => {
    if (!zoneRef.current) return 75;
    const rect = zoneRef.current.getBoundingClientRect();
    return rect.width / 2 - 25;
  };

  const handlePointerDown = (e) => {
    if (disabled) return;
    if (activePointer.current !== null) return;
    activePointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    setActive(true);
    const p = getRelativePos(e.clientX, e.clientY);
    setPos(p);
    const radius = getRadius();
    const motors = computeMotorsFromXY(p.x, p.y, radius);
    onMove(motors.left, motors.right);
  };

  const handlePointerMove = (e) => {
    if (activePointer.current !== e.pointerId) return;
    const p = getRelativePos(e.clientX, e.clientY);
    setPos(p);
    const radius = getRadius();
    const motors = computeMotorsFromXY(p.x, p.y, radius);
    onMove(motors.left, motors.right);
  };

  const handlePointerUp = (e) => {
    if (activePointer.current !== e.pointerId) return;
    activePointer.current = null;
    setActive(false);
    setPos({ x: 0, y: 0 });
    onRelease();
  };

  const radius = getRadius();
  const displayMotors = computeMotorsFromXY(pos.x, pos.y, radius);

  return (
    <div className={styles.joystickContainer}>
      <div className={styles.joystickLabels}>
        <span>← Esq</span>
        <span>Frente ↑</span>
        <span>Dir →</span>
      </div>
      <div
        ref={zoneRef}
        className={`${styles.joystickZone} ${disabled ? styles.joystickDisabled : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className={`${styles.joystickKnob} ${active ? styles.joystickKnobActive : ''}`}
          style={{
            left: `calc(50% + ${pos.x}px)`,
            top: `calc(50% + ${pos.y}px)`,
          }}
        />
      </div>
      <div className={styles.joystickValues}>
        <div className={styles.joystickVal}>
          <span className={styles.joystickValLabel}>Esq</span>
          <span className={styles.joystickValNum}>
            {disabled ? '—' : displayMotors.left}
          </span>
        </div>
        <div className={styles.joystickVal}>
          <span className={styles.joystickValLabel}>Dir</span>
          <span className={styles.joystickValNum}>
            {disabled ? '—' : displayMotors.right}
          </span>
        </div>
      </div>
    </div>
  );
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
  const [kp, setKp] = useState(0.5);
  const [ki, setKi] = useState(0.0);
  const [kd, setKd] = useState(1.0);
  const [baseSpeed, setBaseSpeed] = useState(255);
  const [baseSpeedDraft, setBaseSpeedDraft] = useState(255);

  // Manual motor states
  const [leftMotor, setLeftMotor] = useState(0);
  const [rightMotor, setRightMotor] = useState(0);
  const [syncMotor, setSyncMotor] = useState(0);

  // Control type: 'sliders' | 'joystick' | 'sync-slider'
  const [controlType, setControlType] = useState('sliders');

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

  // Speed slider - apply only on release
  const handleSpeedSliderChange = (e) => {
    setBaseSpeedDraft(parseInt(e.target.value, 10));
  };

  const handleSpeedSliderRelease = () => {
    setBaseSpeed(baseSpeedDraft);
  };

  // Debounced manual move
  const lastMoveRef = useRef(0);
  const sendManualMove = useCallback((l, r) => {
    const now = Date.now();
    if (now - lastMoveRef.current > 80) {
      sendCommand("manual_move", { left: l, right: r });
      lastMoveRef.current = now;
    }
  }, [sendCommand]);

  // ======= Pointer-based slider handlers for simultaneous touch =======
  const handleLeftPointerDown = (e) => {
    if (mode !== "manual") return;
    e.target.setPointerCapture(e.pointerId);
  };
  const handleLeftChange = (e) => {
    const val = parseInt(e.target.value, 10);
    setLeftMotor(val);
    sendManualMove(val, rightMotor);
  };

  const handleRightPointerDown = (e) => {
    if (mode !== "manual") return;
    e.target.setPointerCapture(e.pointerId);
  };
  const handleRightChange = (e) => {
    const val = parseInt(e.target.value, 10);
    setRightMotor(val);
    sendManualMove(leftMotor, val);
  };

  const handleSyncPointerDown = (e) => {
    if (mode !== "manual") return;
    e.target.setPointerCapture(e.pointerId);
  };
  const handleSyncChange = (e) => {
    const val = parseInt(e.target.value, 10);
    setSyncMotor(val);
    setLeftMotor(val);
    setRightMotor(val);
    sendManualMove(val, val);
  };

  const handleStopManual = () => {
    setLeftMotor(0);
    setRightMotor(0);
    setSyncMotor(0);
    sendCommand("manual_move", { left: 0, right: 0 });
  };

  // Joystick handlers
  const handleJoystickMove = useCallback((left, right) => {
    setLeftMotor(left);
    setRightMotor(right);
    sendManualMove(left, right);
  }, [sendManualMove]);

  const handleJoystickRelease = useCallback(() => {
    setLeftMotor(0);
    setRightMotor(0);
    setSyncMotor(0);
    sendCommand("manual_move", { left: 0, right: 0 });
  }, [sendCommand]);

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
          <span className={`${styles.dot} ${connected ? styles.dotSuccess : connected === null ? styles.dotIdle : styles.dotError}`}></span>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-dim)', flexWrap: 'wrap', gap: '8px' }}>
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

            {/* Control type tabs */}
            <div className={styles.controlTypeTabs}>
              <button
                className={`${styles.controlTypeTab} ${controlType === 'sliders' ? styles.controlTypeTabActive : ''}`}
                onClick={() => setControlType('sliders')}
                disabled={mode !== "manual"}
              >
                <span className={styles.controlTypeTabIcon}>☰</span>
                Sliders
              </button>
              <button
                className={`${styles.controlTypeTab} ${controlType === 'joystick' ? styles.controlTypeTabActive : ''}`}
                onClick={() => setControlType('joystick')}
                disabled={mode !== "manual"}
              >
                <span className={styles.controlTypeTabIcon}>◎</span>
                Joystick
              </button>
              <button
                className={`${styles.controlTypeTab} ${controlType === 'sync-slider' ? styles.controlTypeTabActive : ''}`}
                onClick={() => setControlType('sync-slider')}
                disabled={mode !== "manual"}
              >
                <span className={styles.controlTypeTabIcon}>⇕</span>
                Sincronizado
              </button>
            </div>
            
            {controlType === 'sliders' && (
              <div className={styles.sliderGroup}>
                <div className={styles.sliderRow}>
                  <span className={styles.sliderLabel}>ESQ</span>
                  <input 
                    type="range" min="-255" max="255" 
                    value={leftMotor}
                    onChange={handleLeftChange}
                    onPointerDown={handleLeftPointerDown}
                    className={styles.slider}
                    disabled={mode !== "manual"}
                    style={{ touchAction: 'none' }}
                  />
                  <span className={styles.sliderVal}>{leftMotor}</span>
                </div>
                <div className={styles.sliderRow}>
                  <span className={styles.sliderLabel}>DIR</span>
                  <input 
                    type="range" min="-255" max="255" 
                    value={rightMotor}
                    onChange={handleRightChange}
                    onPointerDown={handleRightPointerDown}
                    className={styles.slider}
                    disabled={mode !== "manual"}
                    style={{ touchAction: 'none' }}
                  />
                  <span className={styles.sliderVal}>{rightMotor}</span>
                </div>
                <button 
                  className={styles.stopBtn} 
                  onClick={handleStopManual}
                  disabled={mode !== "manual"}
                >
                  ■ Parar Motores
                </button>
              </div>
            )}
            
            {controlType === 'sync-slider' && (
              <div className={styles.sliderGroup}>
                <div className={styles.sliderRow}>
                  <span className={styles.sliderLabel}>AMBOS</span>
                  <input 
                    type="range" min="-255" max="255" 
                    value={syncMotor}
                    onChange={handleSyncChange}
                    onPointerDown={handleSyncPointerDown}
                    className={styles.slider}
                    disabled={mode !== "manual"}
                    style={{ touchAction: 'none' }}
                  />
                  <span className={styles.sliderVal}>{syncMotor}</span>
                </div>
                <button 
                  className={styles.stopBtn} 
                  onClick={handleStopManual}
                  disabled={mode !== "manual"}
                >
                  ■ Parar Motores
                </button>
              </div>
            )}

            {controlType === 'joystick' && (
              <>
                <VirtualJoystick
                  disabled={mode !== "manual"}
                  onMove={handleJoystickMove}
                  onRelease={handleJoystickRelease}
                />
                <button 
                  className={styles.stopBtn} 
                  onClick={handleStopManual}
                  disabled={mode !== "manual"}
                >
                  ■ Parar Motores
                </button>
              </>
            )}
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

              {/* Speed Slider */}
              <div className={styles.speedSliderContainer} style={{ marginTop: '16px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Velocidade Base</label>
                <div className={styles.speedSliderRow}>
                  <input
                    type="range"
                    min="0"
                    max="255"
                    value={baseSpeedDraft}
                    onChange={handleSpeedSliderChange}
                    onMouseUp={handleSpeedSliderRelease}
                    onTouchEnd={handleSpeedSliderRelease}
                    className={styles.speedSlider}
                  />
                  <span className={styles.speedValue}>{baseSpeedDraft}</span>
                </div>
              </div>

              <button type="submit" className={styles.btnPrimary} style={{ padding: '10px 16px', marginTop: '16px', width: '100%' }}>
                Aplicar Ganhos
              </button>
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
