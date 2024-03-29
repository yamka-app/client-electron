// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// General utility functions, constants and things

import * as domUtil  from "./dom_util/dom_util.js";
import * as packets  from "../protocol.s/packets.s.js";
import * as entities from "../protocol.s/entities.s.js";
import * as types    from "../protocol.s/dataTypes.s.js";
import * as i18n     from "./dom_util/i18n.js";

import { sendPacket }   from "./yGlobal.js";
import { configGet }    from "./settings.js";
import { addHoverText } from "./popups.js";
import { match } from "assert";

const _modules = window["_modules"];

const path        = _modules.path;
const nodeEmoji   = _modules.nodeEmoji;
const _escapeHtml = _modules.escapeHtml;
const marked      = _modules.marked;
const fs          = _modules.fs;
const tinycolor   = _modules.tinycolor;

export const clientVersion = "0.12.2";
export const clientDebug = true;

export const escapeHtml: (t: any) => string = _escapeHtml;

export const emailRegex = /(?:[a-z0-9!#$%&"*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&"*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/i;
export const allEmojiRegex = /<pre>(\p{Emoji}| |((?<!\\):![0-9]+:)|\r|\n|\r\n){1,20}<\/pre>/u;

// Kaomoji, yaaay!
export const kaomoji: [string, string][] = [
    ["/shrug",     "¯\\_(ツ)_/¯"],
    ["/tableflip", "(╮°-°)╮┳━━┳ ( ╯°□°)╯ ┻━━┻"],
    ["/unflip",    "┬─┬ ノ( ゜-゜ノ)"],
    ["/cat",       "(＾• ω •＾)"],
    ["/fish",      ">°))))彡"],
    ["/music",     "(^_^♪)"],
    ["/f",         "(￣^￣)ゞ"],
    ["/wink",      "(^_~)"],
    ["/hug",       "(づ ◕‿◕ )づ"],
    ["/love",      "(◕‿◕)♡"],
    ["/hi",        "ヾ(・ω・*)"],
    ["/surprise",  "(⊙_⊙)"],
    ["/doubt",     "(→_→)"],
    ["/whatever",  "┐(￣～￣)┌"],
    ["/fear",      "(;;;*_*)"],
    ["/crying",    "(╥_╥)"],
    ["/joy",       "(* ^ ω ^)"]
];
export function applyKaomoji(str: string) {
    for(const kao of kaomoji) {
        if(kao !== undefined)
            str = str.replace(kao[0], kao[1]);
    }
    return str;
}

// Prepares message text (sanitizes it and inserts line breaks)
export function prepareMsgText(txt: string): string {
    return escapeHtml(txt).replace(/(?:\r\n|\r|\n)/g, "<br>");
}
export function markupText(txt: string) {
    const esc = "<pre>" +
        marked.parseInline(                         // Markdown parser
        nodeEmoji.emojify(                          // I :heart: Emoji
        escapeHtml(txt))) +                         // no XSS for ya today, sorry
        "</pre>"   
        .replace(/(?:\r\n|\r|\n)/g, "</pre><pre>"); // insert line breaks
    return applyKaomoji(esc);
}

export function adjustTextAreaHeight(elm: HTMLTextAreaElement) {
    elm.style.height = "0px";
    elm.style.height = `${elm.scrollHeight}px`;
}

export function showElm(element: HTMLElement|string) {
    (element instanceof HTMLElement ? element : elmById(element)).style.display = "";
}
export function hideElm(element: HTMLElement|string) {
    (element instanceof HTMLElement ? element : elmById(element)).style.display = "none";
}
export function setElmVisibility(elm: HTMLElement, vis: boolean) { if(vis) showElm(elm); else hideElm(elm); }
export function toggleElm(element: HTMLElement) {
    if(element.style.display == "none")
        showElm(element);
    else
        hideElm(element);
}

// Apply "appearing" or "disappearing" animations (optionally hiding and showing the parent element)
export function triggerAppear(element: HTMLElement, affectParent: boolean =false) {
    if(affectParent)
        showElm(element.parentElement);

    element.classList.remove("disappearing");
    element.classList.add   ("appearing");
}
export function triggerDisappear(element: HTMLElement, affectParent: boolean =false, destroy: boolean =false) {
    if(affectParent) // 200 ms is the animation duration
        setTimeout(() => hideElm(element.parentElement), 200);

    element.classList.remove("appearing");
    element.classList.add   ("disappearing");

    if(destroy)
        setTimeout(() => element.remove(), 200);
}

// "document.getElementById" shorthand
export const elmById = (id: string) => document.getElementById(id);

// Converts an ID into a time string
export function idToTime(id: number): string {
    const timestamp = (BigInt(id) >> BigInt(16)) + BigInt(1577836800000);
    const date = new Date(Number(timestamp));
    return date.toLocaleDateString(undefined, {
        year:   "numeric",
        month:  "long",
        day:    "numeric",
        hour:   "numeric",
        minute: "numeric",
        second: "numeric"
    });
}
function timeFormatArgs(date: Date) {
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    const milestones = [
        { suffix: "y",  div: 3600 * 24 * 365, fraction: 1 },
        { suffix: "mo", div: 3600 * 24 * 30,  fraction: 1 },
        { suffix: "d",  div: 3600 * 24,       fraction: 0 },
        { suffix: "h",  div: 3600,            fraction: 0 },
        { suffix: "m",  div: 60,              fraction: 0 }
    ];
    for(const ms of milestones)
        if(diff >= ms.div)
            return {
                key: "msg_time.unit." + ms.suffix,
                val: (diff / ms.div).toFixed(ms.fraction)
            };
    return {key: "msg_time.unit.recently", val: "0"};
}
// Creates a self-updating "x <units> ago" string
export function timeElm(id: number, reply: boolean = false, edited: boolean = false) {
    const timestamp = (BigInt(id) >> BigInt(16)) + BigInt(1577836800000);
    const date = new Date(Number(timestamp));
    const elm = document.createElement("span");
    addHoverText(elm, idToTime(id));
    const upd = () => {
        var args = {edited: edited ? "%msg_time.edited" : ""};
        elm.setAttribute("x-key", "msg_time.format." + (reply ? "reply" : "normal"));
        const {key, val} = timeFormatArgs(date);
        args = {...args, ...{val: val, time: `%${key}`}};
        i18n.formatElement(elm, args);
    };
    upd();
    setInterval(upd, 10000);
    return elm;
}

// Gets time difference in ms
export function timeDiff(id1: number, id2: number): number {
    if(id1 === undefined || id2 === undefined)
        return 0;
    const ts1 = Number((BigInt(id1) >> BigInt(16)));
    const ts2 = Number((BigInt(id2) >> BigInt(16)));
    return ts2 - ts1;
}

// Convert a status number to text or a path to status icon
export function statusStr(status: number): string {
    return ["offline", "online", "idle", "dnd", "focus"][status];
}
export function statusIconPath(status: number): string {
    return path.join(window["__dirname"], "icons/" + statusStr(status) + ".png");
}

// Format tag
export function formatTag(tag: number): string {
    return "#" + String(tag).padStart(5, "0")
}

// Generates a summary text of the message
export function limitLength(text: string, len = 50) {
    if(text.length < len)
        return text;
    return text.slice(0, len) + "...";
}
export function messageSummary(msg: entities.Message) {
    return messageStateSummary(msg.latest);
}
export function messageStateSummary(state: entities.MessageState): string {
    for(const section of state.sections)
        if([types.MessageSectionType.CODE, types.MessageSectionType.TEXT].includes(section.type))
            return limitLength(section.text);
    for(const section of state.sections)
        if(section.type === types.MessageSectionType.QUOTE)
            return "Quote: " + limitLength(section.text);
    for(const section of state.sections)
        if(section.type === types.MessageSectionType.FILE)
            return "File";
    for(const section of state.sections)
        if(section.type === types.MessageSectionType.INVITE)
            return "Invite";
    return "Empty message";
}

// Stops all propagation of events
export function stopPropagation(evt: Event) {
    evt.stopPropagation();
    evt.cancelBubble = true;
}

// Returns a human readable file size
export function readableFileSize(fileSize: number): string {
    if(fileSize < 1024)
        return fileSize + " B";
    else if(fileSize >= 1024 * 1024)
        return (fileSize / (1024 * 1024)).toFixed(2) + " MiB";
    else if(fileSize >= 1024)
        return (fileSize / 1024).toFixed(2) + " KiB";
}

export function upload(filePath: string, onEnd: (id: number) => any,
            onProgressMade: (p: number, m: number) => any = (p, m) => null,
            onEncryptionKey: (keyhash: string) => any = (k) => null,
            encrypt: boolean = true, scale: boolean = false, emojiName?: string) {
    const file = new entities.File();
    file.id = 0; file.length = fs.statSync(filePath).size;
    file.__path = filePath; file.name = path.basename(filePath);
    file.__scale = scale;
    file.__encryptToChan = encrypt ? 1 : undefined;
    file.emojiName = emojiName;
    sendPacket(new packets.EntitiesPacket([file]), (resp: packets.EntitiesPacket) => {
        // There's only a single entity in the packet
        onEnd(resp.entities[0].id);
    }, (p: number|string, m: number) => {
        if(typeof p === "string") onEncryptionKey(p);
                             else onProgressMade(p, m);
    });
}
export function download(id: number, onEnd?: (path: string) => any,
        onProg?: (d: number) => any, keyhash: string = "") {
    if(id === undefined)
        throw new Error();
    // Files, like message states and unlike all other entities,
    // are immutable. This means that we can cache them heavily.
    // If a file (like an avatar, group icon, etc.) changes, it actually doesn't.
    // A new file with a new ID is created.
    const existingPath = window.filePaths[id];
    if(existingPath !== undefined) {
        onEnd(existingPath);
        return;
    }
    sendPacket(new packets.FileDownloadRequestPacket(id, keyhash), (r: packets.Packet) => {
        // Trust me, it's a string
        const filePath = (r as unknown) as string;
        window.filePaths[id] = filePath;
        onEnd(filePath);
    }, onProg);
}

// Requests entities (or returns cached ones if possible)
export function reqEntities(ents: packets.EntityGetRequest[], force: boolean =false, cb?: (e?: entities.Entity[])=>any) {
    const remaining_ents = ents.filter(x => !(x.id in window.entityCache) || force);
    const triggerCb = (newEnts: entities.Entity[]) => {
        cb(ents.map(r => window.entityCache[r.id]));
    };
    if(remaining_ents.length === 0 && cb !== undefined) {
        triggerCb([]);
        return;
    }
    sendPacket(new packets.EntityGetPacket(remaining_ents), (response: packets.EntitiesPacket) => {
        if(cb !== undefined)
            triggerCb(response.entities);
    });
}

// Puts entities
export function putEntities(ents: entities.Entity[], cb?: (r: packets.Packet) => any) {
    sendPacket(new packets.EntitiesPacket(ents), cb);
}

// Parses URL hostname
export function parseHostname(url: string): string {
    var match = url.match(/:\/\/(www[0-9]?\.)?(.[^/:]+)/i)
    if (match != null && match.length > 2 && typeof match[2] === "string" && match[2].length > 0)
        return match[2];
    else
        return undefined;
}

// Parses a URL parameter
export function parseUrlParameter(url: string, param: string): string {
    url = url.split("?")[1];
    var urlVars = url.split("&");

    for (var i = 0; i < urlVars.length; i++) {
        var parName = urlVars[i].split("=");
        if (parName[0] === param)
            return parName[1];
    }
}

export function markRead(channel: number, local: boolean =false) {
    if(local) {
        const chan = window.entityCache[window.viewingChan] as entities.Channel;
        chan.unread = 0;
        chan.firstUnread = window.lastChanMsg[chan.id];
        if(window.userDm[chan.id] !== undefined)
        domUtil.updateUser(window.userDm[chan.id]);
        return;
    }
    const chan = new entities.Channel();
    chan.id = channel;
    chan.unread = 0;
    putEntities([chan]);
}

var typingClearTimer, currentlyTyping;
export function sendTyping() {
    if(!configGet("sendTyping"))
        return;
    if(currentlyTyping)
        return;

    // Cancel the previous typing clear timer
    if(typingClearTimer)
        clearTimeout(typingClearTimer);
    // Send the typing notification
    currentlyTyping = true;
    const chan = new entities.Channel();
    chan.id = window.viewingChan; chan.typing = [0];
    putEntities([chan]);
    // Create a typing clear timer
    typingClearTimer = setTimeout(() => {
        clearTyping()
    }, 10000);
}

// Says "no, we"re not typing anymore"
export function clearTyping(additionalEntities?: entities.Entity[]) {
    currentlyTyping = false;
    clearTimeout(typingClearTimer);
    const chan = new entities.Channel();
    chan.id = window.viewingChan; chan.typing = [];
    putEntities([chan, ...(additionalEntities ?? [])]);
}

export function updTyping(txt: string) {
    if(txt.length > 0)
        sendTyping();
    else
        clearTyping();
}

export function extractMention(txt: string, caret: number, stop: string[]) {
    if(txt.length === 0)               return undefined;
    if(stop.some(x => x.length !== 1)) return undefined;

    txt = txt.substring(0, caret);
    const tokens = txt.split(/ |\n/g);
    const last = tokens[tokens.length - 1];

    if(stop.some(s => last.startsWith(s) && !last.startsWith("\\")))
        return last;
}
export function mentionToken(txt: string, caret: number, stop: string[]) {
    if(txt.length === 0)               return undefined;
    if(stop.some(x => x.length !== 1)) return undefined;

    txt = txt.substring(0, caret);
    const tokens = txt.split(/ |\n/g);
    return tokens.length - 1;
}

export function processMentions(txt: string) {

}

export function formatMentions(elm: Element) {
    if(elm instanceof HTMLPreElement || elm instanceof HTMLAnchorElement) {
        var text = elm.innerHTML;
        const matches = Array.from(text.matchAll(/(?<!\\)@[0-9]+/g))
            // reverse the order
            .sort((a, b) => b.index - a.index)
            // parse IDs
            .map(x => { x["id"] = parseInt(x[0].substr(1)); return x; });
        
        reqEntities(matches.map(x => new packets.EntityGetRequest(entities.User.typeNum, x["id"])), false, () => {
            for(const match of matches) {
                const mText = match[0];
                const idx = match.index;
                const before = text.substring(0, idx);
                const after = text.substring(idx + mText.length);
                const username = (entityCache[match["id"]] as entities.User).name;
                text = `${before}<span id="${match["id"]}" class="mention">@${username}</span>${after}`;
            }

            elm.innerHTML = text;
            const mentions = elm.querySelectorAll("span.mention") as NodeListOf<HTMLSpanElement>;
            for(const mention of mentions) {
                mention.onclick = (e) => {
                    stopPropagation(e);
                    domUtil.showProfile(parseInt(mention.id));
                };
            }
        });

        return;
    }

    for(const child of [...elm.children])
        formatMentions(child);
}

export function formatCustomEmoji(elm: Element) {
    if(elm instanceof HTMLPreElement || elm instanceof HTMLAnchorElement) {
        var text = elm.innerHTML;
        const matches = Array.from(text.matchAll(/(?<!\\):![0-9]+:/g))
            // reverse the order
            .sort((a, b) => b.index - a.index)
            // parse IDs
            .map(x => { x["id"] = parseInt(x[0].slice(2, -1)); return x; });
        
        reqEntities(matches.map(x => new packets.EntityGetRequest(entities.File.typeNum, x["id"])), false, () => {
            for(const match of matches) {
                const mText = match[0];
                const idx = match.index;
                const before = text.substring(0, idx);
                const after = text.substring(idx + mText.length);
                const file = (entityCache[match["id"]] as entities.File);
                text = `${before}<img alt=":${file.emojiName}:" class="emoji emoji-custom-${file.id}">${after}`;
            }
            elm.innerHTML = text;

            // assign images
            for(const match of matches) {
                const id = match["id"];
                const emoji = [...elm.querySelectorAll(`.emoji-custom-${id}`)];

                // set paths
                download(id, (path) => {
                    for(const img of emoji)
                        (img as HTMLImageElement).src = path;
                });
            }
        });

        return;
    }

    for(const child of [...elm.children])
        formatCustomEmoji(child);
}

// Color operations
// @ts-ignore
const colorThief = new ColorThief();
export function getPrimaryColor(img: HTMLImageElement) {
    const [r, g, b] = colorThief.getColor(img);
    return `rgb(${r},${g},${b})`;
}
export function isColorLight(color: string) {
    return tinycolor(color).isLight();
}
export function deriveSecondary(color: string) {
    return tinycolor(color).triad()[1].toHexString();
}
export function colorSpin(color: string, amt=-20) {
    return tinycolor(color).spin(amt).toHexString();
}

// Single-line input auto-size
const _width_canvas = document.createElement("canvas").getContext("2d");
export function textWidth(text: string, style: string) {
    _width_canvas.font = style;
    return _width_canvas.measureText(text).width;
}
export function resizeSingleLineInput(elm: HTMLInputElement) {
    const value = (elm.value === "") ? elm.placeholder : elm.value;
    const style = getComputedStyle(elm).font;
    elm.style.width = `${Math.min(textWidth(value, style) + 20, 300)}px`;
}