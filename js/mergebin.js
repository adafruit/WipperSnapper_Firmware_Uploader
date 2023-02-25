const FLASH_MODES = {"qio": 0, "qout": 1, "dio": 2, "dout": 3};

const ESP_IMAGE_MAGIC = 0xE9;

export class MergeBin {
    constructor() {
        this._files = [];
        this.flashSize = "keep";
        this.flashMode = "keep";
        this.flashFreq = "keep";
        this.fillFlashSize = null;
        this.targetOffset = 0;
        this.chipDefs = {"esp32": null, "esp32c3": null, "esp32s3": null, "esp32s2": null, "esp8266": null};
    }

    addFile(contents, offset) {
        if (contents instanceof ArrayBuffer) {
            contents = new Uint8Array(contents);
        }
        this._files.push({contents: contents, offset: offset});
    }

    setFlashSize(size = "keep") {
        if (size != "keep") {
            if (this._flashSizeBytes(size)) {
                this.flashSize = size;
            }
        } else {
            this.flashSize = size;
        }
    }

    setFlashMode(mode) {
        if (mode != "keep") {
            if (Object.keys(FLASH_MODES).includes(mode)) {
                this.flashMode = mode;
            } else {
                throw new Error(`Invalid flash mode '${mode}'. Valid modes are: ${Object.keys(FLASH_MODES).join(", ")}`);
            }
        } else {
            this.flashMode = mode;
        }
    }

    setFlashFreq(freq) {
        // No good way to validate before we know the chip
        this.flashFreq = freq;
    }

    setFillFlashSize(size) {
        if (this._flashSizeBytes > 0) {
            this.fillFlashSize = size;
        }
    }

    setTargetOffset(offset) {
        if (offset < 0) {
            throw new Error("Target offset must be >= 0");
        }
        this.targetOffset = offset;
    }

    _sorted(array, key) {
        return array.sort(function(a, b) {
            var aVal = a[key]; var bVal = b[key];
            return ((aVal < bVal) ? -1 : ((aVal > bVal) ? 1 : 0));
        });
    }

    async loadChip(chipname) {
        // Check if we've already loaded it
        if (Object.keys(this.chipDefs).includes(chipname) && this.chipDefs[chipname] != null) {
            return this.chipDefs[chipname];
        }

        // Load the chip definition. I wish there was a less awkward way to do this
        if (chipname == "esp32") {
            const {ESP32} = await import(`./targets/${chipname}.js`);
            this.chipDefs[chipname] = new ESP32();
        } else if (chipname == "esp32c3") {
            const {ESP32C3} = await import(`./targets/${chipname}.js`);
            this.chipDefs[chipname] = new ESP32C3();
        } else if (chipname == "esp32s3") {
            const {ESP32S3} = await import(`./targets/${chipname}.js`);
            this.chipDefs[chipname] = new ESP32S3();
        } else if (chipname == "esp32s2") {
            const {ESP32S2} = await import(`./targets/${chipname}.js`);
            this.chipDefs[chipname] = new ESP32S2();
        } else if (chipname == "esp8266") {
            const {ESP8266} = await import(`./targets/${chipname}.js`);
            this.chipDefs[chipname] = new ESP8266();
        }

        // Return the chip definition if it exists
        if (Object.keys(this.chipDefs).includes(chipname)) {
            return this.chipDefs[chipname];
        }

        return null;
    }

    _calcBufferSize(inputFiles) {
        if (this.fillFlashSize != null) {
            return this._flashSizeBytes(this.fillFlashSize);
        }

        let lastFile = inputFiles[inputFiles.length - 1];
        let highestAddress = lastFile.offset + lastFile.contents.byteLength;

        return highestAddress - this.targetOffset;
    }

    _flashSizeBytes = (size) => {
        /*
        Given a flash size of the type passed in this.flashSize
        (ie 512KB or 1MB) then return the size in bytes.
        */
        if (size.indexOf("MB") > -1) {
            return parseInt(size.slice(0, size.indexOf("MB"))) * 1024 * 1024;
        } else if (size.indexOf("KB") > -1) {
            return parseInt(size.slice(0, size.indexOf("KB"))) * 1024;
        }

        throw new Error(`Unknown size ${size}`);
    };

    async generate(chip) {
        // This is where everything comes together

        let chipClass = await this.loadChip(chip);
        if (!chipClass) {
            msg = `Invalid chip choice: ${chip}\n (choose from ${Object.keys(this.chipDefs).join(", ")})`;
            throw new Error(msg);
        }
        // sort the files by offset.
        // The AddrFilenamePairAction has already checked for overlap
        let inputFiles = this._sorted(this._files, "offset");

        if (!inputFiles) {
            throw new Error("No input files added");
        }

        if (inputFiles[0].offset < this.targetOffset) {
            throw new Error(`Output file target offset is ${this.toHex(this.targetOffset)}. Input file offset ${this.toHex(firstOffset)} is before this.`);
        }

        let outputBuffer = new Uint8Array(this._calcBufferSize(inputFiles)).fill(0xFF);
        let outputPointer = 0;

        const write = (data) => {
            // Use outputPointer to keep track of offset
            outputBuffer.set(data, outputPointer);

            // Advance the outputPointer
            outputPointer += data.byteLength;
        };

        const padTo = (flashOffset) => {
            // Create a buffer that goes from the current pointer to the flash offset in size
            let padBuffer = new Uint8Array(flashOffset - this.targetOffset - outputPointer).fill(0xFF);
            write(padBuffer);
        };

        for (let file of Object.values(inputFiles)) {
            padTo(file.offset);
            var image = file.contents;
            image = this._updateImageFlashParams(chipClass, file.offset, chip, image);
            write(image);
        }

        if (this.fillFlashSize) {
            padTo(this._flashSizeBytes(this.fillFlashSize));
        }

        console.log(`Generated output buffer of ${outputBuffer.byteLength} bytes, ready to flash to offset ${this.toHex(this.targetOffset)}`);

        return outputBuffer;
    }

    _parseFlashSize(chipClass) {
        if (Object.keys(chipClass.FLASH_SIZES).includes(this.flashSize)) {
            return chipClass.FLASH_SIZES[this.flashSize];
        }
        throw new Error(
            `Flash size '${arg}' is not supported by this chip type. \n` +
            `Supported sizes: ${Object.keys(chipClass.FLASH_SIZES).join(", ")}`
        );
    }

    _parseFlashFreq(chipClass) {
        if (Object.keys(chipClass.FLASH_FREQUENCY).includes(this.flashFreq)) {
            return chipClass.FLASH_FREQUENCY[this.flashFreq];
        }
        throw new Error(
            `Flash frequency '${arg}' is not supported by this chip type. \n` +
            `Supported frequencies: ${Object.keys(chipClass.FLASH_FREQUENCY).join(", ")}`
        );
    }

    _updateImageFlashParams(esp, address, chip, image) {
        if (image.length < 8) {
            return image;  // not long enough to be a bootloader image
        }
        // unpack the (potential) image header
        var header = Array.from(new Uint8Array(image, 0, 4));
        let headerMagic = header[0];
        let headerFlashMode = header[2];
        let headerFlashSizeFreq = header[3];

        if (address != esp.BOOTLOADER_FLASH_OFFSET) {
            return image;  // not flashing bootloader offset, so don't modify this
        }

        if (this.flashMode == "keep" && this.flashFreq == "keep" && this.flashSize == "keep") {
            return image;  // all settings are 'keep', not modifying anything
        }

        // easy check if this is an image: does it start with a magic byte?
        if (headerMagic != ESP_IMAGE_MAGIC) {
            console.log(`Warning: Image file at ${this.toHex(address)} doesn't look like an image file, so not changing any flash settings.`);
            return image;
        }

        // Verification of the image is skipped at this time due to complexity

        // After the 8-byte header comes the extended header for chips others than ESP8266.
        // The 15th byte of the extended header indicates if the image is protected by
        // a SHA256 checksum. In that case we should not modify the header because
        // the checksum check would fail.
        var extendedHeader = Array.from(new Uint8Array(image, 8, 24));
        var shaImpliesKeep = chip != "esp8266" && extendedHeader(15) == 1;

        const print_keep_warning = (argToKeep, argUsed) => {
            console.log(
                `Warning: Image file at ${this.toHex(addr)} is protected with a hash checksum, ` +
                `so not changing the flash ${argToKeep.toLowerCase()} setting. ` +
                `Use setFlash${argToKeep}("keep") instead of setFlash${argToKeep}(${argUsed}) ` +
                `in order to remove this warning, or use the --dont-append-digest option ` +
                `for the elf2image command in order to generate an image file ` +
                `without a hash checksum`);
        };

        if (this.flashMode != "keep") {
            var newFlashMode = FLASH_MODES[this.flashMode];
            if (headerFlashMode != newFlashMode && shaImpliesKeep) {
                print_keep_warning("Mode", this.flashMode);
            } else {
                headerFlashMode = newFlashMode;
            }
        }

        let flashFreq = headerFlashSizeFreq & 0x0F;
        if (this.flashFreq != "keep") {
            var newFlashFreq = this._parseFlashFreq(esp);
            if (flashFreq != newFlashFreq && shaImpliesKeep) {
                print_keep_warning("Freq", this.flashFreq);
            } else {
                flashFreq = newFlashFreq;
            }
        }

        let flashSize = headerFlashSizeFreq & 0xF0;
        if (this.flashSize != "keep") {
            var newFlashSize = this._parseFlashSize(esp);
            if (flashSize != newFlashSize && shaImpliesKeep) {
                print_keep_warning("Size", this.flashSize);
            } else {
                flashSize = newFlashSize;
            }
        }

        var flashParams = new Uint8Array([headerFlashMode, flashSize + flashFreq]);
        if (flashParams != headerFlashSizeFreq) {
            console.log(`Flash params set to ${this.toHex(flashParams[0] << 8 + flashParams[1], 4)}`);
            image.set(flashParams, 3);
        }

        return image;
    }

    toHex(value, size = 2) {
        let hex = value.toString(16).toUpperCase();
        if (hex.startsWith("-")) {
            return "-0x" + hex.substring(1).padStart(size, "0");
        } else {
            return "0x" + hex.padStart(size, "0");
        }
    };
}