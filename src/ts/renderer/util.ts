// General utility functions, constants and things

import * as domUtil  from "./dom_util/dom_util.js";
import * as packets  from "../protocol.s/packets.s.js";
import * as entities from "../protocol.s/entities.s.js";
import * as types    from "../protocol.s/dataTypes.s.js";

import { sendPacket } from "./yGlobal.js";
import { configGet }  from "./settings.js";

const _modules = window["_modules"];

const path            = _modules.path;
const remote          = _modules.remote;
const remark          = _modules.remark;
const _escapeHtml     = _modules.escapeHtml;
const marked          = _modules.marked;
const compareVersions = _modules.compareVersions;
const fs              = _modules.fs;

export const clientVersion = "0.6.0";

export const escapeHtml: (t: any) => string = _escapeHtml;

export const emailRegex = /(?:[a-z0-9!#$%&"*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&"*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/i;
export const allEmojiRegex = /^<span>\p{Emoji}{1,5}<\/span>$/gum;

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
    var esc = remark.processSync(
        ("<span>" +
        marked.parseInline(                           // Markdown parser
        escapeHtml(txt)) +                            // no XSS for ya today, sorry
        "</span>")   
        .replace(/(?:\r\n|\r|\n)/g, "</span><span>")) // insert line breaks
        .contents
    return applyKaomoji(esc.toString());
}

export function adjTaHeight(elm: HTMLTextAreaElement) {
    elm.rows = Math.min(elm.value.split(/\r\n|\r|\n/).length, 10);
}

export function showElm(element: HTMLElement) { element.style.display = ""; }
export function hideElm(element: HTMLElement) { element.style.display = "none"; }
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
export function triggerDisappear(element: HTMLElement, affectParent: boolean =false) {
    if(affectParent) // 200 ms is the animation duration
        setTimeout(() => hideElm(element.parentElement), 200);

    element.classList.remove("appearing");
    element.classList.add   ("disappearing");
}

// "document.getElementById" shorthand
export const elmById = (id: string) => document.getElementById(id);

// Check the client version
export function checkClientVersion() {
    console.log(`Retrieving the latest version number for platform "${remote.process.platform}"`);
    const xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
        if (this.readyState === 4 && this.status === 200) {
            const version = xhttp.responseText.replace(/^\s+|\s+$/g,"").trim();
            console.log(`Newest version: ${version}`);
            if(compareVersions(version, clientVersion) === 1)
                domUtil.showUpdBox(`${clientVersion} → ${version}`);
        } else if(this.readyState === 4) {
            console.error("Unable to get the latest version");
        }
    };
    xhttp.open("GET", `https://yamka.app/latest_version/${remote.process.platform}`, true);
    xhttp.send();
}

// Converts an ID into a time string
export function idToTime(id: number): string {
    const timestamp = (BigInt(id) >> BigInt(16)) + BigInt(1577836800000);
    const date = new Date(Number(timestamp));
    return date.toLocaleDateString(undefined, {
        year:   "numeric",
        month:  "long",
        day:    "numeric",
        hour:   "numeric",
        minute: "numeric"
    });
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
    return ["offline", "online", "sleep", "dnd"][status];
}
export function statusIconPath(status: number): string {
    return path.join(window["__dirname"], "icons/" + statusStr(status) + ".png");
}

// Format tag
export function formatTag(tag: number): string {
    return "#" + String(tag).padStart(5, "0")
}

// Generates a summary text of the message
export function messageSummary(msg: entities.Message) {
    return messageStateSummary(msg.latest);
}
export function messageStateSummary(state: entities.MessageState): string {
    for(const section of state.sections) {
        if([types.MessageSectionType.CODE, types.MessageSectionType.TEXT].includes(section.type))
            return section.text;
        if(section.type === types.MessageSectionType.QUOTE)
            return "Quote: " + section.text;
        if(section.type === types.MessageSectionType.FILE)
            return "File";
        if(section.type === types.MessageSectionType.INVITE)
            return "Invite";
    }
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
            onProgressMade?: (p: number, m: number) => any, scale: boolean = false) {
    const file = new entities.File();
    file.id = 0; file.length = fs.statSync(filePath).size;
    file.path = filePath; file.name = path.basename(filePath);
    file.__scale = scale;
    sendPacket(new packets.EntitiesPacket([file]), (resp: packets.EntitiesPacket) => {
        // There's only a single entity in the packet
        onEnd(resp.entities[0].id);
    }, onProgressMade);
}
export function download(id: number, onEnd?: (path: string) => any) {
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
    sendPacket(new packets.FileDownloadRequestPacket(id), (r: packets.Packet) => {
        // Trust me, it's a string
        const filePath = (r as unknown) as string;
        window.filePaths[id] = filePath;
        onEnd(filePath);
    });
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
export function putEntities(ents: entities.Entity[]) {
    sendPacket(new packets.EntitiesPacket(ents));
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
    const tokens = txt.split(" ");
    const last = tokens[tokens.length - 1];

    if(stop.some(s => last.startsWith(s) && !last.startsWith("\\")))
        return last;
}
export function mentionToken(txt: string, caret: number, stop: string[]) {
    if(txt.length === 0)               return undefined;
    if(stop.some(x => x.length !== 1)) return undefined;

    txt = txt.substring(0, caret);
    const tokens = txt.split(" ");
    return tokens.length - 1;
}

export function processMentions(txt: string) {

}

export function formatMentions(elm: Element) {
    if(elm instanceof HTMLSpanElement || elm instanceof HTMLAnchorElement) {
        var text = elm.innerHTML;
        const matches = Array.from(text.matchAll(/@[0-9]+/g))
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