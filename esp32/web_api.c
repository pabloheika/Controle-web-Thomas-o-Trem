/*
 * web_api.c — Servidor HTTP REST da ESP32
 * Projeto Integrador 2 — Grupo 01 — UnB
 *
 * Rotas disponíveis:
 *   GET  /api/telemetry  → Retorna uptime, RSSI Wi-Fi, leituras MPU6050, QTR8RC e estado do atuador
 *   POST /api/command    → Recebe {"cmd": "<comando>", "payload": {...}} e executa a ação
 *   OPTIONS /*           → Preflight CORS (exigido pelo browser antes de POST)
 *
 * Comandos disponíveis em POST /api/command:
 *   "noop"     → Sem operação (útil para testar conexão)
 *   "acionar"  → Sobe o gancho (PINO_SUBIR → HIGH, PINO_DESCER → LOW)
 *   "recolher" → Desce o gancho (PINO_DESCER → HIGH, PINO_SUBIR → LOW)
 *   "parar"    → Para o atuador (todos os pinos → LOW)
 */

#include "web_api.h"

#include <string.h>

#include "cJSON.h"
#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "mpu6050.h"
#include "qtr8rc.h"

static const char *TAG = "web_api";

/* Configuração dos pinos do atuador 
 * GPIOs conectados ao driver de motor (ex: L298N, IBT-2).
 * ATENÇÃO: nunca conecte o atuador diretamente — os GPIOs da ESP32fornecem no máximo 40mA, insuficiente para acionar o atuador linear.
 * Ajuste os valores conforme a sua ligação física:
 *   ESP32 PINO_SUBIR  → Driver IN1 → sentido de subida do gancho
 *   ESP32 PINO_DESCER → Driver IN2 → sentido de descida do gancho
 */
#define PINO_SUBIR  GPIO_NUM_18
#define PINO_DESCER GPIO_NUM_19

/* Estado interno do atuador
 * Armazenado como string para ser incluído diretamente na telemetria JSON.
 * Valores possíveis: "parado", "subindo", "descendo"
 */
static const char *s_estado_atuador = "parado";

/* Tamanho máximo do corpo JSON recebido no POST /api/command */
#define MAX_JSON_BODY 512

/*  Helper: cabeçalhos CORS 
 * CORS (Cross-Origin Resource Sharing) é uma política de segurança dos browsrers.
 * Sem esses cabeçalhos, o browser bloqueia requisições do React para a ESP32 por serem de origens diferentes (ex: localhost vs IP da ESP32).
 */
static void add_cors_headers(httpd_req_t *req)
{
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin",  "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type");
}

/*  Handler OPTIONS (preflight CORS)
 * O browser envia uma requisição OPTIONS antes de qualquer POST para verificarse o servidor aceita a origem. 
   Respondemos com 204 (sem conteúdo) e oscabeçalhos CORS para liberar a requisição principal.
 */
static esp_err_t cors_options_handler(httpd_req_t *req)
{
    add_cors_headers(req);
    httpd_resp_set_status(req, "204 No Content");
    return httpd_resp_send(req, NULL, 0);
}

/* Helper: inicializa os GPIOs do atuador
 * Configura PINO_SUBIR e PINO_DESCER como saída e garante estado inicial LOW (atuador parado). Chamado uma vez em web_api_start().
 */
static esp_err_t atuador_gpio_init(void)
{
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << PINO_SUBIR) | (1ULL << PINO_DESCER),
        .mode         = GPIO_MODE_OUTPUT,
        .pull_up_en   = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&io_conf), TAG, "gpio_config atuador");

    /* Estado inicial: atuador parado */
    gpio_set_level(PINO_SUBIR,  0);
    gpio_set_level(PINO_DESCER, 0);

    ESP_LOGI(TAG, "GPIOs do atuador inicializados (SUBIR=%d, DESCER=%d)", PINO_SUBIR, PINO_DESCER);
    return ESP_OK;
}

/* dispatch_command: executa o comando recebido via POST /api/command 
 * Recebe o nome do comando (cmd) e um payload JSON opcional.
 * Preenche *out_body com o objeto JSON de resposta.
 * Comandos implementados:
 *   "noop"     → Responde ok sem alterar hardware (teste de conectividade)
 *   "acionar"  → Aciona atuador no sentido de subida
 *   "recolher" → Aciona atuador no sentido de descida
 *   "parar"    → Para o atuador (corta alimentação do motor)
 * Retorna:
 *   ESP_OK           → Comando executado com sucesso
 *   ESP_ERR_NOT_FOUND → Comando desconhecido
 *   ESP_ERR_NO_MEM   → Falha ao alocar JSON de resposta
 */
static esp_err_t dispatch_command(const char *cmd, const cJSON *payload, cJSON **out_body)
{
    (void)payload; /* payload reservado para uso futuro (ex: velocidade, ângulo) */

    if (cmd == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    /* noop */
    if (strcmp(cmd, "noop") == 0) {
        *out_body = cJSON_CreateObject();
        if (*out_body == NULL) return ESP_ERR_NO_MEM;
        cJSON_AddStringToObject(*out_body, "status", "ok");
        cJSON_AddStringToObject(*out_body, "cmd",    "noop");
        return ESP_OK;
    }

    /*  acionar o gancho */
    if (strcmp(cmd, "acionar") == 0) {
        gpio_set_level(PINO_DESCER, 0); /* desliga sentido oposto primeiro */
        gpio_set_level(PINO_SUBIR,  1); /* liga sentido de subida */
        s_estado_atuador = "subindo";
        ESP_LOGI(TAG, "[ACIONAR] PINO_SUBIR → HIGH");

        *out_body = cJSON_CreateObject();
        if (*out_body == NULL) return ESP_ERR_NO_MEM;
        cJSON_AddStringToObject(*out_body, "status",   "acionado");
        cJSON_AddStringToObject(*out_body, "mensagem", "Gancho subindo");
        return ESP_OK;
    }

    /* recolher gancho */
    if (strcmp(cmd, "recolher") == 0) {
        gpio_set_level(PINO_SUBIR,  0); /* desliga sentido oposto primeiro */
        gpio_set_level(PINO_DESCER, 1); /* liga sentido de descida */
        s_estado_atuador = "descendo";
        ESP_LOGI(TAG, "[RECOLHER] PINO_DESCER → HIGH");

        *out_body = cJSON_CreateObject();
        if (*out_body == NULL) return ESP_ERR_NO_MEM;
        cJSON_AddStringToObject(*out_body, "status",   "recolhendo");
        cJSON_AddStringToObject(*out_body, "mensagem", "Gancho descendo");
        return ESP_OK;
    }

    /* parar atuador imediatamente */
    if (strcmp(cmd, "parar") == 0) {
        gpio_set_level(PINO_SUBIR,  0);
        gpio_set_level(PINO_DESCER, 0);
        s_estado_atuador = "parado";
        ESP_LOGI(TAG, "[PARAR] Todos os GPIOs → LOW");

        *out_body = cJSON_CreateObject();
        if (*out_body == NULL) return ESP_ERR_NO_MEM;
        cJSON_AddStringToObject(*out_body, "status",   "parado");
        cJSON_AddStringToObject(*out_body, "mensagem", "Atuador parado");
        return ESP_OK;
    }

    /* Comando não reconhecido */
    return ESP_ERR_NOT_FOUND;
}

/* Handler GET /api/telemetry
 * Retorna um JSON com os dados de telemetria do carrinho:
 *   - uptime_ms      → tempo ligado em milissegundos
 *   - wifi_rssi      → intensidade do sinal Wi-Fi (dBm)
 *   - atuador        → estado atual ("parado", "subindo", "descendo")
 *   - mpu6050        → leituras brutas do acelerômetro e giroscópio
 *   - qtr8rc         → leituras do sensor de linha (black_mask, line_detected)
 *
 * Exemplo de resposta:
 * {
 *   "uptime_ms": 12500,
 *   "wifi_rssi": -62,
 *   "atuador": "parado",
 *   "mpu6050": { "accel_x": 120, "accel_y": -30, "accel_z": 16384,
 *                "gyro_x": 5, "gyro_y": -2, "gyro_z": 1, "temp": 2530 },
 *   "qtr8rc": { "black_mask": 24, "line_detected": true }
 * }
 */
static esp_err_t telemetry_get_handler(httpd_req_t *req)
{
    add_cors_headers(req);
    httpd_resp_set_type(req, "application/json");

    /* Leitura do RSSI Wi-Fi */
    int8_t rssi = 0;
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) {
        rssi = ap.rssi;
    }

    /* Uptime em milissegundos desde o boot */
    const int64_t uptime_ms = esp_timer_get_time() / 1000;

    /* Leitura do MPU6050 (acelerômetro + giroscópio) */
    mpu6050_sample_t imu = {0};
    mpu6050_get_last_sample(&imu);

    /* Leitura do QTR8RC (sensor de linha) */
    qtr8rc_reading_t line = {0};
    qtr8rc_get_last_reading(&line);

    /* Monta JSON de resposta */
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "{\"error\":\"oom\"}");
    }

    cJSON_AddNumberToObject(root, "uptime_ms", (double)uptime_ms);
    cJSON_AddNumberToObject(root, "wifi_rssi", rssi);
    cJSON_AddStringToObject(root, "atuador",   s_estado_atuador);

    /* Sub-objeto MPU6050 */
    cJSON *mpu = cJSON_CreateObject();
    if (mpu != NULL) {
        cJSON_AddNumberToObject(mpu, "accel_x", imu.accel_x);
        cJSON_AddNumberToObject(mpu, "accel_y", imu.accel_y);
        cJSON_AddNumberToObject(mpu, "accel_z", imu.accel_z);
        cJSON_AddNumberToObject(mpu, "gyro_x",  imu.gyro_x);
        cJSON_AddNumberToObject(mpu, "gyro_y",  imu.gyro_y);
        cJSON_AddNumberToObject(mpu, "gyro_z",  imu.gyro_z);
        cJSON_AddNumberToObject(mpu, "temp",    imu.temp);
        cJSON_AddItemToObject(root, "mpu6050", mpu);
    }

    /* Sub-objeto QTR8RC */
    cJSON *qtr = cJSON_CreateObject();
    if (qtr != NULL) {
        cJSON_AddNumberToObject(qtr, "black_mask",    line.black_mask);
        cJSON_AddBoolToObject(qtr,   "line_detected", line.line_detected);
        cJSON_AddItemToObject(root, "qtr8rc", qtr);
    }

    char *json_str = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (json_str == NULL) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "{\"error\":\"oom\"}");
    }

    esp_err_t send_err = httpd_resp_send(req, json_str, HTTPD_RESP_USE_STRLEN);
    cJSON_free(json_str);
    return send_err;
}

/* handler POST /api/command
 * Recebe um JSON no corpo da requisição com o formato: {"cmd": "<comando>", "payload": {...}}
 * O campo "payload" é opcional. O campo "cmd" é obrigatório. Repassa para dispatch_command() e retorna o JSON de resposta.
 */
static esp_err_t command_post_handler(httpd_req_t *req)
{
    add_cors_headers(req);
    httpd_resp_set_type(req, "application/json");

    /* Valida tamanho do corpo antes de ler */
    const int total_len = req->content_len;
    if (total_len <= 0 || total_len >= MAX_JSON_BODY) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "{\"error\":\"invalid_content_length\"}");
    }

    /* Lê o corpo completo da requisição */
    char buf[MAX_JSON_BODY];
    memset(buf, 0, sizeof(buf));
    int received = 0;
    while (received < total_len) {
        const int ret = httpd_req_recv(req, buf + received, total_len - received);
        if (ret <= 0) {
            httpd_resp_set_status(req, "400 Bad Request");
            return httpd_resp_sendstr(req, "{\"error\":\"recv_failed\"}");
        }
        received += ret;
    }
    buf[total_len] = '\0';

    /* Faz parse do JSON recebido */
    cJSON *root = cJSON_Parse(buf);
    if (root == NULL) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "{\"error\":\"invalid_json\"}");
    }

    /* Extrai o campo obrigatório "cmd" */
    const cJSON *cmd_item = cJSON_GetObjectItemCaseSensitive(root, "cmd");
    if (!cJSON_IsString(cmd_item) || cmd_item->valuestring == NULL) {
        cJSON_Delete(root);
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "{\"error\":\"missing_cmd\"}");
    }

    /* Extrai o campo opcional "payload" */
    const cJSON *payload = cJSON_GetObjectItemCaseSensitive(root, "payload");

    /* Executa o comando */
    cJSON *out = NULL;
    esp_err_t err = dispatch_command(cmd_item->valuestring, payload, &out);
    cJSON_Delete(root);

    if (err == ESP_ERR_NOT_FOUND) {
        httpd_resp_set_status(req, "404 Not Found");
        return httpd_resp_sendstr(req, "{\"error\":\"unknown_cmd\"}");
    }
    if (err != ESP_OK || out == NULL) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "{\"error\":\"command_failed\"}");
    }

    char *resp_str = cJSON_PrintUnformatted(out);
    cJSON_Delete(out);
    if (resp_str == NULL) {
        httpd_resp_set_status(req, "500 Internal Server Error");
        return httpd_resp_sendstr(req, "{\"error\":\"oom\"}");
    }

    esp_err_t send_err = httpd_resp_send(req, resp_str, HTTPD_RESP_USE_STRLEN);
    cJSON_free(resp_str);
    return send_err;
}

/* web_api_start 
 * Inicializa os GPIOs do atuador, configura e inicia o servidor HTTP, e registra todos os handlers de rota.
 * Deve ser chamado após wifi_station_wait_connected().
 */
esp_err_t web_api_start(void)
{
    /* Inicializa pinos do atuador antes de subir o servidor */
    ESP_RETURN_ON_ERROR(atuador_gpio_init(), TAG, "atuador_gpio_init");

    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.stack_size       = 8192;
    config.lru_purge_enable = true;
    config.server_port      = 80;

    httpd_handle_t server = NULL;
    ESP_RETURN_ON_ERROR(httpd_start(&server, &config), TAG, "httpd_start");

    /* Registra as rotas: cada rota precisaa de um handler para OPTIONS (CORS preflight) */
    httpd_uri_t routes[] = {
        { .uri = "/api/telemetry", .method = HTTP_GET,     .handler = telemetry_get_handler },
        { .uri = "/api/telemetry", .method = HTTP_OPTIONS, .handler = cors_options_handler  },
        { .uri = "/api/command",   .method = HTTP_POST,    .handler = command_post_handler  },
        { .uri = "/api/command",   .method = HTTP_OPTIONS, .handler = cors_options_handler  },
    };

    for (size_t i = 0; i < sizeof(routes) / sizeof(routes[0]); i++) {
        ESP_RETURN_ON_ERROR(httpd_register_uri_handler(server, &routes[i]), TAG, "reg route %d", (int)i);
    }

    ESP_LOGI(TAG, "HTTP API disponível em http://<ip>:80");
    ESP_LOGI(TAG, "  GET  /api/telemetry  → uptime, RSSI, MPU6050, QTR8RC, atuador");
    ESP_LOGI(TAG, "  POST /api/command    → {\"cmd\": \"acionar|recolher|parar|noop\"}");
    return ESP_OK;
}