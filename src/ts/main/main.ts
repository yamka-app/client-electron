import { app, BrowserWindow, Tray, Menu, ipcMain, remote } from "electron";
import zlib    from "zlib";
import tmp     from "tmp";
import path    from "path";
import tls     from "tls";
import fs      from "fs";

import DataTypes     from "../protocol/dataTypes";
import * as packets  from "../protocol/packets";
import * as entities from "../protocol/entities";
import { File }     from "../protocol/entities";
import { EntitiesPacket } from "../protocol.s/packets.s";

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
console.log("Config and auth: " + configPath);

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
    global["webprotState"] = webprotState;
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
        if(!webprotState.sendPings) return;

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
    supportsComp:         true,
    compressionThreshold: 256,
};

var webprotState = {
    connected:     false,
    connecting:    false,
    sendPings:     false,
    socket:        null,
    seqId:         1,
    queue:         [],
    selfId:        0,
    self:          {},
    pingSent:      0,
    pingTime:      0,

    blobStates:    [],
    references:    {}
}

function webprotData(bytes: Buffer) {
    console.log("Received:", bytes);

    // Read the compression header and decompress the data
    const compressed = DataTypes.decBool(bytes.slice(0, 1));
    const totalLen =   DataTypes.decNum (bytes.slice(1, 4));
    bytes = bytes.slice(4, 4 + totalLen);
    if(compressed) bytes = zlib.gunzipSync(bytes);

    const packet = packets.Packet.decode(bytes);

    // Measure ping to the server
    if(packet instanceof packets.PongPacket) {
        webprotState.pingTime = new Date().getTime() - webprotState.pingSent;
        if(webprotState.pingSent !== 0)
            ipcSend({ type: "webprot.status", message: `Protocol ping (round trip): ${webprotState.pingTime}ms` });
        return;
    }

    // Check references
    const ref = webprotState.references[packet.replyTo];

    // Clear all unnecessary fields before sending the packet to the renderer
    delete packet.encode;
    delete packet.encode;
    delete packet.decodePayload;
    delete packet.encodePayload;
    delete packet.replyTo;
    delete packet.seq;
    delete packet.typeNum;
    delete packet["simpleFieldList"];
    ipcSend({ type: "webprot.packet-recv", packet: packet, pType: packet.constructor.name, reference: ref });
}

function webprotSendBytes(bytes: Buffer) {
    if(!webprotState.connected) {
        webprotState.queue.push(bytes);
        webprotConnect();
        return;
    }

    console.log("Sending: ", bytes);
    webprotState.socket.write(bytes);
}

function webprotSendPacket(packet: Partial<packets.Packet>, type?: string, ref?: number) {
    // Make the packet "full" if requested
    if(type !== undefined) {
        const proto = {
            "LoginPacket":       new packets.LoginPacket(),
            "SignupPacket":      new packets.SignupPacket(),
            "AccessTokenPacket": new packets.AccessTokenPacket(),
            "EntityGetPacket":   new packets.EntityGetPacket()
        }[type];

        if(proto === undefined)
            throw new Error(`Unknown packet type when trying to encode: ${type}`);

        packet = Object.assign(proto, packet);

        // Specialized restoration
        if(packet instanceof packets.EntityGetPacket)
            packet.entities = packet.entities.map(e => Object.assign(new packets.EntityGetRequest(), e));
    }
    // Measure ping to the server
    if(packet instanceof packets.PingPacket)
        webprotState.pingSent = new Date().getTime();

    // Encode the packet
    var buf = packet.encode();
    // Save the reference ID (encode() sets SEQ)
    webprotState.references[packet.seq] = ref;

    // Compress the data
    const compressed = buf.length >= webprotSettings.compressionThreshold;
    if(compressed) buf = zlib.gzipSync(buf);

    // Add a compression header
    buf = Buffer.concat([
        DataTypes.encBool(compressed),
        DataTypes.encNum(buf.length, 3),
        buf
    ]);

    webprotSendBytes(buf);
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
    webprotState.selfId = 0;
    webprotState.self = {};
    webprotState.pingSent = 0;
    packets.Packet.nextSeq = 1;

    // Initiate a TLS connection to the server
    const logMessage = `Connecting to ${webprotSettings.host}:${webprotSettings.port} with protocol version ${webprotSettings.version}`;
    console.log(logMessage);
    ipcSend({ type: "webprot.status", message: logMessage });
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

        // Tell the server our protocol version
        // and the fact that we support compression
        webprotSendPacket(new packets.IdentificationPacket(webprotSettings.version, webprotSettings.supportsComp))

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
        webprotSendPacket(arg.packet, arg.type, arg.reference);
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