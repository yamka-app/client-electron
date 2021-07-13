// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const _modules = window["_modules"];

const { ipcRenderer } = _modules.electron;
const remote          = _modules.remote;

import * as packets  from "../protocol.s/packets.s.js";
import * as entities from "../protocol.s/entities.s.js";

export function reset() {
    window.entityCache = {};
    window.userDm = {};
    if(window.filePaths === undefined) window.filePaths = {};

    window.selectedUser = 0;

    window.viewingGroup = 0;
    window.viewingChan = 0;
    window.voiceChan = 0;
    window.viewingContactGroup = 0;
    window.previousChannel = 0;
    window.editingChan = 0;
    window.editingRole = 0;
    window.editingMessage = 0;

    window.lastChanSender = {};
    window.lastChanMsg = {};
    window.fetchingMsgs = false;

    window.packetCallbacks = {};
    window.nextCbId = 0;
}

// Registers a callback
export function regCallback(cb: ((packet: packets.Packet) => any)|undefined): number|undefined {
    if(cb === undefined) return undefined;
    
    const id = window.nextCbId++;
    window.packetCallbacks[id] = cb;
    return id;
}

// Sends a message to the main process
export function ipcSend(data: any) {
    if(data.action !== "webprot.connect")
        console.log("%c[R->M]", "color: #bbbb00; font-weight: bold;", data);
    ipcRenderer.send("asynchronous-message", data);
}
export function sendPacket(p: packets.Packet, cb?: (r: packets.Packet) => any, additional_ref?: (...args: any[]) => any) {
    console.log("%c[SENDING]", "color: #00bb00; font-weight: bold;", p);
    // send the packet
    ipcRenderer.send("asynchronous-message", {
        action: "webprot.send-packet",
        reference: regCallback(cb),
        ref2: regCallback(additional_ref),
        type: p.constructor.name, // we need this so the main process actually knows what we want to send
                                  // because it appears to me that the RPC interface doesn't preserve class info
                                  // because it was designed with pure JS in mind
        packet: p
    });
}

export function sweet() { return remote.getGlobal("sweet"); }
export function self(): entities.User { return sweet().self; }