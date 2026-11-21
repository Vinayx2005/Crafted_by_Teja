/* ESP32-P4-WIFI6-DB: ES8311 mic -> 16 kHz mono PCM frames over UART0 (CH343 USB-serial).
 * Frame: A5 5A + 640 bytes (320 x int16 LE, 20 ms). PC -> board: one byte = mic gain in dB (0..42). */
#include "driver/i2c_master.h"
#include "driver/i2s_std.h"
#include "driver/uart.h"
#include "esp_log.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "es8311_codec.h"

#define RATE        16000
#define FRAME       320                 /* samples per 20 ms */
#define BAUD        921600
#define GAIN_DB     24                  /* default; PC can change at runtime */

void app_main(void)
{
    esp_log_level_set("*", ESP_LOG_NONE);   /* UART0 carries binary audio now */

    i2c_master_bus_handle_t i2c;
    i2c_master_bus_config_t bus = { .i2c_port = I2C_NUM_0, .sda_io_num = 7, .scl_io_num = 8,
                                    .clk_source = I2C_CLK_SRC_DEFAULT, .glitch_ignore_cnt = 7,
                                    .flags.enable_internal_pullup = true };
    ESP_ERROR_CHECK(i2c_new_master_bus(&bus, &i2c));

    i2s_chan_handle_t tx, rx;
    i2s_chan_config_t cc = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    ESP_ERROR_CHECK(i2s_new_channel(&cc, &tx, &rx));
    i2s_std_config_t sc = {
        .clk_cfg  = { .sample_rate_hz = RATE, .clk_src = I2S_CLK_SRC_DEFAULT, .mclk_multiple = I2S_MCLK_MULTIPLE_256 },
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = { .mclk = 13, .bclk = 12, .ws = 10, .dout = 9, .din = 11 },
    };
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(tx, &sc));
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(rx, &sc));
    ESP_ERROR_CHECK(i2s_channel_enable(tx));
    ESP_ERROR_CHECK(i2s_channel_enable(rx));

    audio_codec_i2s_cfg_t i2s = { .port = I2S_NUM_0, .tx_handle = tx, .rx_handle = rx };
    audio_codec_i2c_cfg_t i2c_cfg = { .port = I2C_NUM_0, .addr = ES8311_CODEC_DEFAULT_ADDR, .bus_handle = i2c };
    es8311_codec_cfg_t codec = {
        .ctrl_if = audio_codec_new_i2c_ctrl(&i2c_cfg), .gpio_if = audio_codec_new_gpio(),
        .codec_mode = ESP_CODEC_DEV_WORK_MODE_ADC, .pa_pin = -1,
        .use_mclk = true, .digital_mic = false, .no_dac_ref = true,
        .hw_gain = { .pa_voltage = 5.0, .codec_dac_voltage = 3.3 }, .mclk_div = 256,
    };
    esp_codec_dev_cfg_t dc = { .dev_type = ESP_CODEC_DEV_TYPE_IN, .codec_if = es8311_codec_new(&codec),
                               .data_if = audio_codec_new_i2s_data(&i2s) };
    esp_codec_dev_handle_t mic = esp_codec_dev_new(&dc);
    esp_codec_dev_sample_info_t fs = { .sample_rate = RATE, .channel = 1, .bits_per_sample = 16 };
    ESP_ERROR_CHECK(esp_codec_dev_set_in_gain(mic, GAIN_DB) == ESP_CODEC_DEV_OK ? ESP_OK : ESP_FAIL);
    ESP_ERROR_CHECK(esp_codec_dev_open(mic, &fs) == ESP_CODEC_DEV_OK ? ESP_OK : ESP_FAIL);

    uart_driver_install(UART_NUM_0, 4096, 0, 0, NULL, 0);
    uart_set_baudrate(UART_NUM_0, BAUD);

    static uint8_t out[2 + FRAME * 2] = { 0xA5, 0x5A };
    for (;;) {
        esp_codec_dev_read(mic, out + 2, FRAME * 2);
        uart_write_bytes(UART_NUM_0, out, sizeof out);
        uint8_t g;
        while (uart_read_bytes(UART_NUM_0, &g, 1, 0) == 1)
            if (g <= 42) esp_codec_dev_set_in_gain(mic, g);
    }
}
