/** Formata uptime em "Xm Ys". */
export function formatUptime(uptimeMs) {
  if (uptimeMs == null) return "—";
  const m = Math.floor(uptimeMs / 60000);
  const s = Math.floor((uptimeMs % 60000) / 1000);
  return `${m}m ${s}s`;
}

/** Formata temperatura MPU6050 (valor bruto / 100). */
export function formatMpuTemp(temp) {
  if (temp == null) return "—";
  return `${(temp / 100).toFixed(1)} °C`;
}

/** Uma linha compacta para o histórico do log. */
export function formatTelemetryLogLine(data) {
  if (!data) return "— sem dados —";

  const parts = [
    `uptime=${formatUptime(data.uptime_ms)}`,
    `rssi=${data.wifi_rssi ?? "?"}dBm`,
    `atuador=${data.atuador ?? "?"}`,
  ];

  if (data.mpu6050) {
    const m = data.mpu6050;
    parts.push(
      `accel=${m.accel_x}/${m.accel_y}/${m.accel_z}`,
      `gyro=${m.gyro_x}/${m.gyro_y}/${m.gyro_z}`,
      `temp=${formatMpuTemp(m.temp)}`,
    );
  }

  if (data.qtr8rc) {
    const q = data.qtr8rc;
    const mask = Number(q.black_mask).toString(2).padStart(8, "0");
    parts.push(`linha=${q.line_detected ? "SIM" : "NÃO"}`, `mask=${mask}`);
  }

  return parts.join(" · ");
}
