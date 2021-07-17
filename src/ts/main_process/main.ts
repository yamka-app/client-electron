// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } from "electron";
import { initialize as remoteInit } from "@electron/remote/main";
import zlib      from "zlib";
import tmp       from "tmp";
import path      from "path";
import tls       from "tls";
import fs        from "fs";
// import sslkeylog from "sslkeylog";

import DataTypes                       from "./protocol/dataTypes";
import * as packets                    from "./protocol/packets";
import * as entities                   from "./protocol/entities";
import TastyClient                     from "./protocol/tasty";
import SaltyClient, { SaltyCallbacks, SessionStatus } from "./protocol/salty/salty";

const dataHomePath = path.join(app.getPath("appData"), "yamka");
const configPath   = path.join(dataHomePath, "yamka_config.json");

class YamkaConfig {
    accentColor?:   string;
    fontSize?:      number;
    customTheme?:   boolean;
    theme?:         string;
    notifications?: boolean;
    sendTyping?:    boolean;
    previewYt?:     boolean;
    blurOnDefocus?: boolean;
    sslkeylog?:     boolean;

    bounds?: {
        x:      number;
        y:      number;
        width:  number;
        height: number;
    };
}
var config: YamkaConfig;

var mainWindow    = null;
var tray          = null;
var windowCreated = false;

// Create a temporary directory for downloaded files
tmp.setGracefulCleanup();
const tmpDir = tmp.dirSync().name;
console.log("Temporary directory: " + tmpDir);
console.log("Config and auth: " + configPath);

// electron.app.Electron fix
if(process.platform === "win32")
    app.setAppUserModelId("Yamka");

remoteInit();

function createWindow() {
    if(!windowCreated){
        // Create the window
        mainWindow = new BrowserWindow({
            title:       "Yamka - alpha",
            icon:        path.join(__dirname, "../../logo.png"),
            maximizable: true,
            frame:       false,
            transparent: false,
            minWidth:    1000,
            minHeight:   600,
            webPreferences: {
                contextIsolation: false,
                enableRemoteModule: true,
                preload: path.join(__dirname, "../esnext/renderer/preload.js")
            },
            width:  config?.bounds?.width  ?? 1280,
            height: config?.bounds?.height ?? 720
        });
        mainWindow.loadFile("src/index.html");
        windowCreated = true;
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
    global["sweet"] = sweet;
    global["tmpDir"] = tmpDir;
    loadConfig();

    // if(config.sslkeylog && process.env["SSLKEYLOGFILE"] !== undefined)
    //     sslkeylog.hookAll();
    
    // Create the window
    createWindow();

    // Create the icon in the tray
    tray = new Tray(path.join(__dirname, "../../logo.png"));
    tray.setToolTip("Yamka");
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Open", type: "normal", click() { createWindow() } },
        { label: "Exit", type: "normal", click() {
            // Write config
            config.bounds = mainWindow.getBounds();
            fs.writeFileSync(configPath, JSON.stringify(config));
            // Clean temporary files
            fs.rmdir(tmpDir, { recursive: true }, () => {});
            mainWindow.destroy();
            app.quit();
            sweet.salty?.end();
        } }
    ]));

    // Ping the server occasionally
    setInterval(() => {
        if(!sweet.connected) return;

        webprotSendPacket(new packets.PingPacket(123));
    }, 20000);
});

process.on("exit", () => sweet.salty?.end());
app.on("window-all-closed", () => { windowCreated = false; });

// =========================================== PROTOCOL SECTION

const webprotSettings = {
    host:                 "api.yamka.app",
    port:                 1746,
    version:              11,
    supportsComp:         true,
    compressionThreshold: 512,
    fileChunkSize:        1024 * 4
};

const sweet: {
    connected:  boolean,
    connecting: boolean,
    socket:     any,
    seqId:      number,
    queue:      Buffer[],
    selfId:     number,
    agentId:    number,
    self:       entities.User | {},
    pingSent:   number,
    pingTime:   number,
    tasty:      TastyClient | null,
    salty:      SaltyClient | null,
    downStates: any,
    upStates:   any,
    references: any,
    mainCbs:    any,
    dmChanRev:  any,
    dmChanSt:   any
} = {
    connected:  false,
    connecting: false,
    socket:     null,
    seqId:      1,
    queue:      [],
    selfId:     0,
    agentId:    0,
    self:       {},
    pingSent:   0,
    pingTime:   0,
    tasty:      null,
    salty:      null,
    downStates: {},
    upStates:   {},
    references: {},
    mainCbs:    {},
    dmChanRev:  {},
    dmChanSt:   {}
};

function regCb(fn: (p: packets.Packet) => any) {
    const id = Number.parseInt(Object.keys(sweet.mainCbs).reduce(
        (p, c, i, a) => `${Math.max(Number.parseInt(p), Number.parseInt(c))}`, "0")) + 1;
    sweet.mainCbs[id] = fn;
    return id;
}

function webprotData(bytes: Buffer) {
    // Read the compression header and decompress the data
    const compressed = DataTypes.decBool(bytes.slice(0, 1));
    const totalLen   = DataTypes.decNum (bytes.slice(1, 4));
    bytes = bytes.slice(4, 4 + totalLen);
    if(compressed) bytes = zlib.gunzipSync(bytes);

    const packet = packets.Packet.decode(bytes);

    // Measure ping to the server
    if(packet instanceof packets.PongPacket) {
        sweet.pingTime = new Date().getTime() - sweet.pingSent;
        if(sweet.pingSent !== 0)
            ipcSend({ type: "webprot.status", message: `Latency (round trip): ${sweet.pingTime}ms` });
        return;
    }

    // File downloading
    if(packet instanceof packets.FileDataChunkPacket) {
        const state = sweet.downStates[packet.replyTo];
        const stream = state.stream as fs.WriteStream;
        stream.write(packet.data);
        ipcSend({ type: "webprot.trigger-reference", reason: "download-progress", references: state.refs2,
            args: [packet.position] });
        return;
    }

    // Voice join approval
    if(packet instanceof packets.VoiceJoinPacket) {
        if(sweet.tasty === null)
            throw new Error("Spurious voice join approval");

        ipcSend({ type: "tasty.status", status: "establishing session" });
        sweet.tasty.finish(packet.addr, packet.crypto,
            ()      => ipcSend({ type: "tasty.status", status: "connected" }),
            (stats) => ipcSend({ type: "tasty.stats", stats: stats })
        );
        return;
    }

    // Client identity (start Salty engine)
    if(packet instanceof packets.ClientIdentityPacket) {
        const cb = new SaltyCallbacks();
        cb.entityPut = (e) => webprotSendPacket(new packets.EntitiesPacket(e));
        cb.entityGet = (e, cb) => webprotSendPacket(new packets.EntityGetPacket(e), undefined,
            regCb((p) => cb((p as packets.EntitiesPacket).entities)));
        sweet.salty = new SaltyClient(packet.userId, packet.agentId, cb);
    }

    // File up-/downloading
    if(packet instanceof packets.StatusPacket) {
        if(packet.status == packets.StatusCode.STREAM_END) {
            const state = sweet.downStates[packet.replyTo];
            const stream = state.stream as fs.WriteStream;
            stream.once("finish", () => {
                var decPath = state.path;
                // Possible decrypt the file
                if(state.decr !== "") {
                    decPath = sweet.salty.decryptFile(state.path, state.decr);
                    fs.rmSync(state.path);
                }
                ipcSend({ type: "webprot.trigger-reference", reason: "download-finished", references: state.refs,
                    args: [decPath] });
            });
            stream.end();
            return;
        } else if(packet.status == packets.StatusCode.START_UPLOADING) {
            const state = sweet.upStates[packet.replyTo];
            // Send data in chunks
            const stream = fs.createReadStream(state.path);
            stream.on("data", (chunk: Buffer) => {
                const bytesRead = stream.bytesRead;
                const dataPacket = new packets.FileDataChunkPacket(bytesRead, chunk);
                dataPacket.replyTo = packet.seq;
                webprotSendPacket(dataPacket);
                ipcSend({ type: "webprot.trigger-reference", reason: "upload-progress", reference: state.ref2,
                    args: [bytesRead, state.length] });
            });
            return;
        }
    }

    // Check references
    const ref = sweet.references[packet.replyTo];
    packet.spontaneous = packet.replyTo === 0;

    const finish = () => {
        // Clear all unnecessary fields before sending the packet to the renderer
        delete packet.createSeq;
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

        // See if this response was triggered by a packet sent by the main process
        // Don't tell the renderer about it in this case
        const mainCb = sweet.mainCbs[ref];
        if(mainCb === undefined)
            ipcSend({ type: "webprot.packet-recv", packet: packet, pType: packet.constructor.name, reference: ref });
        else
            mainCb(packet);
    };

    // Intercept incloming entities
    if(packet instanceof packets.EntitiesPacket) {
        const processor = async () => {
            for(const ent of packet.entities) {
                // Mainain a DM-to-user mapping
                if(ent instanceof entities.User && ent.dmChannel !== undefined)
                    sweet.dmChanRev[ent.dmChannel] = ent.id;
    
                // Manage Salty sessions
                if(ent instanceof entities.Channel && ent.group === 0) {
                    const status = sweet.salty.e2eeStatus(ent.id, ent.lcid);
                    sweet.dmChanSt[ent.id] = status;
                    ent.__e2eeReady = status === SessionStatus.NORMAL;
                    // Initiate a session
                    if(status === SessionStatus.NOT_CREATED) {
                        const other = sweet.dmChanRev[ent.id];
                        await sweet.salty.handshakeInit(other, ent.id);
                    }
                }
    
                // Decrypt messages
                if(ent instanceof entities.Message) {
                    if(ent.latest.encrypted === undefined) continue;
                    if(sweet.dmChanRev[ent.channel] === undefined) continue;
                    ent.latest.sections = await sweet.salty.processMsg(ent.channel,
                            sweet.dmChanRev[ent.channel], ent.id, sweet.dmChanSt[ent.channel],
                            ent.latest.encrypted);
                    const chanUpd = new entities.Channel();
                    chanUpd.id = ent.channel;
                    chanUpd.__e2eeReady = sweet.dmChanSt[ent.channel] >= SessionStatus.BOB_READY;
                    packet.entities.push(chanUpd);
                    delete ent.latest.encrypted;
                }
            }  
        };
        processor().then(() => finish());
    } else {
        finish();
    }
}

function webprotSendBytes(bytes: Buffer) {
    if(!sweet.connected) {
        sweet.queue.push(bytes);
        webprotConnect();
        return;
    }

    sweet.socket.write(bytes);
}

function webprotSendPacket(packet: packets.Packet, type?: string, ref?: number, ref2?: number) {
    // Make the packet "full" if requested
    if(type !== undefined) {
        const proto = {
            "LoginPacket":               new packets.LoginPacket(),
            "SignupPacket":              new packets.SignupPacket(),
            "AccessTokenPacket":         new packets.AccessTokenPacket(),
            "EntityGetPacket":           new packets.EntityGetPacket(),
            "EntitiesPacket":            new packets.EntitiesPacket(),
            "FileDownloadRequestPacket": new packets.FileDownloadRequestPacket(),
            "SearchPacket":              new packets.SearchPacket(),
            "ContactsManagePacket":      new packets.ContactsManagePacket(),
            "InviteResolvePacket":       new packets.InviteResolvePacket(),
            "EmailConfirmationPacket":   new packets.EmailConfirmationPacket(),
            "MFASecretPacket":           new packets.MFASecretPacket(),
            "PasswordChangePacket":      new packets.PasswordChangePacket()
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
                    "MessageState": new entities.MessageState(),
                    "Poll":         new entities.Poll(),
                    "Agent":        new entities.Agent()
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
        if(packet instanceof packets.LoginPacket || packet instanceof packets.SignupPacket)
            packet.agent = Object.assign(new entities.Agent(), packet.agent);
    }

    // Measure ping to the server
    if(packet instanceof packets.PingPacket)
        sweet.pingSent = new Date().getTime();

    // Encrypt DM messages
    if(packet instanceof packets.EntitiesPacket) {
        for(const entity of packet.entities) {
            if(entity instanceof entities.Message) {
                if(!(entity.channel in sweet.dmChanRev) || !entity.latest.sections)
                    continue;
                entity.latest.encrypted = sweet.salty.encryptMsg(entity.channel, entity.latest.sections);
                delete entity.latest.sections;
            }
        }
    }

    // Save the reference ID
    packet.createSeq();
    if(ref !== undefined)
        sweet.references[packet.seq] = ref;

    const encodeAndSend = () => {
        var buf = packet.encode();
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
    };

    // Create a download state
    if(packet instanceof packets.FileDownloadRequestPacket) {
        // Don't download if we're already downloading, add a reference instead
        const existing: [string, any] = Object.entries(sweet.downStates)
            // @ts-ignore
            .find(x => x[1].id === packet.id);
        if(existing !== undefined) {
            var state = existing[1];
            const seq = existing[0];
            state.refs.push(ref);
            state.refs2.push(ref2);
            sweet.downStates[seq] = state;
            return;
        }

        const p = path.join(tmpDir, `file_${packet.id}`);
        const stream = fs.createWriteStream(p);
        sweet.downStates[packet.seq] = {
            id: packet.id,
            path: p,
            stream: stream,
            refs: [ref],
            refs2: [ref2],
            decr: packet.__decrypt
        };
    }

    if(packet instanceof packets.EntitiesPacket) {
        for(const entity of packet.entities) {
            if(!(entity instanceof entities.File))
                continue;

            const seq = packet.seq;

            // If the renderer asked us to scale the image down, do exactly that
            var actualPath = entity.path;
            if(entity.__scale) {
                const resizedPath = path.join(tmpDir, "_ava_temp.png");
                const img = nativeImage.createFromPath(entity.path);
                img.resize({ width: 128, height: 128 });
                fs.writeFileSync(resizedPath, img.toPNG());
                actualPath = resizedPath;
            }
            
            // Encrypt the file if the renderer asked for it
            if(entity.__encryptToChan !== undefined) {
                const [encPath, keyhash] = sweet.salty.encryptFile(actualPath);
                actualPath = encPath;
                ipcSend({ type: "webprot.trigger-reference", reason: "upload-keyhash", reference: ref2,
                    args: [keyhash] });
            }
            entity.length = fs.statSync(actualPath).size;
            sweet.upStates[seq] = { path: actualPath, ref: ref, ref2: ref2,
                length: entity.length };

            encodeAndSend();

            return;
        }
    }

    encodeAndSend();
}

function ipcSend(data: any) {
    if(mainWindow?.isDestroyed() === false)
        mainWindow.webContents.send("message", data);
}

function webprotConnect(force: boolean =false) {
    // Abort if connected already
    if((sweet.connecting || sweet.connected) && !force)
        return;

    sweet.connecting = true;
    sweet.seqId = 1;
    sweet.selfId = 0;
    sweet.agentId = 0;
    sweet.self = {};
    sweet.pingSent = 0;
    sweet.tasty = null;
    sweet.salty?.end();
    sweet.salty = null;
    sweet.mainCbs = {};
    sweet.dmChanRev = {};
    sweet.dmChanSt = {};
    packets.Packet.nextSeq = 1;

    // Disconnect if connected
    sweet.socket?.end();

    // Initiate a TLS connection to the server
    const logMessage = `[sweet] connecting to ${webprotSettings.host}:${webprotSettings.port} with protocol version ${webprotSettings.version}`;
    console.log(logMessage);
    ipcSend({ type: "webprot.status", message: logMessage });
    ipcSend({ type: "webprot.connecting" });

    var timeStart = new Date().getTime();
    sweet.socket = tls.connect({
        host: webprotSettings.host,
        port: webprotSettings.port
    }, () => {
        // We have connected
        const timeEnd = new Date().getTime();
        const took = timeEnd - timeStart;
        console.log(`[sweet] connected in ${took} ms`);
        ipcSend({
            type:    "webprot.status",
            message: "Connected in " + took + " ms"
        });
        ipcSend({ type: "webprot.connected" });

        sweet.connected = true;
        sweet.connecting = false;

        // Tell the server our protocol version
        // and the fact that we support compression
        webprotSendPacket(new packets.IdentificationPacket(webprotSettings.version, webprotSettings.supportsComp))

        // Send the packets in the queue
        sweet.queue.forEach((bytes) => {
            webprotSendBytes(bytes);
        });
        sweet.queue = [];
    })

    // Register some events
    sweet.socket.on("data", webprotData);
    sweet.socket.on("end", () => {
        sweet.connected  = false;
        sweet.connecting = false;

        console.log("[sweet] disconnected");
        ipcSend({ type: "webprot.status", message: "Disconnected" })
        ipcSend({ type: "webprot.disconnected" })
    });
    sweet.socket.on("error", (error) => {
        sweet.connected  = false;
        sweet.connecting = false;

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
        if(sweet.tasty instanceof TastyClient)
            sweet.tasty.stop();
        ipcSend({ type: "tasty.status", status: "generating session key" });
        // ask the server to join a voice channel
        sweet.tasty = new TastyClient((key) => {
            ipcSend({ type: "tasty.status", status: "retrieving session token" });
            webprotSendPacket(new packets.VoiceJoinPacket(arg.channel, "", key));
        });
    } else if(arg.action === "tasty.mic-data") {
        if(sweet.tasty === null) return;
        sweet.tasty.micData(arg.data);
    } else if(arg.action === "tasty.disconnect") {
        if(sweet.tasty === null) return;
        sweet.tasty.stop();
        sweet.tasty = null;
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
    } else if(arg.action === "config.appDataPath") {
        event.returnValue = dataHomePath;
    } else if(arg.action === "salty.convInfo") {
        event.returnValue = sweet.salty.convInfo(arg.cid);
    } else {
        event.returnValue = undefined;
    }
});