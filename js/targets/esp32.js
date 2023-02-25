export class ESP32 {
    CHIP_NAME = "ESP32";
    BOOTLOADER_FLASH_OFFSET = 0x1000

    FLASH_SIZES = {
        "1MB": 0x00,
        "2MB": 0x10,
        "4MB": 0x20,
        "8MB": 0x30,
        "16MB": 0x40,
        "32MB": 0x50,
        "64MB": 0x60,
        "128MB": 0x70,
    }

    FLASH_FREQUENCY = {
        "80m": 0xF,
        "40m": 0x0,
        "26m": 0x1,
        "20m": 0x2,
    }
}