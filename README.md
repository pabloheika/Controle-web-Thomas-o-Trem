# Interface Web — Controle do Atuador Linear
**Projeto Integrador 2 — Grupo 01 — UnB**

Interface web em React para controle remoto do atuador linear do carrinho autônomo. Comunica-se com a ESP32 via API HTTP REST (ESP-IDF).

---

## Estrutura do projeto

```
software-interface-web/
├── src/
│   ├── components/
│   │   ├── ControlPanel.jsx          ← Painel de controle principal
│   │   └── ControlPanel.module.css   ← Estilos do painel
│   ├── App.jsx                       ← Componente raiz
│   ├── main.jsx                      ← Ponto de entrada do React
│   └── index.css                     ← Estilos globais e efeito CRT
├── index.html
├── package.json
└── vite.config.js
```

---

## Pré-requisitos

- [Node.js](https://nodejs.org) v18 ou superior
- [pnpm](https://pnpm.io) (recomendado) ou npm

### Instalar o pnpm (caso não tenha)
Execute no PowerShell como administrador:
```bash
iwr https://get.pnpm.io/install.ps1 -useb | iex
```

> ⚠️ Em algumas redes (como a da UnB) o `npm` pode falhar por bloqueio de certificado SSL. Nesse caso use o `pnpm`.

---

## Configuração

1. Abra `src/components/ControlPanel.jsx`
2. Altere a constante `ESP32_IP` com o IP exibido no terminal da ESP32 após o boot:
   ```js
   const ESP32_IP = 'http://192.168.1.100' // ← IP da sua ESP32
   ```

> ⚠️ O computador com o React e a ESP32 precisam estar na **mesma rede Wi-Fi**.

---

## Rodar o projeto

```bash
pnpm install
pnpm run dev
```

Acesse `http://localhost:5173` no navegador.

> Caso use npm: `npm install` e `npm run dev`.

---

## API da ESP32

A interface consome a API REST exposta pelo firmware ESP-IDF (`web_api.c`).

### `GET /api/telemetry`
Chamada automaticamente a cada **3 segundos** para atualizar os dados exibidos no painel.

Resposta:
```json
{
  "uptime_ms": 12500,
  "wifi_rssi": -62,
  "atuador": "parado",
  "mpu6050": {
    "accel_x": 120, "accel_y": -30, "accel_z": 16384,
    "gyro_x": 5,    "gyro_y": -2,   "gyro_z": 1,
    "temp": 2530
  },
  "qtr8rc": {
    "black_mask": 24,
    "line_detected": true
  }
}
```

### `POST /api/command`
Enviada ao clicar nos botões do painel. Corpo da requisição:
```json
{ "cmd": "<comando>" }
```

| Comando      | Botão    | Ação                            |
|--------------|----------|---------------------------------|
| `"acionar"`  | ACIONAR  | Sobe o gancho (GPIO 18 → HIGH)  |
| `"recolher"` | RECOLHER | Desce o gancho (GPIO 19 → HIGH) |
| `"parar"`    | PARAR    | Para o atuador (todos → LOW)    |

---

## Diagrama de conexão (hardware)

```
ESP32 GPIO 18 (PINO_SUBIR)  → Driver IN1 → sentido de subida do gancho
ESP32 GPIO 19 (PINO_DESCER) → Driver IN2 → sentido de descida do gancho
ESP32 GND                   → Driver GND (GND comum com a fonte externa)
Fonte externa               → Driver VCC motor → Atuador
```

> ⚠️ Nunca conecte o atuador diretamente aos GPIOs — eles suportam no máximo 40mA. Use um driver de motor (ex: L298N, IBT-2).

> ⚠️ O GND da ESP32 e o GND da fonte externa precisam estar conectados no driver (GND comum).

---

## Funcionalidades da interface

- **Painel de controle** com botões Acionar, Parar e Recolher
- **Indicador de conexão** com a ESP32 em tempo real
- **Painel de telemetria** atualizado a cada 3s com uptime, RSSI Wi-Fi, leituras do MPU6050 e QTR8RC
- **Log de eventos** com histórico das últimas 50 ações e respostas da ESP32
- **Status do gancho** sincronizado com o estado real reportado pela ESP32