import { app, BrowserWindow, Tray, Menu, ipcMain } from "electron";
import { initialize as remoteInit } from "@electron/remote/main";
import zlib    from "zlib";
import tmp     from "tmp";
import path    from "path";
import tls     from "tls";
import fs      from "fs";

import DataTypes     from "../protocol/dataTypes";
import * as packets  from "../protocol/packets";
import * as entities from "../protocol/entities";
import TastyClient   from "../protocol/tasty";

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
const tmpDir = tmp.dirSync().name;
console.log("Temporary directory: " + tmpDir);
console.log("Config and auth: " + configPath);

remoteInit();

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
                contextIsolation: false,
                enableRemoteModule: true,
                preload: path.join(__dirname, "../../esnext/renderer/preload.js")
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
    global["tmpDir"] = tmpDir;
    loadConfig();
    
    // Create the window
    createWindow();

    // Create the icon in the tray
    tray = new Tray(path.join(__dirname, "../../../logo.png"));
    tray.setToolTip("Order");
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Open", type: "normal", click() { createWindow() } },
        { label: "Exit", type: "normal", click() {
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
    }, 20000);
})

app.on("window-all-closed", () => { windowCreated = false; });

// =========================================== PROTOCOL SECTION

const webprotSettings = {
    host:                 "api.ordermsg.tk",
    port:                 1746,
    version:              5,
    supportsComp:         true,
    compressionThreshold: 256,
    fileChunkSize:        1024*10
};

const webprotState: {
    connected:  boolean,
    connecting: boolean,
    sendPings:  boolean,
    socket:     any,
    seqId:      number,
    queue:      Buffer[],
    selfId:     number,
    self:       entities.User | {},
    pingSent:   number,
    pingTime:   number,
    tasty:      TastyClient | null,
    downStates: any,
    upStates:   any,
    references: any
} = {
    connected:  false,
    connecting: false,
    sendPings:  false,
    socket:     null,
    seqId:      1,
    queue:      [],
    selfId:     0,
    self:       {},
    pingSent:   0,
    pingTime:   0,
    tasty:      null,
    downStates: {},
    upStates:   {},
    references: {}
};

function webprotData(bytes: Buffer) {
    console.log("Received:", bytes);

    // Read the compression header and decompress the data
    const compressed = DataTypes.decBool(bytes.slice(0, 1));
    const totalLen   = DataTypes.decNum (bytes.slice(1, 4));
    bytes = bytes.slice(4, 4 + totalLen);
    if(compressed) bytes = zlib.gunzipSync(bytes);

    const packet = packets.Packet.decode(bytes);

    // Measure ping to the server
    if(packet instanceof packets.PongPacket) {
        webprotState.pingTime = new Date().getTime() - webprotState.pingSent;
        if(webprotState.pingSent !== 0)
            ipcSend({ type: "webprot.status", message: `Latency (round trip): ${webprotState.pingTime}ms` });
        return;
    }

    // File downloading
    if(packet instanceof packets.FileDataChunkPacket) {
        const stream = webprotState.downStates[packet.replyTo].stream as fs.WriteStream;
        stream.write(packet.data);
        return;
    }

    // Voice join approval
    if(packet instanceof packets.VoiceJoinPacket) {
        if(webprotState.tasty === null)
            throw new Error("Spurious voice join approval");

        ipcSend({ type: "tasty.status", status: "establishing session" });
        webprotState.tasty.finish(packet.addr, packet.crypto,
            ()      => ipcSend({ type: "tasty.status", status: "connected" }),
            (stats) => ipcSend({ type: "tasty.stats", stats: stats })
        );
        return;
    }

    // File uploading
    if(packet instanceof packets.StatusPacket) {
        if(packet.status == packets.StatusCode.STREAM_END) {
            const state = webprotState.downStates[packet.replyTo];
            (state.stream as fs.WriteStream).close();
            ipcSend({ type: "webprot.trigger-reference", reason: "download-finished", references: state.refs, args: [state.path] });
            return;
        } else if(packet.status == packets.StatusCode.START_UPLOADING) {
            const state = webprotState.upStates[packet.replyTo];
            const stream = state.stream as fs.ReadStream;
            const bytesTotal = fs.statSync(state.path).size;
            // Send data in chunks
            stream.on("data", (chunk: Buffer) => {
                const bytesRead = stream.bytesRead;
                const dataPacket = new packets.FileDataChunkPacket(bytesRead, chunk);
                dataPacket.replyTo = packet.seq;
                webprotSendPacket(dataPacket);
                ipcSend({ type: "webprot.trigger-reference", reason: "upload-progress", reference: state.ref2,
                    args: [bytesRead, bytesTotal] });
            })
            return;
        }
    }

    // Check references
    const ref = webprotState.references[packet.replyTo];
    packet.spontaneous = packet.replyTo === 0;

    // Clear all unnecessary fields before sending the packet to the renderer
    delete packet.encode;
    delete packet.decodePayload;
    delete packet.encodePayload;
    delete packet.replyTo;
    delete packet.seq;
    delete packet.typeNum;
    delete packet["simpleFieldList"];
    // Also clear all nested junk
    // While we're at it, add types to nested entities
    if(packet instanceof packets.EntitiesPacket) {
        packet.entities = packet.entities.map(e => {
            if(e instanceof entities.Message && e.latest !== undefined) {
                delete e.latest.simpleFieldList;
                delete e.latest.encode;
                delete e.latest.encodeFields;
                delete e.latest.decodeFields;
            }
            delete e.simpleFieldList;
            delete e.encode;
            delete e.encodeFields;
            delete e.decodeFields;
            delete e["typeNum"];
            return e;
        });
    }
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

function webprotSendPacket(packet: Partial<packets.Packet>, type?: string, ref?: number, ref2?: number) {
    // Make the packet "full" if requested
    if(type !== undefined) {
        const proto = {
            "LoginPacket":               new packets.LoginPacket(),
            "SignupPacket":              new packets.SignupPacket(),
            "AccessTokenPacket":         new packets.AccessTokenPacket(),
            "EntityGetPacket":           new packets.EntityGetPacket(),
            "EntitiesPacket":            new packets.EntitiesPacket(),
            "FileDownloadRequestPacket": new packets.FileDownloadRequestPacket(),
            "UserSearchPacket":          new packets.UserSearchPacket(),
            "ContactsManagePacket":      new packets.ContactsManagePacket(),
            "InviteResolvePacket":       new packets.InviteResolvePacket()
        }[type];

        if(proto === undefined)
            throw new Error(`Unknown packet type when trying to encode: ${type}`);

        packet = Object.assign(proto, packet);

        // Specialized restoration
        if(packet instanceof packets.EntityGetPacket)
            packet.entities = packet.entities.map(e => Object.assign(new packets.EntityGetRequest(), e));
        if(packet instanceof packets.EntitiesPacket) {
            packet.entities = packet.entities.map(e => {
                const e_proto = {
                    "User":         new entities.User(),
                    "Channel":      new entities.Channel(),
                    "Group":        new entities.Group(),
                    "Message":      new entities.Message(),
                    "File":         new entities.File(),
                    "MessageState": new entities.MessageState()
                }[e["__type_name"]];
                const ent = Object.assign(e_proto, e);
                // Handle nested entities
                if(ent instanceof entities.Message)
                    ent.latest = Object.assign(new entities.MessageState(), ent.latest);
                return ent;
            });
        }
        if(packet instanceof packets.EntityGetPacket) {
            const e = packet.entities;
            for(var i = 0; i < e.length; i++) {
                if(e[i].p !== undefined) e[i].p = Object.assign(new packets.EntityPagination(), e[i].p);
                if(e[i].c !== undefined) e[i].c = Object.assign(new packets.EntityContext(),    e[i].c);
            }
        }
    }
    // Measure ping to the server
    if(packet instanceof packets.PingPacket)
        webprotState.pingSent = new Date().getTime();

    // Encode the packet
    var buf = packet.encode();
    // Save the reference ID (encode() sets SEQ)
    if(ref !== undefined)
        webprotState.references[packet.seq] = ref;

    // Create a up-/download state
    if(packet instanceof packets.FileDownloadRequestPacket) {
        // Don't download if we're already downloading, add a reference instead
        const existing: [string, any] = Object.entries(webprotState.downStates)
                                   // @ts-ignore
            .find(x => x[1].id === packet.id);
        if(existing !== undefined) {
            var state = existing[1];
            const seq = existing[0];
            state.refs.push(ref);
            webprotState.downStates[seq] = state;
            return;
        }

        const p = path.join(tmpDir, `file_${packet.id}`);
        const stream = fs.createWriteStream(p);
        webprotState.downStates[packet.seq] = { id: packet.id, path: p, stream: stream, refs: [ref] };
    }
    if(packet instanceof packets.EntitiesPacket) {
        for(const entity of packet.entities) {
            if(!(entity instanceof entities.File))
                continue;

            const p = entity.path;
            const stream = fs.createReadStream(p); // the renderer actually sends the path here
            webprotState.upStates[packet.seq] = { path: p, stream: stream, ref: ref, ref2: ref2 };
        }
    }

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
    if(mainWindow?.isDestroyed() === false)
        mainWindow.webContents.send("message", data);
}

function webprotConnect(force: boolean =false) {
    // Abort if connected already
    if((webprotState.connecting || webprotState.connected) && !force)
        return;

    webprotState.connecting = true;
    webprotState.sendPings = false;
    webprotState.seqId = 1;
    webprotState.selfId = 0;
    webprotState.self = {};
    webprotState.pingSent = 0;
    webprotState.tasty = null;
    packets.Packet.nextSeq = 1;

    // Disconnect if connected
    webprotState.socket?.end();

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
            webprotSendBytes(bytes);
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
    } else if(arg.action === "webprot.force-connect") {
        webprotConnect(true);
    } else if(arg.action === "webprot.send-packet") {
        webprotSendPacket(arg.packet, arg.type, arg.reference, arg.ref2);
    } else if(arg.action === "tasty.connect") {
        // stop existing connection
        if(webprotState.tasty instanceof TastyClient)
            webprotState.tasty.stop();
        ipcSend({ type: "tasty.status", status: "generating session key" });
        // ask the server to join a voice channel
        webprotState.tasty = new TastyClient((key) => {
            ipcSend({ type: "tasty.status", status: "retrieving session token" });
            webprotSendPacket(new packets.VoiceJoinPacket(arg.channel, "", key));
        });
    } else if(arg.action === "tasty.mic-data") {
        if(webprotState.tasty === null) return;
        webprotState.tasty.micData(arg.data);
    } else if(arg.action === "tasty.disconnect") {
        if(webprotState.tasty === null) return;
        webprotState.tasty.stop();
        webprotState.tasty = null;
        ipcSend({ type: "tasty.status", status: "disconnected" });
    }
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