// Note: the code will still work without this line, but without it you
// will see an error in the editor
/* global EspLoader, ESP_ROM_BAUD, ESP32, ESP8266, port, reader, inputBuffer, generate */
'use strict';

const FIRMWARE_API = "//io.adafruit.com"
const DO_DOWNLOAD = false

let espTool;
let isConnected = false;

const baudRates = [115200];
const flashSizes = {
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

const stage_erase_all = 0x01;
const stage_flash_structure = 0x02;
const stage_flash_nvm = 0x03;

const full_program = [stage_erase_all, stage_flash_structure, stage_flash_nvm];
const nvm_only_program = [stage_flash_nvm];

const bufferSize = 512;
const colors = ["#00a7e9", "#f89521", "#be1e2d"];
const measurementPeriodId = "0001";

const maxLogLength = 100;
const log = document.getElementById("log");
const semverLabel = document.getElementById("semver");
const butShowConsole = document.getElementById("butShowConsole");
const consoleItems = document.getElementsByClassName("console-item");
const butConnect = document.getElementById("butConnect");
const binSelector = document.getElementById("binSelector");
const baudRate = document.getElementById("baudRate");
const butClear = document.getElementById("butClear");
const butProgram = document.getElementById("butProgram");
const butProgramNvm = document.getElementById("butProgramNvm");
const autoscroll = document.getElementById("autoscroll");
const lightSS = document.getElementById("light");
const darkSS = document.getElementById("dark");
const darkMode = document.getElementById("darkmode");
const partitionData = document.querySelectorAll(".field input.partition-data");
const progress = document.getElementById("progressBar");
const stepname = document.getElementById("stepname");
const appDiv = document.getElementById("app");
const disableWhileBusy = [partitionData, butProgram, butProgramNvm, baudRate];

let colorIndex = 0;
let activePanels = [];
let bytesReceived = 0;
let currentBoard;
let buttonState = 0;
let showConsole = false;

document.addEventListener("DOMContentLoaded", () => {
    // detect debug setting from querystring
    let debug = false;
    var getArgs = {};
    location.search
        .substr(1)
        .split("&")
        .forEach(function (item) {
            getArgs[item.split("=")[0]] = item.split("=")[1];
        });
    if (getArgs["debug"] !== undefined) {
        debug = getArgs["debug"] == "1" || getArgs["debug"].toLowerCase() == "true";
    }

    // prepare the esptool
    espTool = new EspLoader({
        updateProgress: updateProgress,
        logMsg: logMsg,
        debugMsg: debugMsg,
        debug: debug,
    });

    butShowConsole.addEventListener("click", () => {
      showConsole = !showConsole
      saveSetting("showConsole", showConsole)
      toggleConsole(showConsole)
    })

    // register dom event listeners
    butConnect.addEventListener("click", () => {
        clickConnect().catch(async (e) => {
            errorMsg(e.message);
            disconnect();
        });
    });
    butClear.addEventListener("click", clickClear);
    butProgram.addEventListener("click", clickProgram);
    butProgramNvm.addEventListener("click", clickProgramNvm);
    for (let i = 0; i < partitionData.length; i++) {
        partitionData[i].addEventListener("change", checkProgrammable);
        partitionData[i].addEventListener("keydown", checkProgrammable);
        partitionData[i].addEventListener("input", checkProgrammable);
    }
    autoscroll.addEventListener("click", clickAutoscroll);
    baudRate.addEventListener("change", changeBaudRate);
    darkMode.addEventListener("click", clickDarkMode);

    // handle runaway errors
    window.addEventListener("error", function (event) {
        console.log("Got an uncaught error: ", event.error);
    });

    // WebSerial feature detection
    if ("serial" in navigator) {
        const notSupported = document.getElementById("notSupported");
        notSupported.classList.add("hidden");
    }

    initBinSelector();
    initBaudRate();
    loadAllSettings();
    updateTheme();
    logMsg("Adafruit WebSerial ESPTool loaded.");
    checkProgrammable();
});

/**
 * @name connect
 * Opens a Web Serial connection to a micro:bit and sets up the input and
 * output stream.
 */
async function connect() {
    butConnect.textContent = "Connecting...";
    butConnect.disabled = true
    logMsg("Connecting...");
    await espTool.connect();
    readLoop().catch((error) => {
        toggleUIConnected(false);
    });
}

function createOption(value, text) {
    const option = document.createElement("option");
    option.text = text;
    option.value = value;
    return option;
}

/* Firmware metadata example:
{
  id: "feather_esp32_v2_daily"
  name: "Adafruit Feather ESP32 V2"
  settings: {
    blockSize: 4096
    fileSystemSize: 94208
    offset: "0x290000"
    structure: {
      "0xe000": 'wippersnapper.feather_esp32_v2_daily.littlefs.VERSION.boot_app0.bin',
      "0x1000": 'wippersnapper.feather_esp32_v2_daily.littlefs.VERSION.bootloader.bin',
      "0x10000": 'wippersnapper.feather_esp32_v2_daily.littlefs.VERSION.bin',
      "0x8000": 'wippersnapper.feather_esp32_v2_daily.littlefs.VERSION.partitions.bin'
    }
  }
}
*/

let latestFirmwares = []
async function initBinSelector() {
    // fetch firmware index from io-rails, a list of available littlefs
    // firmware items, like the example above
    const response = await fetch(`${FIRMWARE_API}/wipper_releases`)
    // extract the semver from the custom header
    if(!initSemver(response.headers.get('AIO-WS-Firmware-Semver'))) {
      console.error("No semver information in the response headers!")
    }
    // parse and store firmware data for reuse
    latestFirmwares = await(response.json())

    // populate the bin select element
    binSelector.innerHTML = '';
    binSelector.add(createOption(null, "Click Here to Find Your Board:"))
    latestFirmwares.forEach(firmware => {
        binSelector.add(createOption(firmware.id, firmware.name));
    })

    // pull default board id out of querystring
    if(setDefaultBoard()) {
      // inject board name into alternate step 1
      const boardNameItems = document.getElementsByClassName('selected-board-name')
      for (let idx = 0; idx < boardNameItems.length; idx++) {
        boardNameItems[idx].innerHTML = binSelector.selectedOptions[0].text;
      }
      // show alternate step 1
      const step1Items = document.getElementsByClassName('step-1')
      for (let idx = 0; idx < step1Items.length; idx++) {
        step1Items.item(idx).classList.add("hidden")
      }
      const step1AltItems = document.getElementsByClassName('step-1 alt')
      for (let idx = 0; idx < step1AltItems.length; idx++) {
        step1AltItems.item(idx).classList.remove("hidden")
      }
    } else {
      binSelector.addEventListener("change", changeBin);
    }

    // show next step upon selection
}

// check the querystring for a default board
const QUERYSTRING_BOARD_KEY = 'board'
function getBoardFromQuerystring() {
    const location = new URL(document.location)
    const params = new URLSearchParams(location.search)
    return params.get(QUERYSTRING_BOARD_KEY)
}

function setDefaultBoard() {
    const board = getBoardFromQuerystring()
    if(board && hasBoard(board)) {
      binSelector.value = board
      showStep(2, false)
      return true
    }
}

function hasBoard(board) {
    for (let opt of binSelector.options) {
      console.log(opt.value, board)
      if(opt.value == board) { return opt }
    }
}

function changeBin(selectedBin) {
  (selectedBin.target.value && selectedBin.target.value != "null") ?
    showStep(2) :
    hideStep(2)
}

function showStep(stepNumber, hideLowerSteps=true) {
  for (let stepEl of document.getElementsByClassName(`step-${stepNumber}`)) {
    stepEl.classList.remove("hidden")
  }

  if(hideLowerSteps) {
    // dim all prior steps
    for (let step = stepNumber - 1; step > 0; step--) {
      for (let stepEl of document.getElementsByClassName(`step-${step}`)) {
        stepEl.classList.add("dimmed")
      }
    }
  }

  // scroll to the bottom next frame
  setTimeout((() => appDiv.scrollTop = appDiv.scrollHeight), 0)
}

function hideStep(stepNumber) {
  for (let stepEl of document.getElementsByClassName(`step-${stepNumber}`)) {
    stepEl.classList.add("hidden")
  }
}

function toggleConsole(show) {
  // hide/show the console log and its widgets
  const consoleItemsMethod = show ? "remove" : "add"
  for (let idx = 0; idx < consoleItems.length; idx++) {
    consoleItems.item(idx).classList[consoleItemsMethod]("hidden")
  }
  // hide the show button
  butShowConsole.innerHTML = show ? "Hide Console" : "Show Console"
  // scroll the app div as well
  const appDivMethod = show ? "add" : "remove"
  appDiv.classList[appDivMethod]("with-console")

  // scroll both to the bottom a moment after adding
  setTimeout(() => {
    log.scrollTop = log.scrollHeight
    appDiv.scrollTop = appDiv.scrollHeight
  }, 200)

}

let semver
function initSemver(newSemver) {
  if(!newSemver) { return }

  semver = newSemver
  semverLabel.innerHTML = semver

  return true
}

function lookupFirmwareByBinSelector() {
  // get the currently selected board id
  const selectedId = binSelector.value
  if(!selectedId || selectedId === 'null') { throw new Error("No board selected.") }

  // grab the stored firmware settings for this id
  let selectedFirmware
  for (let firmware of latestFirmwares) {
    if(firmware.id === selectedId) {
      selectedFirmware = firmware
      break
    }
  }

  if(!selectedFirmware) {
    const { text, value } = binSelector.selectedOptions[0]
    throw new Error(`No firmware entry for: ${text} (${value})`)
  }

  return selectedFirmware
}

function initBaudRate() {
    for (let rate of baudRates) {
        baudRate.add(createOption(rate, `${rate} Baud`));
    }
}

let lastPercent = 0;

function updateProgress(part, percentage) {
    if (percentage != lastPercent) {
        logMsg(percentage + "%...");
        lastPercent = percentage;
    }
    let progressBar = progress.querySelector("div");
    progressBar.style.width = percentage + "%";
}

/**
 * @name disconnect
 * Closes the Web Serial connection.
 */
async function disconnect() {
    toggleUIToolbar(false);
    if(espTool.connected()) {
        await espTool.disconnect();
    }
    toggleUIConnected(false);
}

/**
 * @name readLoop
 * Reads data from the input stream and places it in the inputBuffer
 */
async function readLoop() {
    reader = port.readable.getReader();
    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            reader.releaseLock();
            break;
        }
        inputBuffer = inputBuffer.concat(Array.from(value));
    }
}

function logMsg(text) {
    log.innerHTML += text + "<br>";

    // Remove old log content
    if (log.textContent.split("\n").length > maxLogLength + 1) {
        let logLines = log.innerHTML.replace(/(\n)/gm, "").split("<br>");
        log.innerHTML = logLines.splice(-maxLogLength).join("<br>\n");
    }

    if (autoscroll.checked) {
        log.scrollTop = log.scrollHeight;
    }
}

function debugMsg(...args) {
    function getStackTrace() {
        let stack = new Error().stack;
        stack = stack.split("\n").map((v) => v.trim());
        for (let i = 0; i < 3; i++) {
            stack.shift();
        }

        let trace = [];
        for (let line of stack) {
            line = line.replace("at ", "");
            trace.push({
                func: line.substr(0, line.indexOf("(") - 1),
                pos: line.substring(line.indexOf(".js:") + 4, line.lastIndexOf(":")),
            });
        }

        return trace;
    }

    let stack = getStackTrace();
    stack.shift();
    let top = stack.shift();
    let prefix = '<span class="debug-function">[' + top.func + ":" + top.pos + "]</span> ";
    for (let arg of args) {
        if (typeof arg == "string") {
            logMsg(prefix + arg);
        } else if (typeof arg == "number") {
            logMsg(prefix + arg);
        } else if (typeof arg == "boolean") {
            logMsg(prefix + arg ? "true" : "false");
        } else if (Array.isArray(arg)) {
            logMsg(prefix + "[" + arg.map((value) => espTool.toHex(value)).join(", ") + "]");
        } else if (typeof arg == "object" && arg instanceof Uint8Array) {
            logMsg(
                prefix +
                    "[" +
                    Array.from(arg)
                        .map((value) => espTool.toHex(value))
                        .join(", ") +
                    "]"
            );
        } else {
            logMsg(prefix + "Unhandled type of argument:" + typeof arg);
            console.log(arg);
        }
        prefix = ""; // Only show for first argument
    }
}

function errorMsg(text) {
    logMsg('<span class="error-message">Error:</span> ' + text);
    console.error(text);
    // Make sure user sees the error if the log is closed
    if(!showConsole) { alert(text) }
}

function formatMacAddr(macAddr) {
    return macAddr.map((value) => value.toString(16).toUpperCase().padStart(2, "0")).join(":");
}

/**
 * @name updateTheme
 * Sets the theme to  Adafruit (dark) mode. Can be refactored later for more themes
 */
function updateTheme() {
    // Disable all themes
    document.querySelectorAll("link[rel=stylesheet].alternate").forEach((styleSheet) => {
        enableStyleSheet(styleSheet, false);
    });

    if (darkMode.checked) {
        enableStyleSheet(darkSS, true);
    } else {
        enableStyleSheet(lightSS, true);
    }
}

function enableStyleSheet(node, enabled) {
    node.disabled = !enabled;
}

/**
 * @name reset
 * Reset the Panels, Log, and associated data
 */
async function reset() {
    bytesReceived = 0;

    // Clear the log
    log.innerHTML = "";
}

/**
 * @name clickConnect
 * Click handler for the connect/disconnect button.
 */
async function clickConnect() {
    if (espTool.connected()) {
        await disconnect();
        return;
    }

    await connect();

    toggleUIConnected(true);
    try {
        if (await espTool.sync()) {
            showStep(3);
            toggleUIToolbar(true);
            appDiv.classList.add("connected");
            let baud = parseInt(baudRate.value);
            logMsg("Connected to " + (await espTool.chipName()));
            logMsg("MAC Address: " + formatMacAddr(espTool.macAddr()));
            espTool = await espTool.runStub();
            if (baud != ESP_ROM_BAUD) {
                if ((await espTool.chipType()) == ESP32) {
                    logMsg(
                        "WARNING: ESP32 is having issues working at speeds faster than 115200. Continuing at 115200 for now..."
                    );
                } else {
                    await changeBaudRate(baud);
                }
            }
        }
    } catch (e) {
        errorMsg(e);
        await disconnect();
        return;
    }
}

/**
 * @name changeBaudRate
 * Change handler for the Baud Rate selector.
 */
async function changeBaudRate() {
    saveSetting("baudrate", baudRate.value);
    if (isConnected) {
        let baud = parseInt(baudRate.value);
        if (baudRates.includes(baud)) {
            await espTool.setBaudrate(baud);
        }
    }
}

/**
 * @name clickAutoscroll
 * Change handler for the Autoscroll checkbox.
 */
async function clickAutoscroll() {
    saveSetting("autoscroll", autoscroll.checked);
}

/**
 * @name clickDarkMode
 * Change handler for the Dark Mode checkbox.
 */
async function clickDarkMode() {
    updateTheme();
    saveSetting("darkmode", darkMode.checked);
}

/**
 * @name clickProgram
 * Click handler for the program button.
 */
async function clickProgram() {
    await programScript(full_program);
}

/**
 * @name clickProgramNvm
 * Click handler for the program button.
 */
async function clickProgramNvm() {
    await programScript(nvm_only_program);
}

async function populateSecretsFile(path) {
    let response = await fetch(path);
    let contents = await response.json();

    // Get the secrets data
    for (let field of getValidFields()) {
        updateObject(contents, partitionData[field].id, partitionData[field].value);
    }
    // Convert the data to text and return
    return JSON.stringify(contents, null, 4);
}

function updateObject(obj, path, value) {
    if (typeof obj === "undefined") {
        return false;
    }

    var _index = path.indexOf(".");
    if (_index > -1) {
        return updateObject(obj[path.substring(0, _index)], path.substr(_index + 1), value);
    }

    obj[path] = value;
}


let chipFiles
async function fetchFirmwareForSelectedBoard() {
    const firmware = lookupFirmwareByBinSelector()

    logMsg(`Fetching latest firmware...`)
    const response = await fetch(`${FIRMWARE_API}/wipper_releases/${firmware.id}`, {
        headers: { Accept: 'application/octet-stream' }
    })

    // Zip stuff
    logMsg("Unzipping firmware bundle...")
    const blob = await response.blob()
    const reader = new zip.ZipReader(new zip.BlobReader(blob));

    // unzip into local file cache
    chipFiles = await reader.getEntries();
}

const BASE_SETTINGS = {
    files: [
        {
            filename: "secrets.json",
            callback: populateSecretsFile,
        },
    ],
    rootFolder: "files",
};

function findInZip(filename) {
    const regex = RegExp(filename.replace("VERSION", "(.*)"))
    for (let i = 0; i < chipFiles.length; i++) {
        if(chipFiles[i].filename.match(regex)) {
            return chipFiles[i]
        }
    }
}

async function mergeSettings() {
    const { settings } = lookupFirmwareByBinSelector()

    const transformedSettings = {
        ...settings,
        // convert the offset value from hex string to number
        offset: parseInt(settings.offset, 16),
        // replace the structure object with one where the keys have been converted
        // from hex strings to numbers
        structure: Object.keys(settings.structure).reduce((newObj, hexString) => {
            // new object, converted key (hex string -> numeric), same value
            newObj[parseInt(hexString, 16)] = settings.structure[hexString]

            return newObj
        }, {})
    }

    // merge with the defaults and send back
    return {
      ...BASE_SETTINGS,
      ...transformedSettings
    }
}

async function programScript(stages) {
    butProgram.disabled = true
    butProgramNvm.disabled = true
    try {
        await fetchFirmwareForSelectedBoard()
    } catch(error) {
        errorMsg(error.message)
        return
    }

    const settings = await mergeSettings()
    logMsg(`Flashing with settings: ${JSON.stringify(settings, null, 2)}`)

    let steps = [];
    for (let i = 0; i < stages.length; i++) {
        if (stages[i] == stage_erase_all) {
            steps.push({
                name: "Erasing Flash",
                func: async function () {
                    await espTool.eraseFlash();
                },
                params: {},
            });
        } else if (stages[i] == stage_flash_structure) {
            for (const [offset, filename] of Object.entries(settings.structure)) {
                steps.push({
                    name: "Flashing " + filename.replace('VERSION', semver),
                    func: async function (params) {
                        let firmware = await getFirmware(params.filename);
                        await espTool.flashData(firmware, params.offset, 0);
                    },
                    params: {
                        filename: filename,
                        offset: offset,
                    },
                });
            }
        } else if (stages[i] == stage_flash_nvm) {
            steps.push({
                name: "Generating and Flashing LittleFS Partition",
                func: async function (params) {
                    let fileSystemImage = await generate(params.flashParams);

                    if (DO_DOWNLOAD) {
                        // Download the Partition
                        var blob = new Blob([new Uint8Array(fileSystemImage)], {
                            type: "application/octet-stream",
                        });
                        var link = document.createElement("a");
                        link.href = window.URL.createObjectURL(blob);
                        link.download = "littleFS.bin";
                        link.click();
                        link.remove();
                    } else {
                        await espTool.flashData(new Uint8Array(fileSystemImage).buffer, params.flashParams.offset, 0);
                    }
                },
                params: {
                    flashParams: settings,
                },
            });
        }
    }

    for (let i = 0; i < disableWhileBusy.length; i++) {
        if (Array.isArray(disableWhileBusy[i])) {
            for (let j = 0; j < disableWhileBusy[i].length; i++) {
                disableWhileBusy[i][j].disable = true;
            }
        } else {
            disableWhileBusy[i].disable = true;
        }
    }

    progress.classList.remove("hidden");
    stepname.classList.remove("hidden");
    showStep(5)

    for (let i = 0; i < steps.length; i++) {
        stepname.innerText = steps[i].name + " (" + (i + 1) + "/" + steps.length + ")...";
        await steps[i].func(steps[i].params);
    }

    stepname.classList.add("hidden");
    stepname.innerText = "";
    progress.classList.add("hidden");
    progress.querySelector("div").style.width = "0";

    for (let i = 0; i < disableWhileBusy.length; i++) {
        if (Array.isArray(disableWhileBusy[i])) {
            for (let j = 0; j < disableWhileBusy[i].length; i++) {
                disableWhileBusy[i][j].disable = false;
            }
        } else {
            disableWhileBusy[i].disable = false;
        }
    }

    checkProgrammable();
    disconnect();
    logMsg("To run the new firmware, please reset your device.");
    showStep(6);
}

function getValidFields() {
    // Get a list of file and offsets
    // This will be used to check if we have valid stuff
    // and will also return a list of files to program
    let validFields = [];
    for (let i = 0; i < 4; i++) {
        //let pd = parseInt(partitionData[i].value, 16);
        if (partitionData[i].value.length > 0) {
            validFields.push(i);
        }
    }
    return validFields;
}

/**
 * @name checkProgrammable
 * Check if the conditions to program the device are sufficient
 */
async function checkProgrammable() {
    if(getValidFields().length < 4) {
      hideStep(4)
    } else {
      showStep(4, false)
    }
}

/**
 * @name checkFirmware
 * Handler for firmware upload changes
 */
async function checkFirmware(event) {
    let filename = event.target.value.split("\\").pop();
    let label = event.target.parentNode.querySelector("span");
    let icon = event.target.parentNode.querySelector("svg");
    if (filename != "") {
        if (filename.length > 17) {
            label.innerHTML = filename.substring(0, 14) + "&hellip;";
        } else {
            label.innerHTML = filename;
        }
        icon.classList.add("hidden");
    } else {
        label.innerHTML = "Choose a file&hellip;";
        icon.classList.remove("hidden");
    }

    await checkProgrammable();
}

/**
 * @name clickClear
 * Click handler for the clear button.
 */
async function clickClear() {
    reset();
}

function convertJSON(chunk) {
    try {
        let jsonObj = JSON.parse(chunk);
        return jsonObj;
    } catch (e) {
        return chunk;
    }
}

function toggleUIToolbar(show) {
    isConnected = show;
    for (let i = 0; i < 4; i++) {
        progress.classList.add("hidden");
        progress.querySelector("div").style.width = "0";
    }
    if (show) {
        appDiv.classList.add("connected");
    } else {
        appDiv.classList.remove("connected");
    }
}

function toggleUIConnected(connected) {
    let lbl = "Connect";
    if (connected) {
        lbl = "Connected";
        butConnect.disabled = true
        binSelector.disabled = true
    } else {
        toggleUIToolbar(false);
        butConnect.disabled = false
        binSelector.disabled = false
    }
    butConnect.textContent = lbl;
}

function loadAllSettings() {
    // Load all saved settings or defaults
    autoscroll.checked = loadSetting("autoscroll", true);
    baudRate.value = loadSetting("baudrate", baudRates[0]);
    darkMode.checked = loadSetting("darkmode", false);
    showConsole = loadSetting('showConsole', false);
    toggleConsole(showConsole);
}

function loadSetting(setting, defaultValue) {
    return JSON.parse(window.localStorage.getItem(setting)) || defaultValue;
}

function saveSetting(setting, value) {
    window.localStorage.setItem(setting, JSON.stringify(value));
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFirmware(filename) {
    const file = findInZip(filename)

    if(!file) {
      const msg = `No firmware file name ${filename} found in the zip!`
      errorMsg(msg)
      throw new Error(msg)
    }

    logMsg(`Unzipping ${filename}...`)
    const firmwareFile = await file.getData(new zip.Uint8ArrayWriter())

    return firmwareFile.buffer // ESPTool wants an ArrayBuffer
}
