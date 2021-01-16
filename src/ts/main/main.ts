import { app, BrowserWindow, Tray, Menu, ipcMain, remote } from "electron";
import zlib from "zlib";
import tmp  from "tmp";
import path from "path";
import tls  from "tls";
import fs   from "fs";

import DataTypes    from "../protocol/dataTypes";
import * as packets from "../protocol/packets";
import { File }     from "../protocol/entities";

const dataHomePath = path.join(app.getPath("appData"), "ordermsg");
const configPath   = path.join(dataHomePath, "order_config.json");

class OrderConfig {
    accentColor?:   string;
    fontSize?:      number;
    customTheme?:   boolean;
    theme?:         string;
    notifications?: boolean;
    sendTyping?:    boolean;
    previewYt?:     boolean;
    blurOnDefocus?: boolean;

    bounds?: {
        width:  number;
        height: number;
    };
}
var config: OrderConfig;

var mainWindow    = null;
var tray          = null;
var windowCreated = false;

// Create a temporary directory for downloaded files
tmp.setGracefulCleanup();
var tmpDir = tmp.dirSync().name;
console.log("Temporary directory: " + tmpDir);

function createWindow() {
    if(!windowCreated){
        // Create the window
        mainWindow = new BrowserWindow({
            title:       "Order - beta",
            icon:        path.join(__dirname, "../../../logo.png"),
            maximizable: true,
            frame:       false,
            transparent: false,
            minWidth:    1000,
            minHeight:   600,
            webPreferences: {
                nodeIntegration:    true,
                enableRemoteModule: true
            },
            width:  (config && config.bounds) ? config.bounds.width  : 1280,
            height: (config && config.bounds) ? config.bounds.height : 720
        });
        mainWindow.loadFile("src/index.html");
        windowCreated = true;

        // Write configuration when closing
        mainWindow.on("close", (e) => {
            config.bounds = mainWindow.getBounds();
            fs.writeFileSync(configPath, JSON.stringify(config));
            e.preventDefault(); // don"t destroy the window when closing it
        });
    } else {
        mainWindow.show();
    }
}

function loadConfig() {
    try {
        config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch(ex) {
        if(!fs.existsSync(dataHomePath))
            fs.mkdirSync(dataHomePath);
        // Default config
        config = {};
    }
}

app.on("ready", () => {
    loadConfig();

    // Create the window
    createWindow();

    // Create the icon in the tray
    tray = new Tray(path.join(__dirname, "../../../logo.png"));
    tray.setToolTip("Order");
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Open Order", type: "normal", click() { createWindow() } },
        { label: "Exit Order", type: "normal", click() {
            // Clean temporary files
            fs.rmdir(tmpDir, { recursive: true }, () => {});
            mainWindow.destroy();
            app.quit();
        } }
    ]));

    // Ping the server occasionally
    setInterval(() => {
        if(!webprotState.sendPings)
            return;

        webprotSendPacket(new packets.PingPacket(123));
    }, 5000);
})

app.on("window-all-closed", () => { windowCreated = false; });

// =========================================== PROTOCOL SECTION

const webprotSettings = {
    host:                 "ordermsg.tk",
    port:                 1746,
    filePort:             1747,
    version:              5,
    compressionThreshold: 32
};

var webprotState = {
    connected:     false,
    connecting:    false,
    sendPings:     false,
    socket:        null,
    seqId:         1,
    queue:         [],
    self:          {},

    blobStates: [],
    reqStates:  []
}

function webprotData(bytes: Buffer) {
    console.log("Received:", bytes);

    // Read the compression header and decompress the data
    const compressed = DataTypes.decBool(bytes.slice(0, 1));
    const totalLen =   DataTypes.decNum (bytes.slice(1, 5));
    bytes = bytes.slice(5, 5 + totalLen);
    if(compressed)
        bytes = zlib.gunzipSync(bytes);

    const packet = packets.Packet.decode(bytes);
    ipcSend({ type: "webprot.packet-recv", packet: packet });
}

function webprotSendBytes(bytes: Buffer) {
    if(!webprotState.connected) {
        webprotState.queue.push(bytes);
        webprotConnect();
        return;
    }

    console.log("Sending:", bytes);
    webprotState.socket.write(bytes);
}

function webprotSendPacket(packet: packets.Packet) {
    // Encode the packet
    var buf = packet.encode();

    // Compress the data
    const compressed = buf.length >= webprotSettings.compressionThreshold
    if(compressed)
        buf = zlib.gzipSync(buf);

    // Add a compression header
    buf = Buffer.concat([
        DataTypes.encBool(compressed),
        DataTypes.encNum(buf.length, 4),
        buf
    ]);
}

function ipcSend(data) {
    if(mainWindow?.isDestroyed() === false) // yeah (we also need to check for null/undefined, that's why)
        mainWindow.webContents.send("message", data);
}

function webprotConnect() {
    // Abort if connected already
    if(webprotState.connecting || webprotState.connected)
        return;

    webprotState.connecting = true;
    webprotState.sendPings = false;
    webprotState.seqId = 1;
    webprotState.self = {};

    // Initiate a TLS connection to the server
    console.log("Connecting to " + webprotSettings.host + ":" + webprotSettings.port);
    ipcSend({ type: "webprot.status", message: "Connecting" });
    ipcSend({ type: "webprot.connecting" });

    var timeStart = new Date().getTime();
    webprotState.socket = tls.connect({
        host: webprotSettings.host,
        port: webprotSettings.port
    }, () => {
        // We have connected
        const timeEnd = new Date().getTime();
        const took = timeEnd - timeStart;
        console.log("Connected in", took, "ms");
        ipcSend({
            type:    "webprot.status",
            message: "Connected in " + took + " ms"
        });
        ipcSend({ type: "webprot.connected" });

        webprotState.connected = true;
        webprotState.connecting = false;

        // Send the packets in the queue
        webprotState.queue.forEach((bytes) => {
            webprotSendBytes(bytes)
        });
        webprotState.queue = [];
    })

    // Register some events
    webprotState.socket.on("data", webprotData);
    webprotState.socket.on("end", () => {
        webprotState.connected  = false;
        webprotState.connecting = false;
        webprotState.sendPings  = false;

        console.log("Disconnected");
        ipcSend({ type: "webprot.status", message: "Disconnected" })
        ipcSend({ type: "webprot.disconnected" })
    });
    webprotState.socket.on("error", (error) => {
        webprotState.connected  = false;
        webprotState.connecting = false;
        webprotState.sendPings  = false;

        console.log(error);
    });
}

ipcMain.on("asynchronous-message", (event, arg) => {
    if(arg.action === "webprot.connect") {
        webprotConnect();
    } else if(arg.action === "webprot.send-packet") {
        webprotSendPacket(arg.packet);
    }/* else if(arg.action == "webprot.blob-dl") {
        // Refuse if there"s already a blob operation
        const existing = webprotState.blobStates.find(x => x.id == arg.id);
        if(existing) {
            return;
        } else {
            // Create a new state object
            webprotState.blobStates.push({
                id:               arg.id,
                state:            "awaitingInfo",
                progress:         0,
                received:         0,
                operId:           arg.blobOperId,
                previewOperId:    arg.previewOperId,
                actuallyDownload: arg.actuallyDownload
            });

            // Get blob info
            webprotSendPacket(new packets.FileTokenRequestPacket(arg.id));
        }
    } else if(arg.action == "webprot.blob-ul") {
        // Get file length
        var len = fs.statSync(arg.path).size
        
        // Create a new state object
        webprotState.blobStates.push({
            id:             0,
            path:           arg.path,
            length:         len,
            state:          "awaitingUploadToken",
            progress:       0,
            sent:           0,
            operId:         arg.blobOperId,
            progressOperId: arg.progressOperId,
        })

        // Get the upload token
        
        webprotSendPacket(new packets.FileUploadTokenRequestPacket(new File()));
    }*/
});

ipcMain.on("synchronous-message", (event, arg) => {
    if(arg.action === "config.set") {
        config[arg.k] = arg.v;
        fs.writeFile(configPath, JSON.stringify(config), () => {});
        event.returnValue = undefined;
    } else if(arg.action === "config.get") {
        event.returnValue = config[arg.k];
    } else {
        event.returnValue = undefined;
    }
});