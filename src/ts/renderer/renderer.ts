const { ipcRenderer, remote, shell, clipboard } = require("electron");
const { BrowserWindow, dialog } = remote;
const escapeHtml = require("escape-html");
const marked     = require("marked");

const path               = require("path");
const remark             = require("remark");
const gemojiToEmoji      = require("remark-gemoji-to-emoji");
const twemoji            = require("twemoji");
const fs                 = require("fs");
const qrcode             = require("qrcode");
const { highlightBlock } = require("highlight.js");
const blurhash           = require("blurhash");

import * as packets  from "../protocol.s/packets.s.js";
import * as entities from "../protocol.s/entities.s.js";
import * as types    from "../protocol.s/dataTypes.s.js";
import { configGet, configSet } from "./settings.js";

interface MessageSection {
    type:     types.MessageSectionType;
    blob?:    number;
    typeElm:  HTMLElement;
    text?:    string;
    elm:      HTMLElement;
}

// Cached entities and blobs
var entityCache: {} = {};
var filePaths: {} = {};

// Max between messages to minify them
const messageTimeThres: number = 300000;

// Kaomoji, yaaay!
const kaomoji: [string, string][] = [
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

function _rendererFunc() {
    // UI state
    var viewingGroup: number = 0, viewingChan: number = 0, viewingContactGroup: number = 0;
    var editingChan: number = 0,  editingRole: number = 0;
    var editingMessage: number = 0;
    var lastChanSender = {}; var lastChanMsg = {};
    var fetchingMsgs: boolean = false;

    // Short for "elementById"
    const elementById = (id: string) => document.getElementById(id);

    // Sections in the message we"re sending/editing
    var msgSections: MessageSection[] = [];
    // Operation finish callbacks
    var packetCallbacks = {}; var nextCbId = 0;
    
    // Sounds
    var sounds = {
        notification: undefined
    };

    // Regular expressions
    const emailRegex = /(?:[a-z0-9!#$%&"*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&"*+/=?^_`{|}~-]+)*|"(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*")@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/i;
    const allEmojiRegex = /^<span>\p{Emoji}{1,5}<\/span>$/gum;

    // Initialize libs
    const browserWindow = BrowserWindow.getFocusedWindow();
    //hljs.configure({ useBR: true });
    marked.setOptions({
        gfm: true,
        headerIds: false,
        silent: true,
        smartLists: true
    });
    
    // Load sounds
    //sounds.notification = new Audio(path.join(__dirname, "sounds/notification.wav"));

    // Try to connect every 2 seconds
    setInterval(() => ipcSend({
        action: "webprot.connect"
    }), 2000);

    // Upload and download blobs
    function upload(filePath: string, onEnd: (id: number) => any, onProgressMade?: (p: number, m: number) => any) {
        const file = new entities.File();
        file.id = 0; file.length = fs.statSync(filePath).size;
        file.path = filePath; file.name = path.basename(filePath);
        sendPacket(new packets.EntitiesPacket([file]), (resp: packets.EntitiesPacket) => {
           // There's only a single entity in the packet
           onEnd(resp.entities[0].id);
        }, onProgressMade);
    }
    function download(id: number, onEnd?: (path: string) => any) {
        if(id === undefined)
            throw new Error();
        // Files, like message states and unlike all other entities,
        // are immutable. This means that we can cache them heavily.
        // If a file (like an avatar, icon, etc.) changes, it actually doesn't.
        // A new file with a new ID is created.
        const existingPath = filePaths[id];
        if(existingPath !== undefined) {
            onEnd(existingPath);
            return;
        }
        sendPacket(new packets.FileDownloadRequestPacket(id), (r: packets.Packet) => {
            // Trust me, it's a string
            // IT'S A STRING
            // I KNOW FOR SURE IT'S A STRING
            // IT'S ALWAYS GOING TO BE A STRING
            const filePath = (r as unknown) as string;
            filePaths[id] = filePath;
            onEnd(filePath);
        });
    }

    // Determines whether we sould receive notifications
    function shouldReceiveNotif() {
        return (remote.getGlobal("webprotState").self.status !== 3) // no in "do not distract" mode
            && configGet("notifications");
    }

    // Adjusts the height of a TextArea
    function adjTaHeight(elm: HTMLTextAreaElement) { elm.rows = Math.min(elm.value.split(/\r\n|\r|\n/).length, 10) }

    // Shows and hide elements
    function showElm(element: HTMLElement) { element.style.display = ""; }
    function hideElm(element: HTMLElement) { element.style.display = "none"; }
    function setElmVisibility(elm: HTMLElement, vis: boolean) { if(vis) showElm(elm); else hideElm(elm); }
    function toggleElm(element: HTMLElement) {
        if(element.style.display == "none")
            showElm(element);
        else
            hideElm(element);
    }

    // Apply "appearing" or "disappearing" animations (optionally hiding and showing the parent element)
    function triggerAppear(element: HTMLElement, affectParent?: boolean) {
        if(affectParent)
            showElm(element.parentElement);

        element.classList.remove("disappearing");
        element.classList.add   ("appearing");
    }
    function triggerDisappear(element: HTMLElement, affectParent?: boolean) {
        if(affectParent) // 200 ms is the animation duration
            setTimeout(() => hideElm(element.parentElement), 200);

        element.classList.remove("appearing");
        element.classList.add   ("disappearing");
    }

    // Show and hide the user settings panel
    const userSettingsElm = elementById("user-settings");
    function showUserSettings() {
        // Reset to the profile tab
        showUserSettingsTab("user-settings-section-profile");
        triggerAppear(userSettingsElm, true);
    }
    function hideUserSettings() { triggerDisappear(userSettingsElm, true); }

    // Shows a particular user settings section
    function showUserSettingsTab(name: string) {
        // "Log out" is not really a tab
        if(name === "user-settings-section-logout") {
            hideElm(elementById("main-layout-container"));
            showElm(elementById("login-form"));

            // Clear the access token
            configSet("accessToken", "");
            ipcSend({ action: "webprot.force-connect" });
            return;
        }

        // Hide all sections
        var sections = document.getElementsByClassName("user-settings-section") as HTMLCollectionOf<HTMLElement>;
        for(var i = 0; i < sections.length; i++)
            hideElm(sections[i]);

        // Show the section we need
        showElm(elementById(name));
        (elementById(name + "-sel") as HTMLInputElement).checked = true;
    }

    // Creates an acronym for a group name
    function groupNameAcronym(name: string): string { return escapeHtml(name.split(" ").map(x => x.charAt(0)).join("")); }

    // Shows a channel in the group preferences panel
    function groupSettingsShowChannel(id: number) {
        editingChan = id;
        (elementById("channel-name-change") as HTMLInputElement).value = entityCache[id].name;
    }

    // Updates the channel list in the group preferences panel
    function updateGroupSettingsChannelList() {
        if(viewingGroup === 0)
            return;

        const channelList = elementById("group-settings-channel-list");
        const channels    = entityCache[viewingGroup].channels;
        reqEntities(channels.map(x => { return { type: "channel", id: x } }), false, () => {
            // Remove previous buttons
            while(channelList.firstChild)
                channelList.firstChild.remove();
            // Create buttons for each channel
            for(let chanId of channels) {
                const elm = createChannelButton(chanId, (e) => { groupSettingsShowChannel(chanId) }, false);
                channelList.append(elm);
            }
        })
    }

    // Shows a role in the group preferences panel
    function groupSettingsShowRole(id: number) {
        editingRole = id;

        reqEntities([new packets.EntityGetRequest(entities.Role.typeNum, id)], false, () => {
            const role = entityCache[id];
            (elementById("role-name-change") as HTMLInputElement).value = role.name;
    
            // Show or hide the removal button based on whether the role is @everyone
            const deleteBtn = elementById("role-remove-button");
            setElmVisibility(deleteBtn, role.priority !== 0);

            // Do the same with the name change field (enable/disable it though)
            const nameChange = elementById("role-name-change");
            if(role.priority === 0)
                nameChange.setAttribute("disabled", "");
            else
                nameChange.removeAttribute("disabled");

            const colorChange = elementById("role-color-change") as HTMLInputElement;
            colorChange.value = role.color;
        })
    }

    function updateGroupSettingsRoles() {
        if(viewingGroup === 0)
            return;

        const roleList = elementById("group-settings-role-list");
        const roles    = entityCache[viewingGroup].roles;
        // Force because the roles might have changed their priorities
        reqEntities(roles.map(x => { return { type: "role", id: x } }), true, () => {
            // Remove previous buttons
            while(roleList.firstChild)
                roleList.firstChild.remove();
            // Create buttons for each role (sorted by priority, descending)
            roles.sort((a, b) => entityCache[a].priority - entityCache[b].priority);
            roles.reverse();
            for(let roleId of roles) {
                const role = entityCache[roleId];

                const elm  = document.createElement("div");
                elm.classList.add("role-button");
                elm.innerHTML = escapeHtml(role.name);
                elm.onclick = (e) => { groupSettingsShowRole(roleId); }

                roleList.append(elm);
            }
        })
    }

    function updateGroupSettingsInvites() {
        if(viewingGroup === 0)
            return;

        const inviteList = elementById("group-settings-invite-list");
        var   invites = entityCache[viewingGroup].invites;

        while(inviteList.firstChild)
            inviteList.firstChild.remove();

        for(const inv of invites) {
            const elm = document.createElement("div")
            elm.classList.add("group-invite-entry", "flex-row");
            inviteList.appendChild(elm);

            const code = document.createElement("span");
            code.innerHTML = escapeHtml(inv);
            elm.appendChild(code);

            const remove = document.createElement("button");
            remove.classList.add("danger-button");
            remove.innerHTML = "REVOKE INVITE";
            remove.onclick = (e) => {
                invites = invites.filter(x => x != inv);
                const group = new entities.Group();
                group.id = viewingGroup; group.invites = invites;
                putEntities([group]);
            }
            elm.appendChild(remove);
        }
    }

    // Shows/hides group settings
    function showGroupSettings() {
        // Load group info
        const group = entityCache[viewingGroup];
        (elementById("group-name-change") as HTMLInputElement).value = escapeHtml(group.name);
        triggerAppear(elementById("group-settings"), true);

        showGroupSettingsTab("group-settings-section-general");
        groupSettingsShowChannel(entityCache[viewingGroup].channels[0]);
        // The earliest created role is @everyone, and it hast the smallest ID of them all
        groupSettingsShowRole(entityCache[viewingGroup].roles.sort((a, b) => a - b)[0]);

        if(group.icon !== 0) {
            download(group.icon, (b) => {
                (elementById("group-icon-huge") as HTMLImageElement).src = "file://" + b
            });
        }

        // Load settings
        try { // these might throw an exception if the user has no access to group settings
            updateGroupSettingsRoles();
            updateGroupSettingsChannelList();
            updateGroupSettingsInvites();
        }
        catch { }
    }
    function hideGroupSettings() {
        triggerDisappear(elementById("group-settings"), true)
    }
    function showGroupSettingsTab(name: string) {
        // "Delete group" is not really a tab
        if(name == "group-settings-section-delete") {
            hideGroupSettings();
            elementById("group-delete-name").innerHTML = escapeHtml(entityCache[viewingGroup].name);
            triggerAppear(elementById("group-delete-box"), true);
            return;
        }

        // Hide all sections
        var sections = document.getElementsByClassName("group-settings-section") as HTMLCollectionOf<HTMLElement>;
        for(const s of sections) hideElm(s);

        // Show the tab we need
        showElm(elementById(name));
        (elementById(name + "-sel") as HTMLInputElement).checked = true
    }

    // Show a floating box
    function showBox(header: string, text: string, showUpdate: boolean =false, updCb?:Function) {
        elementById("floating-box-header").innerHTML = header;
        elementById("floating-box-text").innerHTML = text;
        triggerAppear(elementById("floating-box"), true);

        elementById("floating-box-ok").addEventListener("click", (e) => {
            triggerDisappear(elementById("floating-box"), true);
        })

        const updButton = elementById("floating-box-upd") as HTMLButtonElement;
        updButton.onclick = (e) => updCb();
        setElmVisibility(updButton, showUpdate);
    }

    // Gets time difference in ms
    function timeDiff(id1: number, id2: number): number {
        if(id1 === undefined || id2 === undefined)
            return 0;
        const ts1 = Number((BigInt(id1) >> BigInt(16)));
        const ts2 = Number((BigInt(id2) >> BigInt(16)));
        return ts2 - ts1;
    }

    // Converts an ID into a time string
    function idToTime(id: number): string {
        const timestamp = (BigInt(id) >> BigInt(16)) + 1577836800000n;
        const date = new Date(Number(timestamp));
        return date.toLocaleDateString(undefined, {
            year:   "numeric",
            month:  "long",
            day:    "numeric",
            hour:   "numeric",
            minute: "numeric"
        });
    }

    // Sends a message to the main process
    function ipcSend(data: any) {
        if(data.action !== "webprot.connect")
            console.log("%c[R->M]", "color: #bbbb00; font-weight: bold;", data);
        ipcRenderer.send("asynchronous-message", data);
    }
    function sendPacket(p: packets.Packet, cb?: (r: packets.Packet) => any, additional_ref?: (...args: any[]) => any) {
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

    // Convert a status number to text or a path to status icon
    function statusStr(status: number): string {
        return ["offline", "online", "sleep", "dnd"][status];
    }
    function statusIconPath(status: number): string {
        return path.join(__dirname, "icons/" + statusStr(status) + ".png");
    }

    // Update info about self
    function updateSelfStatus(status: number) {
        // Update the icon in the user bar
        (elementById("self-status") as HTMLImageElement).src = statusIconPath(status);

        // Update the switch in the user settings
        (elementById("self-status-" + statusStr(status)) as HTMLInputElement).checked = true;

        // Update the explainer below the switch
        var explainer = [
            "Everyone will think you're offline, but you'll still have access to everything",
            "You will appear online",
            "Everyone will think you're away, but you'll still have access to everything",
            "You will not receive any notifications"
        ][status];
        elementById("self-status-explainer").innerHTML = explainer;
    }
    function updateSelfStatusText(statusText: string) {
        elementById("self-status-text").innerHTML = escapeHtml(statusText);
        (elementById("self-status-text-change") as HTMLInputElement).value = statusText;
    }
    function updateSelfName(name: string) {
        elementById("self-nickname").innerHTML = escapeHtml(name);
        (elementById("self-name-change") as HTMLInputElement).value = name;
    }
    function formatTag(tag: number): string {
        return "#" + String(tag).padStart(5, "0")
    }
    function updateSelfTag(tag: number) {
        elementById("self-tag").innerHTML = escapeHtml(formatTag(tag));
        elementById("self-tag-settings").innerHTML = escapeHtml(formatTag(tag));
    }
    function updateSelfEmail(email: string) {
        (elementById("self-email-change") as HTMLInputElement).value = email;
    }
    function updateSelfMfaStatus(mfaEnabled: boolean) {
        elementById("self-mfa-enable-status").innerHTML = mfaEnabled ? "ENABLED" : "DISABLED";
        elementById("self-mfa-toggle-button").innerHTML = (mfaEnabled ? "DISABLE" : "ENABLE") + " 2FA";
    }
    function updateSelfAva(path: string) {
        (elementById("self-avatar") as HTMLInputElement).src = "file://" + path;
        (elementById("self-avatar-huge") as HTMLInputElement).src = "file://" + path;
    }
    function updateSelfInfo(name: string, tag: number, status: number, statusText: string, email: string, mfaEnabled: boolean) {
        updateSelfName(name);
        updateSelfTag(tag);
        updateSelfStatus(status);
        updateSelfStatusText(statusText);
        updateSelfEmail(email);
        updateSelfMfaStatus(mfaEnabled);
    }

    // Change info about self
    function sendSelfValue(key: string, val: any) {
        const entity = new entities.User();
        entity.id = remote.getGlobal("webprotState").selfId;
        entity[key] = val;

        putEntities([entity]);
    }
    function setSelfStatus(status: number) {
        updateSelfStatus(status);
        sendSelfValue("status", status);
    }
    function setSelfStatusText(statusText: string) {
        updateSelfStatusText(statusText);
        sendSelfValue("statusText", statusText);
    }
    function setSelfName(name: string) {
        updateSelfName(name);
        sendSelfValue("name", name);
    }
    function setSelfEmail(email: string) {
        updateSelfEmail(email);
        sendSelfValue("email", email);
    }
    function setSelfMfaStatus(mfaStatus: boolean) {
        updateSelfMfaStatus(mfaStatus);
        remote.getGlobal("webprotState").self.mfaEnabled = mfaStatus;
        sendSelfValue("mfaEnabled", mfaStatus);
    }

    // Registers a callback
    function regCallback(cb: ((packet: packets.Packet) => any)|undefined): number|undefined {
        if(cb === undefined) return undefined;
        
        const id = nextCbId++;
        packetCallbacks[id] = cb;
        return id;
    }

    // Requests entities
    function reqEntities(ents: packets.EntityGetRequest[], force: boolean =false, cb?: (e?: entities.Entity[])=>any) {
        const remaining_ents = ents.filter(x => !(x.id in entityCache) || force);
        const triggerCb = (newEnts: entities.Entity[]) => {
            cb(ents.map(r => entityCache[r.id]));
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
    function putEntities(ents: entities.Entity[]) {
        sendPacket(new packets.EntitiesPacket(ents));
    }

    // Updates all information about a group
    function updateGroup(id: number, force: boolean=false) {
        reqEntities([new packets.EntityGetRequest(entities.Group.typeNum, id)], force, () => {
            const group = entityCache[id];
            // Update icons
            const icons = document.getElementsByClassName("group-icon-" + id) as HTMLCollectionOf<HTMLImageElement>;
            if(icons.length > 0 && group.icon !== 0) {
                download(group.icon, (blob) => {
                    for(const icon of icons)
                        icon.src = "file://" + blob;
                })
            } else if(group.icon === 0) {
                for(const icon of icons)
                    icon.innerHTML = escapeHtml(groupNameAcronym(group.name));
            }
    
            // Update the channel and member list
            if(id === viewingGroup) {
                updChannelList();
                updMemberList();
            }
    
            try {
                updateGroupSettingsChannelList();
                updateGroupSettingsInvites();
                updateGroupSettingsRoles();
            }
            catch { }
        });
    }

    // Updates all information about a user
    function updateUser(id: number) {
        reqEntities([new packets.EntityGetRequest(entities.User.typeNum, id)], false, () => {
            const user = entityCache[id];
            // Update avatars
            const avas = document.getElementsByClassName("user-avatar-" + id) as HTMLCollectionOf<HTMLImageElement>;
            if(avas.length > 0) {
                download(user.avaFile, (blob) => {
                    for(const ava of avas)
                        ava.src = "file://" + blob;
                })
            }
    
            // Update statuses
            const statuses = document.getElementsByClassName("user-online-" + id) as HTMLCollectionOf<HTMLImageElement>;
            for(const status of statuses)
                status.src = statusIconPath(user.status);
    
            // Reset the color if in DMs
            if(viewingGroup === 0)
                user.color = undefined;

            // Update nicknames and tags
            const nicknames = document.getElementsByClassName("user-nickname-" + id) as HTMLCollectionOf<HTMLElement>;
            const tags = document.getElementsByClassName("user-tag-" + id);
            for(const name of nicknames) {
                name.innerHTML = escapeHtml(user.name);
                // Set colors
                if(user.color !== undefined)
                    name.style.color = user.color;
                else
                    name.style.color = "unset";
            }
            for(const tag of tags)
                tag.innerHTML = escapeHtml(formatTag(user.tag));
    
            // Update status texts
            const statusTexts = document.getElementsByClassName("user-status-" + id);
            for(const st of statusTexts)
                st.innerHTML = escapeHtml(user.statusText)

            // Update "verified" badges
            if(user.badges.includes(1)) {
                const verifiedBadges = document.getElementsByClassName("verified-badge-" + id);
                for(const b of verifiedBadges)
                    b.classList.add("true");
            }
        });
    }

    // Creates an element that should be placed in the member list
    function createUserSummary(id: number, special?: string) {
        // Elements applied to all users
        var elm = document.createElement("div");
        elm.classList.add("user-summary", "user-summary-" + id);
    
        var avaContainer = document.createElement("div");
        avaContainer.classList.add("user-avatar-container");
        elm.appendChild(avaContainer);
    
        var ava = document.createElement("img");
        ava.classList.add("user-avatar", "user-avatar-" + id);
        avaContainer.appendChild(ava);
    
        var status = document.createElement("img");
        status.classList.add("user-online", "user-online-" + id);
        avaContainer.appendChild(status);
    
        var statusText = document.createElement("span");
        statusText.classList.add("user-status", "user-status-" + id);
        elm.appendChild(statusText);
    
        var nicknameContainer = document.createElement("div");
        nicknameContainer.classList.add("flex-row", "user-nickname-container");
        elm.appendChild(nicknameContainer);
    
        var verifiedBadge = document.createElement("img");
        verifiedBadge.classList.add("verified-badge", "verified-badge-" + id);
        verifiedBadge.src = path.join(__dirname, "icons/badges/verified.png");
        nicknameContainer.appendChild(verifiedBadge);
    
        var nickname = document.createElement("span");
        nickname.classList.add("user-nickname", "user-nickname-" + id);
        nicknameContainer.appendChild(nickname);
    
        var tag = document.createElement("span");
        tag.classList.add("user-tag", "user-tag-" + id);
        nicknameContainer.appendChild(tag);
    
        // Special users (friends, pending, blocked)
        if(special !== undefined) {
            var friendRemoveBtn = document.createElement("button");
            friendRemoveBtn.classList.add("hover-show-button");
            friendRemoveBtn.classList.add("icon-button");
            friendRemoveBtn.classList.add("friend-remove-button");
            friendRemoveBtn.addEventListener("click", (e) => {
                sendPacket(new packets.ContactsManagePacket({
                        "friend":      packets.ContactType.FRIEND,
                        "pending-in":  packets.ContactType.PENDING_IN,
                        "pending-out": packets.ContactType.PENDING_OUT,
                        "blocked":     packets.ContactType.BLOCKED,
                    }[special],
                    packets.ContactAction.REMOVE, id));
                stopPropagation(e);
            });
            elm.appendChild(friendRemoveBtn);
    
            var friendRemoveImg = document.createElement("img");
            friendRemoveImg.src = path.join(__dirname, "icons/friend_remove.png");
            friendRemoveBtn.appendChild(friendRemoveImg);
        }
        // Pending in users (add an accept button)
        if(special === "pending-in") {
            var friendAcceptBtn = document.createElement("button");
            friendAcceptBtn.classList.add("hover-show-button");
            friendAcceptBtn.classList.add("icon-button");
            friendAcceptBtn.classList.add("friend-accept-button");
            friendAcceptBtn.addEventListener("click", (e) => {
                sendPacket(new packets.ContactsManagePacket(packets.ContactType.FRIEND,
                    packets.ContactAction.ADD, id));
                stopPropagation(e);
            });
            elm.appendChild(friendAcceptBtn);
    
            var friendAcceptImg = document.createElement("img");
            friendAcceptImg.src = path.join(__dirname, "icons/approve.png");
            friendAcceptBtn.appendChild(friendAcceptImg);
        }
        if(special === "friend") {
            // Friends (open DMs when clicked)
            elm.onclick = (e) => {
                // Get the channel
                const channel = entityCache[id].dmChannel;
                reqEntities([new packets.EntityGetRequest(entities.Channel.typeNum, channel)], false, () => {
                    viewingChan = channel;
                    updLayout();
                });
            }
        } else {
            // All other people
            elm.onclick = (e) => showProfile(id);
        }
    
        return elm
    }

    // Updates the member list sidebar
    function updMemberList() {
        // Show or hide the friend hedaer
        const friendHeader = elementById("member-list-friend-header");
        const friendType   = elementById("member-list-friend-type");
        const groupHeader  = elementById("member-list-group-header");
        
        if(viewingGroup === 0) {
            showElm(friendHeader);
            showElm(friendType);
            hideElm(groupHeader);
        } else {
            hideElm(friendHeader);
            hideElm(friendType);
            showElm(groupHeader);
        }

        if(viewingGroup === 0) {
            const memberList = elementById("member-list-bar");

            // Remove all previous members
            while(memberList.firstChild)
                memberList.removeChild(memberList.firstChild);

            // Determine what users should end up in the member list
            let userIds = [];
            // Group 0 = own direct messages
            if(viewingGroup === 0) {
                const self = remote.getGlobal("webprotState").self;
                const friendType = elementById("member-list-friend-type");

                friendType.innerHTML = escapeHtml(
                    ["ALL FRIENDS",
                     "ONLINE FRIENDS",
                     "INCOMING REQUESTS",
                     "OUTGOING REQUESTS",
                     "BLOCKED"][viewingContactGroup]);

                userIds = [self.friends, self.friends, self.pendingIn, self.pendingOut, self.blocked][viewingContactGroup];
            }

            // Request users
            const users = userIds.map(id => new packets.EntityGetRequest(entities.User.typeNum, id));
            reqEntities(users, false, () => {
                // Create summaries for each one and append them to the member list
                userIds.forEach(id => {
                    if(viewingGroup === 0) { // special case for DMs
                        let add = true;
                        if(viewingContactGroup == 1 && entityCache[id].status === 0) // don"t add offline friends if we only want to see online ones
                            add = false;
                        if(add) {
                            memberList.appendChild(createUserSummary(
                                id, ["friend", "friend", "pending-in", "pending-out", "blocked"][viewingContactGroup]
                            ));
                            updateUser(id);
                        }
                    } else {
                        const elm = createUserSummary(id);
                        elm.style.animationDelay = (0.2 * userIds.indexOf(id) / userIds.length) + "s";
                        memberList.appendChild(elm);
                    }
                });
            });
        } else {
            appendMembersBottom(entityCache[viewingGroup].everyoneRole, 0, undefined, true);
        }
    }

    // Returns a human readable file size
    function readableFileSize(fileSize: number): string {
        if(fileSize < 1024)
            return fileSize + " B";
        else if(fileSize >= 1024 * 1024)
            return (fileSize / (1024 * 1024)).toFixed(2) + " MiB";
        else if(fileSize >= 1024)
            return (fileSize / 1024).toFixed(2) + " KiB";
    }

    // Sends the message
    function sendMessage() {
        var sects = msgSections;

        for(var i = 0; i < sects.length; i++) {
            const type = sects[i].type;

            // Abort if any of the files haven't been uploaded yet
            if(type === types.MessageSectionType.FILE && sects[i].blob === undefined)
                return;

            if(sects[i].typeElm === undefined)
                return;
            if([types.MessageSectionType.TEXT,
                types.MessageSectionType.CODE,
                types.MessageSectionType.QUOTE].indexOf(type) > -1)
                    sects[i].text = (sects[i].typeElm as HTMLTextAreaElement).value;

            if(sects[i].blob === undefined) sects[i].blob = 0;
            if(sects[i].text === undefined) sects[i].text = "";
        }

        for(var i = 0; i < sects.length; i++) {
            sects[i].elm = undefined;
            sects[i].typeElm = undefined;
        }

        // Reset the typing status and send the message
        setTimeout(() => {
            const state = new entities.MessageState();
            const msg = new entities.Message();
            state.id = 0;
            state.sections = sects;
            msg.id = editingMessage;
            msg.latest = state;
            msg.channel = viewingChan;
            putEntities([msg]);

            resetMsgInput();
            editingMessage = 0;
        }, 50);
    }

    // Sets up the message input field to edit a message
    function editMessage(id: number) {
        editingMessage = id;

        // Remove input sections
        resetMsgInput(true);

        // Create input sections
        for(const srcSect of entityCache[id].sections) {
            const sid = msgSections.length;
            createInputSection(srcSect.type, sid, () => removeInputSection(sid));
            
            const section = msgSections[sid];
            const type = section.type;
            section.text = srcSect.text;
            section.blob = srcSect.blob;

            if([types.MessageSectionType.TEXT,
                types.MessageSectionType.CODE,
                types.MessageSectionType.QUOTE].indexOf(type) > -1)
                    (section.typeElm as HTMLInputElement).value = section.text;
        }

        elementById("message-editing").innerHTML = escapeHtml("Editing message");
    }

    var typingClearTimer, currentlyTyping;
    function sendTyping() {
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
        chan.id = viewingChan; chan.typing = [0];
        putEntities([chan]);
        // Create a typing clear timer
        typingClearTimer = setTimeout(() => {
            clearTyping()
        }, 10000);
    }

    // Says "no, we"re not typing anymore"
    function clearTyping(additionalEntities?: entities.Entity[]) {
        currentlyTyping = false;
        clearTimeout(typingClearTimer);
        const chan = new entities.Channel();
        chan.id = viewingChan; chan.typing = [];
        putEntities([chan, ...(additionalEntities ?? [])]);
    }

    function updTyping(txt: string) {
        if(txt.length > 0)
            sendTyping();
        else
            clearTyping();
    }

    // Creates an input message section
    function createInputSection(type: types.MessageSectionType, id: number, removeCb: Function, filename?: string, fileSize?: number) {
        const section = document.createElement("div");
        section.classList.add("message-section", "message-section-" + type, "flex-row", "message-section-" + id);
        section.id = "message-section-" + id;

        const removeBtn = document.createElement("button");
        removeBtn.classList.add("icon-button", "cg-button");
        section.appendChild(removeBtn);
        removeBtn.addEventListener("click", (e) => removeCb());

        const removeImg = document.createElement("img");
        removeImg.src = path.join(__dirname, "icons/remove_section.png");
        removeBtn.appendChild(removeImg);

        var typeElm;

        switch(type) {
            case types.MessageSectionType.TEXT:
                typeElm = document.createElement("textarea");
                typeElm.classList.add("message-input", "fill-width");
                typeElm.placeholder = "Text section";
                typeElm.rows = 1;
                typeElm.oninput = () => { adjTaHeight(typeElm); updTyping(typeElm.value) };
                break
            case types.MessageSectionType.FILE:
                typeElm = document.createElement("div");
                typeElm.classList.add("message-file-section", "flex-col");

                const readableSize = readableFileSize(fileSize);

                const headerSpan = document.createElement("span");
                headerSpan.innerHTML = (readableSize === undefined) ? "File" : ("File (" + readableSize + "):");
                headerSpan.classList.add("message-file-header")
                typeElm.appendChild(headerSpan)

                if(filename !== undefined) {
                    const nameSpan = document.createElement("code");
                    nameSpan.innerHTML = escapeHtml(filename);
                    typeElm.appendChild(nameSpan);
    
                    const progress = document.createElement("progress");
                    progress.classList.add("fill-width");
                    typeElm.appendChild(progress);
                    progress.max = 100;
                    progress.value = 0;
                }
                break
            case types.MessageSectionType.CODE:
                typeElm = document.createElement("textarea");
                typeElm.classList.add("code-input", "fill-width");
                typeElm.placeholder = "Code section";
                typeElm.rows = 1;
                typeElm.oninput = () => { adjTaHeight(typeElm); updTyping(typeElm.value) };
                typeElm.spellcheck = false;
                break
            case types.MessageSectionType.QUOTE:
                typeElm = document.createElement("textarea");
                typeElm.classList.add("message-input", "fill-width", "message-quote-section");
                typeElm.placeholder = "Quote section";
                typeElm.rows = 1;
                typeElm.oninput = () => { adjTaHeight(typeElm); updTyping(typeElm.value) };
                break
        }
        section.appendChild(typeElm);

        // Append the section
        const container = elementById("message-input-container");
        container.insertBefore(section, container.lastChild);

        // Play an animation
        triggerAppear(section);
        
        section.onkeypress = (e) => {
            // Send the message when pressing enter, insert a line break on shift+enter
            if(e.keyCode === 13 && !e.shiftKey) {
                stopPropagation(e);
                sendMessage();
            }
        }

        msgSections.push({ type: type, typeElm: typeElm, elm: section });
    }

    // Removes an input message section
    function removeInputSection(id: number) {
        // Find the element
        const elm = elementById("message-section-" + id);
        // Remove it
        for(var i = 0; i < msgSections.length; i++) {
            if(msgSections[i].elm === elm) {
                msgSections.splice(i, 1);
                break;
            }
        }
        triggerDisappear(elm);
        setTimeout(() => elm.remove(), 200);

        // If there are no elements left, create an empty one
        if(msgSections.length === 0)
            resetMsgInput();
    }

    // Resets the message input field
    function resetMsgInput(fullReset: boolean =false) {
        const container = elementById("message-input-container")

        // Remove all sections
        for(var i = container.children.length - 1; i >= 0; i--) {
            const child = container.children[i];
            if(child.id != "message-section-add-btns")
                child.remove();
        }

        msgSections = [];

        if(!fullReset) {
            // Add a default section
            const id = msgSections.length;
            createInputSection(types.MessageSectionType.TEXT, id, () => {
                removeInputSection(id);
            });
    
            // Focus on it
            msgSections[id].typeElm.focus();
    
            const elm = msgSections[id].typeElm as HTMLTextAreaElement;
            setTimeout(() => elm.value = "", 1);
            setTimeout(() => adjTaHeight(elm), 1);
    
            elementById("message-editing").innerHTML = "";
        }
    }

    // Generates a summary text of the message
    function messageSummary(id: number): string {
        const msg = entityCache[id];
        var summary = "";
        for(const section of msg.latest.sections) {
            if(["text", "code"].indexOf(section.type) !== -1) {
                summary = section.text;
                break;
            }
            if(section.type === "quote") {
                summary = "Quote: " + section.text;
                break;
            }
            if(section.type === "file") {
                summary = "File";
                break;
            }
        }
        // If there"s still nothing
        if(summary === "")
            summary = "Empty message"

        return summary;
    }

    // Prepares message text (sanitizes it and inserts line breaks)
    function prepareMsgText(txt: string): string {
        return escapeHtml(txt).replace(/(?:\r\n|\r|\n)/g, "<br>")
    }
    function markupText(txt: string): string {
        var esc = remark.processSync(
            ("<span>" +
            marked.parseInline(                               // Markdown parser
            escapeHtml(txt)) +                                // no XSS for "ya today, sorry
            "</span>")   
            .replace(/(?:\r\n|\r|\n)/g, "</span><span>"))     // insert line breaks
            .contents

        // Add kaomoji
        esc = esc.toString();
        for(const kao of kaomoji) {
            if(kao !== undefined)
                esc = esc.replace(kao[0], kao[1]);
        }
        return esc;
    }

    // Shows/hides a floating message
    function showFloatingMessage(id: number) {
        const floatingMessage = elementById("floating-message")
        // Remove old junk
        while(floatingMessage.firstChild)
            floatingMessage.firstChild.remove();

        // Create the message
        const message = createMessage(id);
        message.style.margin = "0";
        floatingMessage.appendChild(message);
        updateRelatedUsers(id);

        triggerAppear(floatingMessage, true);
    }
    function hideFloatingMessage() {
        const floatingMessage = elementById("floating-message");
        triggerDisappear(floatingMessage, true);
    }

    // Shows/hides a profile
    function showProfile(id: number) {
        const user = entityCache[id];
        const profile  = elementById("profile");
        const nickname = elementById("profile-nickname").classList;
        const tag      = elementById("profile-tag").classList;
        const avatar   = elementById("profile-avatar").classList;
        const badges   = elementById("profile-badges");
        const groups   = elementById("profile-groups");
        const friends  = elementById("profile-friends");
        
        // Remove the old classes
        for(const c of nickname.values())
            if(c.startsWith("user-nickname-"))
                nickname.remove(c);
        for(const c of tag.values())
            if(c.startsWith("user-tag-"))
                tag.remove(c);
        for(const c of avatar.values())
            if(c.startsWith("user-avatar-") && c !== "user-avatar-huge")
                avatar.remove(c);
        // Add new classes so that updateUser() could pick up on them
        nickname.add("user-nickname-" + id);
        tag     .add("user-tag-"      + id);
        avatar  .add("user-avatar-"   + id);
        updateUser(id);

        // Remove old badges
        while(badges.firstChild)
            badges.firstChild.remove();
        // Add badges
        for(const bid of user.badges) {
            const file = path.join(__dirname, "icons", "badges", ["verified", "staff", "bot"][bid - 1] + ".png")
            const abbr = ["This user is who they claim to be",
                          "This user is a member of the core Order team",
                          "This user is a bot"][bid - 1]
            
            const abbrElm = document.createElement("abbr");
            abbrElm.title = escapeHtml(abbr);
            badges.appendChild(abbrElm);

            const iconElm = document.createElement("img");
            iconElm.src = "file://" + file;
            abbrElm.appendChild(iconElm);
        }

        // Remove old mutual servers/friends
        while(groups.firstChild)
            groups.firstChild.remove();
        while(friends.firstChild)
            friends.firstChild.remove();
        // Add mutual groups and friends
        for(const gid of user.groups) {
            const elm = document.createElement("div");
            elm.classList.add("mutual-thing");
            elm.innerHTML = escapeHtml(entityCache[gid].name);
            elm.onclick = (e) => {
                hideProfile();
                viewingGroup = gid;
                viewingChan = entityCache[gid].channels[0];
                updLayout();
            } 
            groups.appendChild(elm);
        }
        for(const fid of user.friends) {
            const elm = document.createElement("div");
            elm.classList.add("mutual-thing");
            elm.innerHTML = escapeHtml(entityCache[fid].name);
            elm.onclick = (e) => showProfile(fid);
            friends.appendChild(elm);
        }

        triggerAppear(profile, true);
    }
    function hideProfile() {
        const profile = elementById("profile");
        triggerDisappear(profile, true);
    }

    // Show/hides a floating image
    function showFloatingImage(id: number) {
        // Remove the old image
        const floatingImageBg = elementById("floating-image-bg");
        var floatingImage = elementById("floating-image");
        if(floatingImage)
            floatingImage.remove();

        // Create the image
        download(id, (blob) => {
            floatingImage = document.createElement("img");
            floatingImage.id = "floating-image";
            (floatingImage as HTMLImageElement).src = "file://" + blob;
            floatingImageBg.appendChild(floatingImage);
            triggerAppear(floatingImage, true);
        })
    }
    function hideFloatingImage() {
        const floatingImage = elementById("floating-image");
        if(floatingImage)
            triggerDisappear(floatingImage, true);
    }

    // Shows/hides the group create box
    function showGroupCreateBox() {
        const groupCreateBox = elementById("group-create-box");
        triggerAppear(groupCreateBox, true);
    }
    function hideGroupCreateBox() {
        const groupCreateBox = elementById("group-create-box");
        triggerDisappear(groupCreateBox, true);
    }

    // Parses URL hostname
    function parseHostname(url: string): string {
        var match = url.match(/:\/\/(www[0-9]?\.)?(.[^/:]+)/i)
        if (match != null && match.length > 2 && typeof match[2] === "string" && match[2].length > 0)
            return match[2];
        else
            return undefined;
    }

    // Parses a URL parameter
    function parseUrlParameter(url: string, param: string): string {
        url = url.split("?")[1];
        var urlVars = url.split("&");
    
        for (var i = 0; i < urlVars.length; i++) {
            var parName = urlVars[i].split("=");
            if (parName[0] === param)
                return parName[1];
        }
    }

    // Creates a message action bar
    function createMessageActionBar(id: number): HTMLDivElement {
        const bar = document.createElement("div");
        bar.classList.add("message-action-bar", "flex-row");

        // The set of all message action buttons
        const msg = new entities.Message();
        msg.id = id; msg.sender = 0;
        const buttons: {icon: string, selfOnly: boolean, onclick: (this: GlobalEventHandlers, ev: MouseEvent) => any}[] = [
            { icon: "reply", selfOnly: false, onclick: (e) => {
                const sectionId = msgSections.length
                createInputSection(types.MessageSectionType.QUOTE, sectionId, () => {
                    removeInputSection(sectionId);
                })
    
                msgSections[sectionId].blob = id;
    
                (msgSections[sectionId].typeElm as HTMLInputElement).value = messageSummary(id);
                adjTaHeight(msgSections[sectionId].typeElm as HTMLTextAreaElement);
            } },
            { icon: "delete", selfOnly: true, onclick: (e) => putEntities([msg]) },
            { icon: "edit",   selfOnly: true, onclick: (e) => editMessage(id) }
        ];

        for(const btnDesc of buttons) {
            // Don"t add "self-only" buttons to messages not sent by self
            const sentBySelf = entityCache[id].sender === remote.getGlobal("webprotState").self.id
            if((btnDesc.selfOnly && sentBySelf) || !btnDesc.selfOnly) {
                const btn = document.createElement("button");
                btn.classList.add("icon-button", "cg-button");
                btn.onclick = btnDesc.onclick;
                bar.appendChild(btn);

                const img = document.createElement("img");
                img.src = "icons/message_actions/" + btnDesc.icon + ".png";
                btn.appendChild(img);
            }
        }

        return bar;
    }

    // Calls updateUser() for every user related to the message
    function updateRelatedUsers(id: number, deep:number =5) {
        if(deep <= 0)
            return;

        const msg = entityCache[id];

        for(const section of msg.latest.sections)
            if(section.type === "quote" && section.blob !== 0)
                updateRelatedUsers(section.blob, deep - 1);

        updateUser(msg.sender);
    }

    // Creates a message box seen in the message area
    function createMessage(id: number, short: boolean =false): HTMLDivElement {
        // Get the message entity by the id
        const msg = entityCache[id] as entities.Message;

        const elm = document.createElement("div")
        elm.classList.add("message", "message-" + msg.id, "flex-row");
        if(short)
            elm.classList.add("short-message");

        if(!short) {
            const avaContainer = document.createElement("div");
            avaContainer.classList.add("message-avatar-container");
            elm.appendChild(avaContainer);
    
            const ava = document.createElement("img");
            ava.classList.add("user-avatar", "message-avatar", "user-avatar-" + msg.sender);
            avaContainer.appendChild(ava);
            ava.onclick = (e) => { stopPropagation(e); showProfile(msg.sender) };
        }

        const content = document.createElement("div");
        content.classList.add("message-content", "flex-col");
        elm.appendChild(content);

        if(!short) {
            var nicknameContainer = document.createElement("div");
            nicknameContainer.classList.add("flex-row");
            content.appendChild(nicknameContainer);

            var verifiedBadge = document.createElement("img");
            verifiedBadge.classList.add("verified-badge", "verified-badge-" + msg.sender);
            verifiedBadge.src = path.join(__dirname, "icons/badges/verified.png");
            nicknameContainer.appendChild(verifiedBadge);
    
            const nickname = document.createElement("span");
            nickname.classList.add("message-user-nickname", "user-nickname-" + msg.sender);
            nicknameContainer.appendChild(nickname);
    
            const timeElm = document.createElement("span");
            timeElm.classList.add("message-time");
            timeElm.innerHTML = escapeHtml(idToTime(id) + ((msg.states.length > 1) ? " (edited)" : ""));
            nicknameContainer.appendChild(timeElm);
        }

        for(const section of msg.latest.sections) {
            var sectionElement = null;
            switch(section.type) {
                case types.MessageSectionType.TEXT:
                    // Just plain text
                    sectionElement = document.createElement("div");
                    sectionElement.classList.add("message-text-section");
                    const text = markupText(section.text);
                    sectionElement.innerHTML = text;
                    twemoji.parse(sectionElement, { folder: "svg", ext: ".svg" });
                    // If the text cosists of emojis only, increase their size
                    //console.log(text, allEmojiRegex.test(text), text.match(allEmojiRegex))
                    if(allEmojiRegex.test(text)) {
                        const emojis = sectionElement.getElementsByTagName("img");
                        for(const emoji of emojis)
                            emoji.classList.add("large-emoji");
                    }
                    break
                case types.MessageSectionType.CODE:
                    // A code box with highlighting and a copy button
                    sectionElement = document.createElement("pre");
                    sectionElement.classList.add("message-code-section");
                    sectionElement.innerHTML = prepareMsgText(section.text);
                    highlightBlock(sectionElement);

                    const copyButton = document.createElement("button");
                    copyButton.classList.add("icon-button");
                    content.appendChild(copyButton);

                    copyButton.onclick = (e) => {
                        e.stopPropagation();
                        clipboard.writeText(section.text);
                    }

                    const copyImg = document.createElement("img");
                    copyImg.src = path.join(__dirname, "icons/copy.png");
                    copyButton.appendChild(copyImg);

                    break;
                case types.MessageSectionType.FILE:
                    const fileSectionElement = document.createElement("div"); // a temporary replacement
                    content.appendChild(fileSectionElement);
                    reqEntities([new packets.EntityGetRequest(entities.File.typeNum, section.blob)], false,
                            (files) => {
                        const file = files[0] as entities.File;
                        // Check if it"s an image
                        const extenstion = file.name.split(".").pop();
                        if(["png", "jpeg", "jpg", "gif", "bmp"].includes(extenstion)) {
                            const w = Number(file.size.split("x")[0]);
                            const h = Number(file.size.split("x")[1]);
                            fileSectionElement.classList.add("message-img-section-container");

                            const fake = document.createElement("img"); // to force container dimensions
                            fileSectionElement.appendChild(fake);
                            fake.classList.add("message-img-section-fake");
                            fake.width = w; fake.height = h;
                            
                            // Create the preview element
                            let canvasElement: HTMLCanvasElement;
                            let imgElement = document.createElement("img");
                            imgElement.classList.add("message-img-section");
                            fileSectionElement.appendChild(imgElement);
                            if(file.preview !== "") {
                                canvasElement = document.createElement("canvas");
                                canvasElement.classList.add("message-img-section");
                                canvasElement.width  = w;
                                canvasElement.height = h;
    
                                const adjW = Number((32 * w / h).toFixed(0)); // to preserve the aspect ratio
                                const pixels = blurhash.decode(file.preview, adjW, 32);
                                const ctx = canvasElement.getContext("2d");
                                const imageData = ctx.createImageData(adjW, 32);
                                imageData.data.set(pixels);
                                ctx.putImageData(imageData, 0, 0);
                                // Scale it (blurhash decoding is too slow, scaling is faster)
                                const imageObj = new Image(adjW, 32);
                                imageObj.onload = () => {
                                    ctx.clearRect(0, 0, w, h);
                                    ctx.scale(w / adjW, h / 32);
                                    ctx.drawImage(imageObj, 0, 0);
                                }
                                fake.src = canvasElement.toDataURL();
                                imageObj.src = canvasElement.toDataURL();
    
                                fileSectionElement.appendChild(canvasElement);
                            }

                            // Download the image
                            download(section.blob, (blob) => {
                                imgElement.src = "file://" + blob;
                                fileSectionElement.appendChild(imgElement);
                                // Deblur the preview element
                                if(canvasElement)
                                    canvasElement.classList.add("deblur");
                                // Enlarge the image when clicking on it
                                fileSectionElement.onclick = (e) => {
                                    stopPropagation(e);
                                    showFloatingImage(section.blob);
                                }
                            });
                        } else {
                            fileSectionElement.classList.add("message-file-section", "flex-row");

                            const info = document.createElement("div");
                            info.classList.add("file-section-info", "flex-col");
                            fileSectionElement.appendChild(info);

                            const sizeElm = document.createElement("div");
                            sizeElm.classList.add("message-file-header");
                            sizeElm.innerHTML = "File (" + readableFileSize(file.length) + ")";
                            info.appendChild(sizeElm);

                            const nameElm = document.createElement("code");
                            nameElm.classList.add("file-section-name");
                            nameElm.innerHTML = escapeHtml(file.name);
                            info.appendChild(nameElm);

                            const dlBtn = document.createElement("button");
                            dlBtn.classList.add("icon-button", "file-dl-button");
                            fileSectionElement.appendChild(dlBtn);

                            // Download the file
                            dlBtn.onclick = (e) => {
                                e.stopPropagation()
                                // Ask where to save it
                                var filePath = dialog.showSaveDialogSync(browserWindow, {
                                    properties: [ "showOverwriteConfirmation", "createDirectory" ],
                                    defaultPath: "~/" + file.name
                                });
                                // Don"t continue if the user decided not to
                                if(filePath == undefined)
                                    return;

                                // Download the file
                                download(section.blob, (blob) => fs.copyFileSync(blob, filePath));
                            }

                            const dlBtnIcon = document.createElement("img");
                            dlBtnIcon.src = path.join(__dirname, "icons/download.png");
                            dlBtn.appendChild(dlBtnIcon);
                        }
                    })
                    break;
                case types.MessageSectionType.QUOTE:
                    // Just plain text
                    sectionElement = document.createElement("div");
                    sectionElement.classList.add("message-quote-section");

                    const txt = document.createElement("div");
                    txt.innerHTML = markupText(section.text);
                    twemoji.parse(txt, { folder: "svg", ext: ".svg" });
                    sectionElement.appendChild(txt);

                    // If "blob" ID (actually message ID in this case) != 0 then show the message when clicking on it
                    // and also add the "*nickname* said on *time*:" thingy
                    if(section.blob !== 0) {
                        sectionElement.addEventListener("click", (e) => {
                            e.stopImmediatePropagation();
                            showFloatingMessage(section.blob);
                        })
                        reqEntities([new packets.EntityGetRequest(entities.Message.typeNum, section.blob)], false, () => {
                            const replyMsg = entityCache[section.blob];
                            reqEntities([new packets.EntityGetRequest(entities.User.typeNum, replyMsg.sender)], false, () => {
                                const replyAvaContainer = document.createElement("div");
                                replyAvaContainer.classList.add("reply-avatar-container", "flex-row");
                                sectionElement.insertBefore(replyAvaContainer, txt);
                        
                                const replyAva = document.createElement("img");
                                replyAva.classList.add("user-avatar", "tiny-avatar", "user-avatar-" + replyMsg.sender);
                                replyAvaContainer.appendChild(replyAva);
                                replyAva.onclick = (e) => { stopPropagation(e); showProfile(replyMsg.sender) };
    
                                const replyNickname = document.createElement("span");
                                replyNickname.classList.add("message-user-nickname", "user-nickname-" + replyMsg.sender);
                                replyAvaContainer.appendChild(replyNickname);
    
                                const replySaid = document.createElement("span");
                                replySaid.classList.add("message-time");
                                replySaid.innerHTML = escapeHtml("said on " + idToTime(replyMsg.id) + ":");
                                replyAvaContainer.appendChild(replySaid);
                            });
                        });
                    }
                    break
            }
            if(sectionElement != null)
                content.appendChild(sectionElement);
        }

        // Edit on double-click
        elm.ondblclick = () => { if(msg.sender === remote.getGlobal("webprotState").self.id) editMessage(id) };

        // When clicking a link, open it in the user"s browser
        const links = elm.getElementsByTagName("a");
        for(const link of links) {
            const href = link.href;
            link.removeAttribute("href");
            link.onclick = (e) => {
                e.stopPropagation();
                shell.openExternal(href);
            }
            // Additionally, if the link is a YouTube video, add an iframe
            const hostname = parseHostname(href);
            if((hostname === "youtube.com" || hostname === "youtu.be")
                && configGet("previewYt")) {
                // Get the video ID
                let videoId = "";
                if(hostname == "youtube.com")
                    videoId = escapeHtml(parseUrlParameter(href, "v"));
                else if(hostname == "youtu.be")
                    videoId = href.split("/")[href.split("/").length - 1];
                
                // Add an iframe
                const iframe = document.createElement("iframe");
                iframe.width = String(400);
                iframe.height = String(225);
                iframe.allow = "clipboard-write; encrypted-media; picture-in-picture; fullscreen";
                iframe.src = "https://www.youtube.com/embed/" + videoId
                content.appendChild(iframe)
            }
        }

        // Add the action bar
        elm.appendChild(createMessageActionBar(id));

        return elm;
    }

    // Fetches and appends members to the bottom
    function appendMembersBottom(role: number, id_from: number, callback?: () => void, clear: boolean =false) {
        const memberList = elementById("member-list-bar")
        
        reqEntities([new packets.EntityGetRequest(entities.Role.typeNum, role,
                new packets.EntityPagination(6 /* members */,
                    packets.EntityPaginationDirection.DOWN, id_from, 50))], true, () => {
            var members = [...entityCache[role].members];
            members.sort();
            members = members.map(x => { return { type: "user", id: x } });
            // Request members
            reqEntities(members, false, () => {
                // Clear previous members if needed
                if(clear) {
                    while(memberList.firstChild)
                        memberList.firstChild.remove();
                }
                members = members.map(x => entityCache[x.id]);
                members.forEach(member => {
                    const id = member.id;
                    const elm = createUserSummary(id);

                    elm.style.animationDelay = (0.2 * members.indexOf(member) / members.length) + "s";
                    memberList.appendChild(elm);
                    // Force user color (no need to request it since we know it from the role already)
                    entityCache[id].color = entityCache[role].color;
                    updateUser(id);
                })

                // Call the callback
                if(callback !== undefined)
                    callback();
            })
        })
    }

    // Fetches and appends messages to the top
    function appendMsgsTop(id_from: number, callback?: () => void, clear: boolean =false) {
        fetchingMsgs = true;
        const msgArea = elementById("message-area");
        const header = elementById("message-area-header");
        
        reqEntities([new packets.EntityGetRequest(entities.Channel.typeNum, viewingChan,
                new packets.EntityPagination(4 /* messages */,
                    packets.EntityPaginationDirection.DOWN, id_from, 50))], true, () => {
            var msgs = [...entityCache[viewingChan].messages];
            msgs.sort();
            msgs = msgs.map(x => new packets.EntityGetRequest(entities.Message.typeNum, x));
            // Request messages
            reqEntities(msgs, false, () => {
                // Clear previous messages if needed
                if(clear) {
                    for(var i = msgArea.children.length - 1; i >= 0; i--) {
                        const child = msgArea.children[i];
                        if(child.id != "message-area-header")
                            child.remove();
                    }
                }

                msgs.reverse();
                msgs = msgs.map(x => entityCache[x.id]);
                msgs.forEach(msg => {
                    const id = msg.id;
                    const lastMsg = msgs[msgs.indexOf(msg) + 1];
                    const short = lastMsg ? (msg.sender === lastMsg.sender && timeDiff(lastMsg.id, msg.id) <= messageTimeThres) : false;
                    header.after(createMessage(id, short)); // bundling
                    updateRelatedUsers(id);
                })

                if(msgs.length > 0) {
                    lastChanSender[viewingChan] = msgs[0].sender;
                    lastChanMsg   [viewingChan] = msgs[0].id;
                }

                // Request senders (uncached, because they might have different colors in different groups)
                if(viewingGroup !== 0) {
                    let senders = msgs.map(x => new packets.EntityGetRequest(entities.User.typeNum, x.sender,
                        undefined, new packets.EntityContext(entities.Group.typeNum, viewingGroup)))

                    // Only request those cached from a different group
                    senders = senders.filter(x => entityCache[x.id] === undefined || entityCache[x.id].ctxGroup !== viewingGroup);
                    senders = senders.filter((x, i, s) => s.findIndex(y => y.id === x.id) === i);
                    if(senders.length > 0) {
                        reqEntities(senders, true, () => {
                            senders.forEach(x => entityCache[x.id].ctxGroup = viewingGroup)
                        });
                    }
                }

                // Scroll to the bottom
                msgArea.scrollTop = msgArea.scrollHeight;

                // Call the callback
                if(callback !== undefined)
                    callback();
            })
        })
    }

    // Updates the message area
    function updMessageArea(updMessages: boolean =true) {
        // Hide the panel list if we're viewing messages
        setElmVisibility(elementById("message-container-area"), viewingChan !== 0);

        if(viewingChan === 0) {
            const msgArea = elementById("message-area");
            for(var i = msgArea.children.length - 1; i >= 0; i--) {
                const child = msgArea.children[i];
                if(child.id != "message-area-header")
                    child.remove();
            }
            return;
        }

        // Get channel messages
        if(viewingChan !== 0 && updMessages)
            appendMsgsTop(0xFFFFFFFFFFFFF, undefined, true);

        reqEntities([new packets.EntityGetRequest(entities.Channel.typeNum, viewingChan)], false, () => {
            const channel = entityCache[viewingChan];
            // Show the list of people that are typing
            const typingElm  = elementById("channel-typing");
            const typingAnim = elementById("typing-dots");
            const typing = channel.typing.filter(x => x !== remote.getGlobal("webprotState").self.id);
            reqEntities(typing.map(x => new packets.EntityGetRequest(entities.User.typeNum, x)), false, () => {
                var content = "";
                const verb = (typing.length === 1) ? "is" : "are";
                if(typing.length > 0) {
                    content = "<b>" + typing.map(x => escapeHtml(entityCache[x].name)).join("</b>, <b>") + "</b> " + verb + " typing";
                    showElm(typingAnim);
                } else
                    hideElm(typingAnim);
                typingElm.innerHTML = content;
            })
        })
    }

    // Creates a group panel
    function createGroupPanel(id: number) {
        const group = entityCache[id] as entities.Group;
        const panel = document.createElement("div");

        const top = document.createElement("div");
        const icon = document.createElement("img"); top.appendChild(icon);
        download(group.icon, (s) => icon.src = "file://" + s);
        const nameUnread = document.createElement("div"); top.appendChild(nameUnread);

        const name = document.createElement("span"); nameUnread.appendChild(name);
        name.innerHTML = escapeHtml(group.name);
        const unread = document.createElement("span"); nameUnread.appendChild(unread);

        // Fetch the channels to determine how many messages are unread
        reqEntities(group.channels.map(x => new packets.EntityGetRequest(entities.Channel.typeNum, x)), false, (e) => {
            var unreadMsgs = 0, unreadChans: {t: string, u: number}[];
            for(const c of e) {
                const chan = c as entities.Channel;
                unreadMsgs += chan.unread;
                if(chan.unread > 0)
                    unreadChans.push({
                        t: chan.name,
                        u: chan.unread
                    });
            }

            unread.innerHTML = `<img src="icons/message.png"/> ${escapeHtml(unreadMsgs)} NEW` + 
                               `<img src="icons/channel.png"/> ${unreadChans.length}</span>`

            // Create the bottom panel
            if(unreadChans.length === 0)
                return;

            const bottom = document.createElement("div"); panel.appendChild(bottom);
            var i; // to reference the leftover channel count later
            unreadChans = unreadChans.sort((a, b) => b.u - a.u); // reverse sort by unread count (most uptop)
            for(i = 0; i < Math.min(3, unreadChans.length); i++) {
                const desc = unreadChans[i];
                const chan = document.createElement("div"); bottom.appendChild(chan);
                chan.classList.add("gp-channel");
                chan.innerHTML = `<img src="icons/channel.png"/>${escapeHtml(desc.t)} • ${escapeHtml(desc.u)}`;
            }

            const left = unreadChans.length - i;
            const more = document.createElement("div"); bottom.appendChild(more);
            more.classList.add("gp-channel", "more");
            more.innerHTML = `<img src="icons/channel.png"/>${escapeHtml(left)} MORE`;
        });

        return panel;
    }

    // Updates the group list
    function updGroupList() {
        const groupPanels = elementById("group-panel-area");

        // Hide the panel list if we're viewing messages
        setElmVisibility(groupPanels, viewingChan === 0);

        // Request the groups the user's in
        const groups = remote.getGlobal("webprotState").self.groups;
        reqEntities(groups.map(x => new packets.EntityGetRequest(entities.Group.typeNum, x)), false, () => {
            // Delete old panels except for the "create" one
            for(var i = groupPanels.children.length - 1; i >= 0; i--) {
                const child = groupPanels.children[i];
                if(!child.classList.contains("group-action-panel"))
                    child.remove();
            }
            // Add new ones
            for(const groupId of groups)
                groupPanels.append(createGroupPanel(groupId));
        })
    }

    function createChannelButton(id: number, clickCb:
            (this: GlobalEventHandlers, ev: MouseEvent) => any, highlightSelected: boolean =true): HTMLDivElement {
        const channel = entityCache[id];

        const elm = document.createElement("div");
        elm.classList.add("channel-button");
        if(viewingChan === id && highlightSelected)
            elm.classList.add("channel-button-selected");
            
        elm.innerHTML = escapeHtml(channel.name);
        elm.onclick = clickCb;

        return elm;
    }

    // Updates the channel list
    function updChannelList() {
        // Show or hide the channel list
        const channelListSidebar = elementById("channel-list-sidebar");
        setElmVisibility(channelListSidebar, viewingGroup !== 0);

        if(viewingGroup === 0)
            return;

        const channelList = elementById("channel-list");
        const groupName = elementById("group-name");

        // Show the server name
        groupName.innerHTML = escapeHtml(entityCache[viewingGroup].name);

        // Request the channels of the group the user is viewing
        const channels = entityCache[viewingGroup].channels;
        reqEntities(channels.map(x => { return { type: "channel", id: x } }), false, () => {
            // Delete old icons
            while(channelList.firstChild)
                channelList.firstChild.remove();
            // Add new ones
            for(let chanId of channels) {
                const elm = createChannelButton(chanId, (e) => { viewingChan = chanId; updLayout() })
                elm.style.animationDelay = (0.2 * channels.indexOf(chanId) / channels.length) + "s";
                channelList.append(elm);

                if(entityCache[chanId].rules) {
                    const rulesBtn = document.createElement("button");
                    rulesBtn.classList.add("apply-button", "rules-accept-button");
                    rulesBtn.innerHTML = "Accept group rules";
                    channelList.append(rulesBtn);
                }
            }
        });
    }

    // Updates the layout: member list, messages, etc.
    function updLayout() {
        console.log("Updating layout, gId=" + viewingGroup + ", cId=" + viewingChan + ", cgId=" + viewingContactGroup);

        updMemberList();
        updChannelList();
        updMessageArea();
        updGroupList();
    }

    // Appends a message to the message area
    function appendMessage(id: number) {
        const msgArea = elementById("message-area");
        const msgScrollArea = elementById("message-scroll-area");

        // Check if scrolled all the way down
        const scrolled = msgScrollArea.scrollTop - (msgScrollArea.scrollHeight - msgScrollArea.offsetHeight) <= 100;

        // Create the message
        const msg = entityCache[id];
        const msgElm = createMessage(id, msg.sender === lastChanSender[msg.channel] && timeDiff(lastChanMsg[msg.channel].id, msg.id) <= messageTimeThres);
        msgArea.appendChild(msgElm);
        updateRelatedUsers(msg.id);

        lastChanSender[msg.channel] = msg.sender;
        lastChanMsg   [msg.channel] = msg.id;

        // Scroll down again if it was like that before
        if(scrolled) {
            //msgScrollArea.scrollBy({ top: -msgElm.offsetHeight, left: 0 });
            msgElm.scrollIntoView({ block: "end", behavior: "smooth" });
        }
    }

    // Deletes a message
    function removeMesssage(id: number) {
        const msgs = document.getElementsByClassName("message-" + id);
        for(const msg of msgs)
            msg.remove();
    }

    // Edits a message
    function editExistingMesssage(id: number): boolean {
        const msgs = document.getElementsByClassName("message-" + id);
        for(const msg of msgs) {
            const newMsg = createMessage(id, msg.classList.contains("short-message"));
            msg.replaceWith(newMsg);
            updateRelatedUsers(id);
        }
        return msgs.length !== 0;
    }
    
    // Packet handler
    function onPacket(packet: packets.Packet, reference?: number) {
        console.log("%c[RECEIVED]", "color: #bb0000; font-weight: bold;", packet);

        if(packet instanceof packets.StatusPacket) {
            const code = packet.status;
            switch(code) {
                case packets.StatusCode.MFA_REQUIRED:
                    hideElm(elementById("login-form"));
                    showElm(elementById("mfa-form"));
    
                    elementById("mfa-login-button").addEventListener("click", (e) => {
                        ipcSend({
                            action:   "webprot.login",
                            email:    "___@mfa@token@___",
                            password: (elementById("login-mfa-code") as HTMLInputElement).value
                        });
                    });
                    break;

                case packets.StatusCode.LOGIN_ERROR:
                    showBox("LOGIN ERROR", packet.message);
                    (elementById("login-password") as HTMLInputElement).value = "";
                    break;

                case packets.StatusCode.SIGNUP_ERROR:
                    showBox("SIGNUP ERROR", packet.message);
                    (elementById("signup-password") as HTMLInputElement).value = "";
                    break;

                case packets.StatusCode.OUTDATED:
                    showBox("OUTDATED CLIENT", packet.message, true, () => {
                        shell.openExternal("https://ordermsg.tk/download")
                    });
                    break;

                case packets.StatusCode.RATE_LIMITING:
                    showBox("RATE LIMITING", packet.message);
                    break;
                case packets.StatusCode.INVALID_USERNAME:
                    showBox("INVALID USERNAME", packet.message);
                    break;
                case packets.StatusCode.INVALID_INVITE:
                    showBox("INVALID INVITE", packet.message);
                    break;
                case packets.StatusCode.INTERNAL_ERROR:
                    showBox("INTERNAL ERROR", packet.message);
                    break;
                case packets.StatusCode.FRIEND_REQUEST_SENT:
                    showBox("FRIEND REQUEST SENT", packet.message);
                    break;
            }
        } else if(packet instanceof packets.ClientIdentityPacket) { // Logged in successfully
            // Save our ID
            remote.getGlobal("webprotState").selfId = packet.userId;
            remote.getGlobal("webprotState").sendPings = true;

            // Show the main UI
            hideElm(elementById("login-form"));
            hideElm(elementById("mfa-form"));
            hideElm(elementById("signup-form"));
            showElm(elementById("main-layout-container"));

            // Clear input fields
            (elementById("login-email")     as HTMLInputElement).value = "";
            (elementById("login-password")  as HTMLInputElement).value = "";
            (elementById("login-mfa-code")  as HTMLInputElement).value = "";
            (elementById("signup-username") as HTMLInputElement).value = "";
            (elementById("signup-email")    as HTMLInputElement).value = "";
            (elementById("signup-password") as HTMLInputElement).value = "";

            // Reset all caches
            entityCache = {};
            packetCallbacks = {};
            nextCbId = 0;

            // Reset the view
            viewingGroup = 0;
            viewingChan = 0;
            viewingContactGroup = 0;
            resetMsgInput();

            // Request the user
            reqEntities([new packets.EntityGetRequest(entities.User.typeNum, packet.userId)], true, () => {
                const self = entityCache[packet.userId];
                console.log("Got client user:", self);
                remote.getGlobal("webprotState").self = self;

                updMessageArea();
            })
        } else if(packet instanceof packets.AccessTokenPacket) {
            configSet("accessToken", packet.token);
            sendPacket(new packets.AccessTokenPacket(packet.token)); // Try to login immediately
        } else if(packet instanceof packets.EntitiesPacket) {
            for(var entity of packet.entities) {
                // Shove the entity into the cache
                // And merge the new fields with the old ones
                const oldEntity = entityCache[entity.id];
                if(oldEntity !== undefined)
                    entity = Object.assign(oldEntity, entity);
                entityCache[entity.id] = entity;

                // Append messages to the open channel
                if(packet.spontaneous && entity instanceof entities.Message && entity.channel === viewingChan)
                    appendMessage(entity.id);

                if(packet.spontaneous && entity instanceof entities.Channel && entity.id === viewingChan)
                    updMessageArea(false);

                // Update info about self
                else if(entity instanceof entities.User && entity.id === remote.getGlobal("webprotState").selfId) {
                    remote.getGlobal("webprotState").self = entity;
                    updateSelfInfo(entity.name, entity.tag, entity.status, entity.statusText, entity.email, entity.mfaEnabled);

                    setElmVisibility(elementById("email-unconfirmed-bar-container"), !entity.emailConfirmed);

                    // Request own avatar
                    download(entity.avaFile, (blob) => {
                        updateSelfAva(blob);
                    });

                    // Update DM, friend and group list
                    updGroupList();
                    if(viewingGroup === 0) {
                        updMemberList();
                        updChannelList();
                    }

                    // Check new friend requests
                    const pin = entity.pendingIn;
                    elementById("pending-in-count").innerHTML = escapeHtml(pin.length);
                    setElmVisibility(elementById("pin-cnt-container"), pin.length > 0);
                    if(packet.spontaneous && oldEntity.pendingIn.length !== entity.pendingIn.length
                        && shouldReceiveNotif()) {
                        const newFriends = entity.pendingIn.filter(x => !oldEntity.pendingIn.includes(x));
                        // Request their entities
                        reqEntities(newFriends.map(x => new packets.EntityGetRequest(entities.User.typeNum, x)), false, () => {
                            for(const fid of newFriends) {
                                const f = entityCache[fid];
                                // Download avatars of each one
                                download(f.avaFile, (ava) => {
                                    const notification = new Notification(
                                        f.name + " wants to add you as a friend", {
                                        icon: ava
                                    });
                                });
                            }
                        });
                    }

                    // Update the owned bot list
                    if(entity.ownedBots !== undefined)
                        elementById("owned-bot-list").innerHTML = entity.ownedBots.join(", ");
                }

                // Update info about other users
                if(entity instanceof entities.User)
                    updateUser(entity.id);
            }
        }

        // Call the callback
        if(reference !== undefined) {
            const cb = packetCallbacks[reference];
            cb(packet);
            delete packetCallbacks[reference];
        }
    }

    // Main process handler
    function ipcRecv(evt: Event, arg: any) {
        if(["webprot.status", "webprot.trigger-reference",
            "webprot.packet-recv", "webprot.connected", "webprot.connecting", "webprot.disconnected"]
                .indexOf(arg.type) === -1)
            console.log("%c[M->R]", "color: #bb00bb; font-weight: bold;", arg);
        switch(arg.type) {
            case "webprot.status":
                console.log("%c[STATUS]", "color: #6440a5; font-weight: bold;", arg.message);
                break;

            case "webprot.connecting":
                showElm(elementById("connecting-screen-bg"));
                break;
            case "webprot.connected":
                setTimeout(() => hideElm(elementById("connecting-screen-bg")), 1000); // kinda wait \(-_-)/
                // Send the continuation token
                const accessToken = configGet("accessToken");
                if(accessToken) sendPacket(new packets.AccessTokenPacket(accessToken));
                break;
            case "webprot.disconnected":
                break;

            case "webprot.packet-recv":
                // "restore" the packet because of RPC...
                const proto = {
                    "StatusPacket":         new packets.StatusPacket(),
                    "AccessTokenPacket":    new packets.AccessTokenPacket(),
                    "ClientIdentityPacket": new packets.ClientIdentityPacket(),
                    "EntitiesPacket":       new packets.EntitiesPacket(),
                }[arg.pType];
                const packet = Object.assign(proto, arg.packet);
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

                onPacket(packet, arg.reference);
                break;

            case "webprot.trigger-reference":
                console.log("%c[REFERENCE]", "color: #bb0077; font-weight: bold;", arg);
                const cb = packetCallbacks[arg.reference];
                cb(...arg.args);
                break;

            case "webprot.entities":
                arg.entities.forEach((entity) => {
                    // Add entities to the entity list
                    const oldEntity = entityCache[entity.id];
                    entityCache[entity.id] = { ...entityCache[entity.id], ...entity };

                    // Delete messages
                    if(arg.spontaneous && entity.type === "message" && entity.sender === 0)
                        removeMesssage(entity.id);

                    // Edit messages
                    else if(arg.spontaneous && entity.type === "message" && entity.edited)
                        editExistingMesssage(entity.id);

                    // Send message notifications
                    if(arg.spontaneous && entity.type === "message" && entity.sender !== 0 &&
                        (entity.channel !== viewingChan ||  // either we"re sitting in another channel
                         !document.hasFocus())              // or the window is out of focus
                         && shouldReceiveNotif()) {         // (notifications must be enabled)
                        reqEntities([new packets.EntityGetRequest(entities.User.typeNum, entity.sender)], false, () => {
                            const sender = entityCache[entity.sender];
                            if(sender.id != remote.getGlobal("webprotState").self.id) {
                                // Download the avatar of the sender
                                download(sender.avaFile, (senderAvatar) => {
                                    const notification = new Notification(sender.name, {
                                        body: messageSummary(entity.id),
                                        icon: senderAvatar
                                    });
                                    // Shitch to the channel when a notification has been clicked
                                    notification.onclick = (e) => {
                                        viewingChan = entity.channel;
                                        updLayout();
                                        browserWindow.focus();
                                    }
                                });
                                sounds.notification.play()
                            }
                        });
                    }

                    // Update info about groups and channels
                    if(arg.spontaneous && entity.type === "group")
                        updateGroup(entity.id);
                    //if(arg.spontaneous && entity.type === "channel" && entity.group !== 0)
                    //    updateGroup(entity.group);
                    if(arg.spontaneous && entity.type === "channel" && entity.id === viewingChan)
                        updMessageArea(false);
                    if(arg.spontaneous && entity.type === "role")
                        updateGroup(entity.group);
                })
                break;

            case "webprot.ul-progress":
                // Call the callback
                (packetCallbacks[arg.operId] as (p: any, m: any) => any)(arg.progress, arg.max);
                break;

            case "webprot.blob-preview-available":
                // Call the callback
                if(packetCallbacks[arg.operId] !== undefined)
                    (packetCallbacks[arg.operId] as (name: string, size: string, preview: string, hash: Uint8Array, length: number) => any)
                    (arg.name, arg.size, arg.preview, arg.hash, arg.length);
                break;

            case "webprot.mfa-secret":
                // Construct the string to put into the QR code
                var qrString = "otpauth://totp/"
                               + encodeURIComponent(remote.getGlobal("webprotState").self.email)
                               + "?secret="
                               + arg.secret
                               + "&issuer=Order";
                // Generate the code
                const placeholder = elementById("mfa-qr-placeholder");
                qrcode(qrString, (err, canvas) => {
                    if(err) throw err;

                    // Make sure to remove all children :>
                    while(placeholder.firstChild)
                        placeholder.firstChild.remove();

                    placeholder.appendChild(canvas);
                    elementById("mfa-code-manual").innerHTML = escapeHtml(arg.secret);

                    triggerAppear(elementById("mfa-qr-banner"), true);
                });
                break;

            case "webprot.bot-created":
                showBox("BOT CREATED", "Bot ID: " + arg.id + "<br>Bot token: " + arg.token
                    + "<br>This token will be only shown once for security reasons. Please keep it safe.");
                break;
        }
    }
    ipcRenderer.on("message", ipcRecv)

    // Add listeners to window control buttons
    elementById("minimize-button").onclick = (e) => {
        browserWindow.minimize();
    };
    elementById("maximize-button").onclick = (e) => {
        if(browserWindow.isMaximized())
            browserWindow.unmaximize();
        else
            browserWindow.maximize();
    };
    elementById("close-button").onclick = (e) => {
        browserWindow.hide();
    };

    // Add listeners to login controls
    elementById("login-button").onclick = (e) => {
        const email    = (elementById("login-email")    as HTMLInputElement).value;
        const password = (elementById("login-password") as HTMLInputElement).value;
        // hack: all permissions except the bot one. I'm too lazy to list all of them here :)
        const permissions = []; for(var i = 0; i < packets.AccessTokenPermission.BOT; i++) permissions.push(i);
        sendPacket(new packets.LoginPacket(email, password, permissions));
    };

    elementById("login-signup-button").onclick = (e) => {
        showElm(elementById("signup-form"));
        hideElm(elementById("login-form"));
    };

    // Add listeners to signup controls
    elementById("signup-back-button").onclick = (e) => {
        showElm(elementById("login-form"));
        hideElm(elementById("signup-form"));
    };

    elementById("signup-password").oninput = (e) => {
        // Reference components
        var strongRegex = new RegExp("^(?=.{10,})(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*\\W).*$", "g");
        var mediumRegex = new RegExp("^(?=.{8,})(((?=.*[A-Z])(?=.*[a-z]))|((?=.*[A-Z])(?=.*[0-9]))|((?=.*[a-z])(?=.*[0-9]))).*$", "g");
        const password              = (elementById("signup-password")         as HTMLInputElement).value;
        const passwordStrengthText  = (elementById("password-strength-text")  as HTMLInputElement);
        const passwordStrengthMeter = (elementById("password-strength-meter") as HTMLProgressElement);

        // Display the strength to the user
        if(password.length === 0) {
            passwordStrengthText.innerHTML = "";
            passwordStrengthMeter.value = 0;
        } else if(password.length < 6) {
            passwordStrengthText.style.color = "var(--red)";
            passwordStrengthText.innerHTML = "TOO SHORT";
            passwordStrengthMeter.value = 0;
            passwordStrengthMeter.className = "fill-width " + "password-weak";
        } else if(strongRegex.test(password)) {
            passwordStrengthText.style.color = "var(--green)";
            passwordStrengthText.innerHTML = "STRONG";
            passwordStrengthMeter.value = 0;
            passwordStrengthMeter.className = "fill-width " + "password-strong";
        } else if(mediumRegex.test(password)) {
            passwordStrengthText.style.color = "var(--yellow)";
            passwordStrengthText.innerHTML = "MEDIUM";
            passwordStrengthMeter.value = 2;
            passwordStrengthMeter.className = "fill-width " + "password-medium";
        } else {
            passwordStrengthText.style.color = "var(--red)";
            passwordStrengthText.innerHTML = "WEAK";
            passwordStrengthMeter.value = 1;
            passwordStrengthMeter.className = "fill-width " + "password-weak";
        }
    };

    elementById("signup-button").onclick = (e) => {
        // Check everything
        const username = (elementById("signup-username") as HTMLInputElement).value;
        const email    = (elementById("signup-email")    as HTMLInputElement).value;
        const password = (elementById("signup-password") as HTMLInputElement).value;
        const emailRequired = elementById("email-required");
        const nameRequired  = elementById("username-required");
        const passwordStrengthText = elementById("password-strength-text")
        var proceed = true;

        if(!emailRegex.test(email)) {
            showElm(emailRequired);
            emailRequired.style.color = "var(--red)";
            proceed = false;
        } else {
            hideElm(emailRequired);
        }

        if(password.length < 6) {
            passwordStrengthText.style.color = "var(--red)";
            passwordStrengthText.innerHTML = "TOO SHORT";
            proceed = false;
        }
            
        if(username.length == 0) {
            showElm(nameRequired);
            nameRequired.style.color = "var(--red)";
            proceed = false;
        } else {
            hideElm(nameRequired);
        }

        if(proceed) sendPacket(new packets.SignupPacket(email, username, password));
    };

    function stopPropagation(evt: Event) {
        evt.stopPropagation();
        evt.cancelBubble = true;
    }

    // Add listeners that open and close the user settings panel
    elementById("self-avatar")        .onclick = showUserSettings;
    elementById("self-nickname")      .onclick = showUserSettings;
    elementById("user-settings-exit") .onclick = hideUserSettings;
    elementById("user-settings-bg")   .onclick = hideUserSettings;

    elementById("floating-message-bg").onclick = hideFloatingMessage;
    elementById("floating-image-bg")  .onclick = hideFloatingImage;
    elementById("group-create-box-bg").onclick = hideGroupCreateBox;

    elementById("channel-list-header").onclick = showGroupSettings;
    elementById("group-settings-exit").onclick = hideGroupSettings;
    elementById("group-settings-bg")  .onclick = hideGroupSettings;

    elementById("user-settings")   .onclick = stopPropagation;
    elementById("group-settings")  .onclick = stopPropagation;
    elementById("group-create-box").onclick = stopPropagation;
    elementById("profile")         .onclick = stopPropagation;

    elementById("profile-bg").onclick = hideProfile;

    // Settings sections
    document.querySelectorAll('input[name="user-settings-sections"]').forEach((element) => {
        (element as HTMLElement).onclick = (e) => {
            showUserSettingsTab(element.id.substring(0, element.id.length - 4))
        }
    });
    document.querySelectorAll('input[name="group-settings-sections"]').forEach((element) => {
        (element as HTMLElement).onclick = (w) => {
            showGroupSettingsTab(element.id.substring(0, element.id.length - 4))
        }
    });

    // Various text peoperties changing
    const statusTextChange = elementById("self-status-text-change") as HTMLInputElement;
    statusTextChange.onkeypress = (evt) => {
        if(evt.keyCode === 13) // Enter
            setSelfStatusText(statusTextChange.value);
    }
    const usernameChange = elementById("self-name-change") as HTMLInputElement;
    usernameChange.onkeypress = (evt) => {
        if(evt.keyCode === 13)
            setSelfName(usernameChange.value);
    }
    const emailChange = elementById("self-email-change") as HTMLInputElement;
    emailChange.onkeypress = (evt) => {
        if(evt.keyCode === 13)
            setSelfEmail(emailChange.value);
    }

    // 2FA toggling
    elementById("self-mfa-toggle-button").onclick = (evt) => {
        // Disable it if enabled, enable if disabled
        setSelfMfaStatus(!remote.getGlobal("webprotState").self.mfaEnabled);
    };

    // 2FA floating box closing
    elementById("mfa-qr-ok").onclick = (evt) => {
        triggerDisappear(elementById("mfa-qr-banner"), true)
    };

    // Floaty stuffs closing
    document.onkeydown = (e) => {
        if (e.keyCode === 27) {
            hideProfile();
            hideUserSettings();
            hideFloatingMessage();
            hideFloatingImage();
            hideGroupCreateBox();
            hideGroupSettings();
        }
    }

    // Add listeners to self status selectors
    // We can"t query multiple sections and just iterate them :(
    elementById("self-status-offline").addEventListener("click", (e) => setSelfStatus(0));
    elementById("self-status-online") .addEventListener("click", (e) => setSelfStatus(1));
    elementById("self-status-sleep")  .addEventListener("click", (e) => setSelfStatus(2));
    elementById("self-status-dnd")    .addEventListener("click", (e) => setSelfStatus(3));

    // User avatar/group icon selection
    elementById("self-avatar-huge").onclick = () => {
        var newAvaPath: string[]|string = dialog.showOpenDialogSync(browserWindow, {
            properties: ["openFile"],
            filters: [
                { name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "bmp"] }
            ]
        });
        // Don"t if the user decided not to
        if(newAvaPath === undefined)
            return;

        newAvaPath = newAvaPath[0];
        upload(newAvaPath, (id) => {
            // When uploaded, download it (so it is cached and appears in out temp dir)
            download(id, (blob) => {
                updateSelfAva(blob);
            });
            // Update the blob ID
            sendSelfValue("avaFile", id);
        });
    }

    elementById("group-icon-huge").onclick = () => {
        var newIconPath: string[]|string = dialog.showOpenDialogSync(browserWindow, {
            properties: ["openFile"],
            filters: [
                { name: "Images", extensions: ["jpg", "png", "gif", "bmp"] }
            ]
        });
        if(newIconPath === undefined)
            return;

        newIconPath = newIconPath[0];
        upload(newIconPath, (id) => {
            download(id);
            const group = new entities.Group();
            group.id = viewingGroup; group.icon = id;
            putEntities([group]);
        });
    }

    // "About Order" buttons
    elementById("view-on-github")  .onclick = (e) => shell.openExternal("https://github.com/ordermsg");
    elementById("donate")          .onclick = (e) => shell.openExternal("https://ordermsg.tk/donate");
    elementById("connecting-tweet").onclick = (e) => shell.openExternal("https://twitter.com/ordermsg");

    // Friend control buttons
    elementById("friends-all").onclick = (e) => {
        viewingGroup = 0;
        viewingContactGroup = 0;
        updMemberList();
    };
    elementById("friends-online").onclick = (e) => {
        viewingGroup = 0;
        viewingContactGroup = 1;
        updMemberList();
    };
    elementById("friends-pending-in").onclick = (e) => {
        viewingGroup = 0;
        viewingContactGroup = 2;
        updMemberList();
    };
    elementById("friends-pending-out").onclick = (e) => {
        viewingGroup = 0;
        viewingContactGroup = 3;
        updMemberList();
    };
    elementById("friends-blocked").onclick = (e) => {
        viewingGroup = 0;
        viewingContactGroup = 4;
        updMemberList();
    };
    elementById("friend-add").onclick = (e) => {
        toggleElm(elementById("user-search-bar"));
    };
    elementById("friend-add-commit").onclick = (e) => {
        sendPacket(new packets.UserSearchPacket(
            (elementById("user-search-input") as HTMLInputElement).value));
    };

    elementById("message-area-leave").onclick = (e) => {
        viewingGroup = 0;
        viewingChan = 0;
        updLayout();
    };

    // Message section buttons
    elementById("message-text-section-button").onclick = (e) => {
        const id = msgSections.length;
        createInputSection(types.MessageSectionType.TEXT, id, () => {
            removeInputSection(id);
        });
    };
    elementById("message-file-section-button").addEventListener("click", (e) => {
        // Select the file
        var filePath: string[]|string = dialog.showOpenDialogSync(browserWindow, {
            properties: ["openFile"],
            filters: [
                { name: "All files", extensions: ["*"] },
                { name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "bmp"] },
                { name: "Videos", extensions: ["mp4", "mkv", "avi"] },
                { name: "Audio", extensions: ["mp3", "wav", "flac"] }
            ]
        });
        // Don"t continue if the user decided not to
        if(filePath === undefined)
            return;
        filePath = filePath[0];

        // Add the section
        const id = msgSections.length;
        createInputSection(types.MessageSectionType.FILE, id, () => {
            removeInputSection(id);
        }, filePath, fs.statSync(filePath).size);

        const fileProgressBar = msgSections[id].typeElm.getElementsByTagName("progress")[0];

        // Upload the file
        upload(filePath, (blobId) => {
            msgSections[id].blob = blobId;
            fileProgressBar.remove();
        }, (progress, max) => {
            fileProgressBar.max = max;
            fileProgressBar.value = progress;
        })
    })
    // Paste images on Ctrl+V
    document.onkeydown = (e) => {
        // Don"t try to paste text as an image
        const clipFormat = clipboard.availableFormats()[0];
        if(e.ctrlKey && e.keyCode === 86 && clipFormat.startsWith("image/")) {
            const img = clipboard.readImage();
            const fileName = path.join(remote.getGlobal("tmpDir"), "tmpimg.png");
            fs.writeFile(fileName, img.toPNG(), () => {
                const id = msgSections.length;
                createInputSection(types.MessageSectionType.FILE, id, () => {
                    removeInputSection(id);
                }, fileName, fs.statSync(fileName).size);
        
                // Upload the file
                const fileProgressBar = msgSections[id].typeElm.getElementsByTagName("progress")[0];
                upload(fileName, (blobId) => {
                    msgSections[id].blob = blobId;
                    fileProgressBar.remove();
                    // Remove it when done
                    fs.unlinkSync(fileName);
                }, (progress, max) => {
                    fileProgressBar.max = max;
                    fileProgressBar.value = progress;
                });
            });
        }
    }
    elementById("message-code-section-button").addEventListener("click", (e) => {
        const id = msgSections.length;
        createInputSection(types.MessageSectionType.CODE, id, () => {
            removeInputSection(id);
        });
    })
    elementById("message-quote-section-button").addEventListener("click", (e) => {
        const id = msgSections.length;
        createInputSection(types.MessageSectionType.QUOTE, id, () => {
            removeInputSection(id);
        });
    })

    // Message send button
    elementById("message-send-button").onclick = (e) => {
        sendMessage();
    };

    // Load new messages when scrolled to the top
    const msgScrollArea = elementById("message-scroll-area") as HTMLElement
    const loadingFunc = (e) => {
        const messages = entityCache[viewingChan].messages
        if(msgScrollArea.scrollTop <= 500 && messages.length === 50) { // if the last batch gave less than 50 msgs, it must be the end
            // Remove the handler and request messages
            msgScrollArea.onscroll = undefined
            appendMsgsTop(messages[messages.length - 1], () => {
                // Bring the handler back when messages finish loading
                msgScrollArea.onscroll = loadingFunc;
            });
        }
    }
    msgScrollArea.onscroll = loadingFunc;

    // Create/join a group
    elementById("group-create-join-panel").onclick = showGroupCreateBox;
    elementById("group-create-ok").onclick = (e) => {
        const group = new entities.Group();
        group.id = 0; group.name = (elementById("group-create-name") as HTMLInputElement).value;
        putEntities([group]);
    }
    elementById("group-join-ok").onclick = (e) => {
        ipcSend({
            action: "webprot.resolve-invite",
            code:   (elementById("group-join-code") as HTMLInputElement).value,
            add:    true,
            operId: regCallback(hideGroupCreateBox)
        });
    }

    // Group settings
    const groupNameChange = elementById("group-name-change") as HTMLInputElement;
    groupNameChange.onkeypress = (evt) => {
        if(evt.keyCode === 13) {
            const group = new entities.Group();
            group.id = viewingGroup; group.name = groupNameChange.value;
            putEntities([group]);
        }
    }

    elementById("channel-add-button").onclick = (e) => {
        const channel = new entities.Channel();
        channel.id = 0; channel.name = "Text channel"; channel.group = viewingGroup;
        putEntities([channel]);
    }

    const chanNameChange = elementById("channel-name-change") as HTMLInputElement;
    chanNameChange.onkeypress = (e) => {
        if(e.keyCode === 13) {
            const channel = new entities.Channel();
            channel.id = editingChan; channel.name = chanNameChange.value; channel.group = viewingGroup;
            putEntities([channel]);
        }
    }

    elementById("channel-remove-button").onclick = (e) => {
        const channel = new entities.Channel();
        channel.id = editingChan; channel.group = 0;
        putEntities([channel]);
    }

    elementById("invite-create-button").onclick = (e) => {
        const invites = entityCache[viewingGroup].invites;
        const group = new entities.Group();
        group.id = viewingGroup; group.invites = [...invites, ""];
        putEntities([group]);
    }

    elementById("role-add-button").onclick = (e) => {
        const role = new entities.Role();
        role.id = 0; role.name = "New role"; role.color = "#ffffff"; role.group = viewingGroup;
        putEntities([role]);
    }

    const roleNameChane = elementById("role-name-change") as HTMLInputElement;
    roleNameChane.onkeypress = (e) => {
        if(e.keyCode === 13) {
            const role = new entities.Role();
            role.id = editingRole; role.name = roleNameChane.value;
            putEntities([role]);
        }
    }

    elementById("role-remove-button").onclick = (e) => {
        const role = new entities.Role();
        role.id = editingRole; role.group = 0;
        putEntities([role]);
    }

    const roleColorChange = elementById("role-color-change") as HTMLInputElement;
    roleColorChange.onchange = (e) => {
        const role = new entities.Role();
        role.id = editingRole; role.color = roleColorChange.value;
        putEntities([role]);
    }

    elementById("group-leave").onclick = (e) => {
        stopPropagation(e);
        ipcSend({
            action:      "webprot.manage-contacts",
            contactType: "group",
            method:      "remove",
            id:          viewingGroup
        });
    }

    elementById("group-delete-revert").onclick = (e) => { triggerDisappear(elementById("group-delete-box"), true); }
    elementById("group-delete-confirm").onclick = (e) => {
        if((elementById("group-delete-name-input") as HTMLInputElement).value === entityCache[viewingGroup].name) {
            // change da world, my final message.. goodbye
            const group = new entities.Group();
            group.id = viewingGroup; group.owner = 0;
            putEntities([group]);
            viewingGroup = 0;
            viewingChan = 0;
            editingChan = 0;
            updLayout();
            triggerDisappear(elementById("group-delete-box"), true);
        }
    }

    elementById("create-bot").onclick = (e) => {
        ipcSend({
            action: "webprot.create-bot",
            name:   (elementById("create-bot-name") as HTMLInputElement).value
        });
    }

    elementById("invite-bot-button").onclick = (e) => {
        ipcSend({
            action: "webprot.invite-bot",
            bot:    (elementById("invite-bot-id") as HTMLInputElement).value,
            group:  viewingGroup
        });
    }

    // Blur the window if it"s unfocused
    const mainLayoutCont = elementById("main-layout-container");
    browserWindow.addListener("blur",  (e) => { if(configGet("blurOnDefocus")) mainLayoutCont.classList.add   ("unfocused") });
    browserWindow.addListener("focus", (e) => { if(configGet("blurOnDefocus")) mainLayoutCont.classList.remove("unfocused") });
}

window.addEventListener("load", _rendererFunc);