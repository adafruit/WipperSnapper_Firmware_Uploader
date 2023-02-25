export class ESP8266 {
    CHIP_NAME = "ESP8266";
    BOOTLOADER_FLASH_OFFSET = 0;

    FLASH_SIZES = {
        "512KB": 0x00,
        "256KB": 0x10,
        "1MB": 0x20,
        "2MB": 0x30,
        "4MB": 0x40,
        "2MB-c1": 0x50,
        "4MB-c1": 0x60,
        "8MB": 0x80,
        "16MB": 0x90,
    };

    FLASH_FREQUENCY = {
        "80m": 0xF,
        "40m": 0x0,
        "26m": 0x1,
        "20m": 0x2,
    };
}
