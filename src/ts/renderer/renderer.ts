const _modules = window["_modules"];

const remote                            = _modules.remote;
const { BrowserWindow, dialog }         = remote;
const { ipcRenderer, shell, clipboard } = _modules.electron;

const escapeHtml     = _modules.escapeHtml;
const marked         = _modules.marked;
const path           = _modules.path;
const fs             = _modules.fs;
const qrcode         = _modules.qrcode;

import * as packets    from "../protocol.s/packets.s.js";
import * as entities   from "../protocol.s/entities.s.js";
import * as types      from "../protocol.s/dataTypes.s.js";
import * as tasty      from "../protocol.s/tasty.s.js";
import * as util       from "./util.js";
import * as domUtil    from "./dom_util/dom_util.js";
import * as domMsgUtil from "./dom_util/msg_util.js";
import * as layout     from "./dom_util/layout.js";
import * as context    from "./context.js";
import { configGet, configSet } from "./settings.js";

import { reset, ipcSend, sendPacket, self } from "./yGlobal.js";

function _rendererFunc() {
    reset();
    
    // Sounds
    var sounds = {
        notification: undefined
    };

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
    //sounds.notification = new Audio(path.join(window["__dirname"], "sounds/notification.wav"));

    // Try to connect every 2 seconds
    setInterval(() => ipcSend({
        action: "webprot.connect"
    }), 2000);

    util.checkClientVersion();
    setInterval(util.checkClientVersion, 600000); // 10 minutes

    util.elmById("client-version").innerHTML = escapeHtml(util.clientVersion);

    // Upload and download blobs

    // Determines whether we sould receive notifications
    function shouldReceiveNotif() {
        // no in "do not distract" mode
        return (self().status !== entities.UserStatus.DND)
            && configGet("notifications");
    }

    // Show and hide the user settings panel
    const userSettingsElm = util.elmById("user-settings");
    function showUserSettings() {
        // Reset to the profile tab
        showUserSettingsTab("user-settings-section-profile");
        util.triggerAppear(userSettingsElm, true);
    }
    function hideUserSettings() { util.triggerDisappear(userSettingsElm, true); }

    // Shows a particular user settings section
    function showUserSettingsTab(name: string) {
        // "Log out" is not really a tab
        if(name === "user-settings-section-logout") {
            util.hideElm(util.elmById("main-layout-container"));
            util.showElm(util.elmById("login-form"));

            // Clear the access token
            configSet("accessToken", "");
            ipcSend({ action: "webprot.force-connect" });
            return;
        }

        // Hide all sections
        var sections = document.getElementsByClassName("user-settings-section") as HTMLCollectionOf<HTMLElement>;
        for(var i = 0; i < sections.length; i++)
        util.hideElm(sections[i]);

        // Show the section we need
        util.showElm(util.elmById(name));
        (util.elmById(name + "-sel") as HTMLInputElement).checked = true;
    }

    // Shows a channel in the group preferences panel
    function groupSettingsShowChannel(id: number) {
        window.editingChan = id;
        const chan = window.entityCache[id] as entities.Channel;
        (util.elmById("channel-name-change")  as HTMLInputElement).value   = chan.name;
        (util.elmById("channel-voice-change") as HTMLInputElement).checked = chan.voice;
    }

    // Updates the channel list in the group preferences panel
    function updateGroupSettingsChannelList() {
        if(window.viewingGroup === 0)
            return;

        const channelList = util.elmById("group-settings-channel-list");
        const channels    = window.entityCache[window.viewingGroup].channels;
        util.reqEntities(channels.map(x => new packets.EntityGetRequest(entities.Channel.typeNum, x)), false, () => {
            // Remove previous buttons
            while(channelList.firstChild)
                channelList.firstChild.remove();
            // Create buttons for each channel
            for(let chanId of channels) {
                const elm = domUtil.createChannelButton(chanId, (e) => { groupSettingsShowChannel(chanId) }, false);
                channelList.append(elm);
            }
        })
    }

    // Shows a role in the group preferences panel
    function groupSettingsShowRole(id: number) {
        window.editingRole = id;

        util.reqEntities([new packets.EntityGetRequest(entities.Role.typeNum, id)], false, () => {
            const role = window.entityCache[id];
            (util.elmById("role-name-change") as HTMLInputElement).value = role.name;
    
            // Show or hide the removal button based on whether the role is @everyone
            const deleteBtn = util.elmById("role-remove-button");
            util.setElmVisibility(deleteBtn, role.priority !== 0);

            // Do the same with the name change field (enable/disable it though)
            const nameChange = util.elmById("role-name-change");
            if(role.priority === 0)
                nameChange.setAttribute("disabled", "");
            else
                nameChange.removeAttribute("disabled");

            const colorChange = util.elmById("role-color-change") as HTMLInputElement;
            colorChange.value = role.color;
        })
    }

    function updateGroupSettingsRoles() {
        if(window.viewingGroup === 0)
            return;

        const roleList = util.elmById("group-settings-role-list");
        const roles    = window.entityCache[window.viewingGroup].roles;
        // Force because the roles might have changed their priorities
        util.reqEntities(roles.map(x => new packets.EntityGetRequest(entities.Role.typeNum, x)), true, () => {
            // Remove previous buttons
            while(roleList.firstChild)
                roleList.firstChild.remove();
            // Create buttons for each role (sorted by priority, descending)
            roles.sort((a, b) => window.entityCache[a].priority - window.entityCache[b].priority);
            roles.reverse();
            for(let roleId of roles) {
                const role = window.entityCache[roleId];

                const elm  = document.createElement("div");
                elm.classList.add("role-button");
                elm.innerHTML = escapeHtml(role.name);
                elm.onclick = (e) => { groupSettingsShowRole(roleId); }

                roleList.append(elm);
            }
        })
    }

    function updateGroupSettingsInvites() {
        if(window.viewingGroup === 0)
            return;

        const inviteList = util.elmById("group-settings-invite-list");
        var   invites = window.entityCache[window.viewingGroup].invites;

        while(inviteList.firstChild)
            inviteList.firstChild.remove();

        for(const inv of invites) {
            const elm = document.createElement("div")
            elm.classList.add("group-invite-entry", "flex-row");
            inviteList.appendChild(elm);

            const code = document.createElement("span");
            code.innerHTML = escapeHtml(inv);
            elm.appendChild(code);

            const share = document.createElement("button");
            share.classList.add("accent-button");
            share.innerHTML = "SHARE";
            share.onclick = (e) => {
                const id = window.msgSections.length;
                domMsgUtil.createInputSection(types.MessageSectionType.INVITE, id, () => {
                    domMsgUtil.removeInputSection(id);
                }, inv);
            }
            elm.appendChild(share);

            const remove = document.createElement("button");
            remove.classList.add("danger-button");
            remove.innerHTML = "REVOKE";
            remove.onclick = (e) => {
                invites = invites.filter(x => x != inv);
                const group = new entities.Group();
                group.id = window.viewingGroup; group.invites = invites;
                util.putEntities([group]);
            }
            elm.appendChild(remove);
        }
    }

    // Shows/hides group settings
    function showGroupSettings() {
        // Load group info
        const group = window.entityCache[window.viewingGroup] as entities.Group;
        (util.elmById("group-name-change") as HTMLInputElement).value = escapeHtml(group.name);
        util.triggerAppear(util.elmById("group-settings"), true);

        showGroupSettingsTab("group-settings-section-general");
        groupSettingsShowChannel(group.channels[0]);
        // The earliest created role is @everyone, and it hast the smallest ID of them all
        groupSettingsShowRole(group.roles.sort((a, b) => a - b)[0]);

        util.download(group.icon, (b) =>
            (util.elmById("group-icon-huge") as HTMLImageElement).src = "file://" + b);

        // Load settings
        try { // these might throw an exception if the user has no access to group settings
            updateGroupSettingsRoles();
            updateGroupSettingsChannelList();
            updateGroupSettingsInvites();
        }
        catch { }
    }
    function hideGroupSettings() {
        util.triggerDisappear(util.elmById("group-settings"), true)
    }
    function showGroupSettingsTab(name: string) {
        // "Delete group" is not really a tab
        if(name == "group-settings-section-delete") {
            hideGroupSettings();
            util.elmById("group-delete-name").innerHTML = escapeHtml(window.entityCache[window.viewingGroup].name);
            util.triggerAppear(util.elmById("group-delete-box"), true);
            return;
        }

        // Hide all sections
        var sections = document.getElementsByClassName("group-settings-section") as HTMLCollectionOf<HTMLElement>;
        for(const s of sections) util.hideElm(s);

        // Show the tab we need
        util.showElm(util.elmById(name));
        (util.elmById(name + "-sel") as HTMLInputElement).checked = true
    }

    // Change info about self
    function sendSelfValue(key: string, val: any) {
        const entity = new entities.User();
        entity.id = remote.getGlobal("webprotState").selfId;
        entity[key] = val;

        util.putEntities([entity]);
    }
    function setSelfStatus(status: number) {
        domUtil.updateSelfStatus(status);
        sendSelfValue("status", status);
    }
    function setSelfStatusText(statusText: string) {
        domUtil.updateSelfStatusText(statusText);
        sendSelfValue("statusText", statusText);
    }
    function setSelfName(name: string) {
        domUtil.updateSelfName(name);
        sendSelfValue("name", name);
    }
    function setSelfEmail(email: string) {
        domUtil.updateSelfEmail(email);
        sendSelfValue("email", email);
    }
    function setSelfMfaStatus(mfaStatus: boolean) {
        domUtil.updateSelfMfaStatus(mfaStatus);
        remote.getGlobal("webprotState").self.mfaEnabled = mfaStatus;
        sendSelfValue("mfaEnabled", mfaStatus);
    }

    // Updates all information about a group
    function updateGroup(id: number, force: boolean=false) {
        util.reqEntities([new packets.EntityGetRequest(entities.Group.typeNum, id)], force, () => {
            const group = window.entityCache[id];
            // Update icons
            const icons = document.getElementsByClassName("group-icon-" + id) as HTMLCollectionOf<HTMLImageElement>;
            if(icons.length > 0 && group.icon !== 0) {
                util.download(group.icon, (blob) => {
                    for(const icon of icons)
                        icon.src = "file://" + blob;
                })
            }
    
            // Update the channel and member list
            if(id === window.viewingGroup) {
                layout.updChannelList();
                layout.updMemberList();
            }
    
            try {
                updateGroupSettingsChannelList();
                updateGroupSettingsInvites();
                updateGroupSettingsRoles();
            }
            catch { }
        });
    }

    // Shows/hides the group create box
    function showGroupCreateBox() {
        const groupCreateBox = util.elmById("group-create-box");
        util.triggerAppear(groupCreateBox, true);
    }
    function hideGroupCreateBox() {
        const groupCreateBox = util.elmById("group-create-box");
        util.triggerDisappear(groupCreateBox, true);
    }

    // Appends a message to the message area
    function appendMessage(id: number) {
        const msgArea = util.elmById("message-area");
        const msgScrollArea = util.elmById("message-scroll-area");

        // Check if scrolled all the way down
        const scrolled = msgScrollArea.scrollTop - (msgScrollArea.scrollHeight - msgScrollArea.offsetHeight) <= 100;

        // Create the message
        const msg = window.entityCache[id] as entities.Message;
        const msgElm = domMsgUtil.createMessage(msg.latest,
            msg.sender === window.lastChanSender[msg.channel]
            && util.timeDiff(window.lastChanMsg[msg.channel].id, msg.id) <= layout.messageTimeThres);
        msgArea.appendChild(msgElm);
        domUtil.updateRelatedUsers(msg.latest);

        // Store metadata
        window.lastChanSender[msg.channel] = msg.sender;
        window.lastChanMsg   [msg.channel] = msg.id;
        const chan = window.entityCache[window.viewingChan] as entities.Channel;
        chan.unread = 0;
        chan.firstUnread = msg.id;

        // Scroll down again if it was like that before
        if(scrolled) {
            //msgScrollArea.scrollBy({ top: -msgElm.offsetHeight, left: 0 });
            msgElm.scrollIntoView({ block: "end", behavior: "smooth" });
        }
        util.triggerAppear(msgElm, false);
    }

    // Deletes a message
    function removeMesssage(id: number) {
        const msgs = document.getElementsByClassName("message-" + id);
        for(const msg of msgs)
            msg.remove();
    }

    // Edits a message
    function editExistingMesssage(id: number) {
        const msgs = document.getElementsByClassName("message-" + id);
        for(const msg of msgs) {
            const state = (window.entityCache[id] as entities.Message).latest;
            const newMsg = domMsgUtil.createMessage(state, msg.classList.contains("short-message"));
            msg.replaceWith(newMsg);
            domUtil.updateRelatedUsers(state);
        }
        return msgs.length !== 0;
    }

    function createVoiceMember(id: number, status: entities.ChannelVoiceStatus) {
        const elm = document.createElement("div");
        elm.innerHTML = `
            <img class="user-avatar-${id}"/>
            <span class="user-nickname-${id}"></span>
        `;
        if(status & entities.ChannelVoiceStatus.SPEAKING)
            elm.innerHTML += `<img src="icons/speaking.png"/>`;
        if(status & entities.ChannelVoiceStatus.MUTED)
            elm.innerHTML += `<img src="icons/muted.png"/>`;
        if(status & entities.ChannelVoiceStatus.DEAFENED)
            elm.innerHTML += `<img src="icons/deafened.png"/>`;
        return elm;
    }

    function updateVoiceMembers(id: number) {
        const chan = window.entityCache[id] as entities.Channel;

        const container = util.elmById("voice-members");
        while(container.lastChild) container.lastChild.remove();

        for(var i = 0; i < chan.voiceUsers.length; i++) {
            const userId     = chan.voiceUsers[i];
            const userStatus = chan.voiceStatus[i];
            const elm = createVoiceMember(userId, userStatus);
            container.appendChild(elm);
            domUtil.updateUser(userId); // sets nickname and avatar
        }
    }
    
    // Packet handler
    function onPacket(packet: packets.Packet, reference?: number) {
        console.log("%c[RECEIVED]", "color: #bb0000; font-weight: bold;", packet);

        if(packet instanceof packets.StatusPacket) {
            const code = packet.status;
            switch(code) {
                case packets.StatusCode.MFA_REQUIRED:
                    util.hideElm(util.elmById("login-form"));
                    util.showElm(util.elmById("mfa-form"));
    
                    util.elmById("mfa-login-button").addEventListener("click", (e) => {
                        sendPacket(new packets.MFASecretPacket(
                            (util.elmById("login-mfa-code") as HTMLInputElement).value));
                    });
                    break;

                case packets.StatusCode.LOGIN_ERROR:
                    domUtil.showBox("LOGIN ERROR", packet.message);
                    (util.elmById("login-password") as HTMLInputElement).value = "";
                    break;

                case packets.StatusCode.SIGNUP_ERROR:
                    domUtil.showBox("SIGNUP ERROR", packet.message);
                    (util.elmById("signup-password") as HTMLInputElement).value = "";
                    break;

                case packets.StatusCode.OUTDATED:
                    domUtil.showBox("OUTDATED CLIENT", packet.message, true, () => {
                        shell.openExternal("https://yamka.app/download")
                    });
                    break;

                case packets.StatusCode.RATE_LIMITING:
                    domUtil.showBox("RATE LIMITING", packet.message);
                    break;
                case packets.StatusCode.INVALID_USERNAME:
                    domUtil.showBox("INVALID USERNAME", packet.message);
                    break;
                case packets.StatusCode.INVALID_INVITE:
                    domUtil.showBox("INVALID INVITE", packet.message);
                    break;
                case packets.StatusCode.INTERNAL_ERROR:
                    domUtil.showBox("INTERNAL ERROR", packet.message);
                    break;
                case packets.StatusCode.FRIEND_REQUEST_SENT:
                    domUtil.showBox("FRIEND REQUEST SENT", packet.message);
                    break;
            }
        } else if(packet instanceof packets.ClientIdentityPacket) { // Logged in successfully
            // Save our ID
            remote.getGlobal("webprotState").selfId = packet.userId;
            remote.getGlobal("webprotState").sendPings = true;

            // Show the main UI
            util.hideElm(util.elmById("login-form"));
            util.hideElm(util.elmById("mfa-form"));
            util.hideElm(util.elmById("signup-form"));
            util.showElm(util.elmById("main-layout-container"));

            // Clear input fields
            (util.elmById("login-email")     as HTMLInputElement).value = "";
            (util.elmById("login-password")  as HTMLInputElement).value = "";
            (util.elmById("login-mfa-code")  as HTMLInputElement).value = "";
            (util.elmById("signup-username") as HTMLInputElement).value = "";
            (util.elmById("signup-email")    as HTMLInputElement).value = "";
            (util.elmById("signup-password") as HTMLInputElement).value = "";

            // Reset all caches
            reset();
            window.nextCbId = 0;
            domMsgUtil.resetMsgInput();

            // Request the user
            util.reqEntities([new packets.EntityGetRequest(entities.User.typeNum, packet.userId)], true, () => {
                const self = window.entityCache[packet.userId];
                console.log("Got client user:", self);
                remote.getGlobal("webprotState").self = self;

                layout.updMessageArea();
            })
        } else if(packet instanceof packets.AccessTokenPacket) {
            configSet("accessToken", packet.token);
            sendPacket(new packets.AccessTokenPacket(packet.token)); // Try to login immediately
        } else if(packet instanceof packets.EntitiesPacket) {
            for(var entity of packet.entities) {
                // Shove the entity into the cache
                // And merge the new fields with the old ones
                const oldEntity = window.entityCache[entity.id];
                if(oldEntity !== undefined)
                    entity = Object.assign(oldEntity, entity);
                window.entityCache[entity.id] = entity;

                // Update group settings
                if(entity instanceof entities.Group && entity.id === window.viewingGroup)
                    updateGroup(entity.id);

                // message states are immutable, no need to "merge" them with the old version
                if(entity instanceof entities.Message && entity.latest !== undefined)
                    window.entityCache[entity.latest.id] = entity.latest;

                if(entity instanceof entities.User && entity.dmChannel !== undefined)
                    window.userDm[entity.dmChannel] = entity.id;

                // Request the DM channel for new friends
                if(entity instanceof entities.User
                        && oldEntity instanceof entities.User
                        && entity.id === remote.getGlobal("webprotState").selfId
                        && entity.friends.length !== oldEntity.friends.length) {
                    const friends    = entity.friends;
                    const oldFriends = oldEntity.friends;
                    const newFriends = friends.filter(x => !oldFriends.includes(x));
                    util.reqEntities(newFriends.map(x =>
                        new packets.EntityGetRequest(entities.User.typeNum, x)), true, undefined);
                }

                // Update the unread bubble, just in case
                if(packet.spontaneous && entity instanceof entities.Message) {
                    const chan = window.entityCache[entity.channel] as entities.Channel;
                    if(chan.unread !== 0 && entity.sender !== 0) {
                        chan.firstUnread = entity.id;
                        chan.unread++;
                    }
                    else if(entity.sender === 0)
                        chan.unread--; // the message was deleted

                    if(chan.group !== 0 && window.viewingGroup === 0)
                        layout.updGroupList();
                }
                if(packet.spontaneous && entity instanceof entities.Message && window.viewingGroup === 0 && entity.sender !== 0)
                    domUtil.updateUser(entity.sender);

                // append/edit/delete messages in the open channel
                if(packet.spontaneous && entity instanceof entities.Message && entity.channel === window.viewingChan) {
                    if(oldEntity === undefined && entity.sender !== 0)
                        appendMessage(entity.id);
                    else if(oldEntity !== undefined && entity.sender !== 0)
                        editExistingMesssage(entity.id);
                    else if(entity.sender === 0)
                        removeMesssage(entity.id);
                }

                if(packet.spontaneous && entity instanceof entities.Channel && entity.id === window.viewingChan)
                layout.updMessageArea(false);

                if(packet.spontaneous && entity instanceof entities.Channel
                        && [window.viewingChan, window.voiceChan].includes(entity.id))
                    updateVoiceMembers(entity.id);

                // Update info about self
                if(entity instanceof entities.User && entity.id === remote.getGlobal("webprotState").selfId) {
                    remote.getGlobal("webprotState").self = entity;
                    domUtil.updateSelfInfo(entity.name, entity.tag, entity.status, entity.statusText, entity.email, entity.mfaEnabled);

                    util.setElmVisibility(util.elmById("email-unconfirmed-bar-container"), !entity.emailConfirmed);
                    util.setElmVisibility(util.elmById("email-conf-cont"),                 !entity.emailConfirmed);

                    // Request own avatar
                    util.download(entity.avaFile, (blob) => {
                        domUtil.updateSelfAva(blob);
                    });

                    // Update DM, friend and group list
                    layout.updGroupList();
                    if(window.viewingGroup === 0) {
                        layout.updMemberList();
                        layout.updChannelList();
                    }

                    // Check new friend requests
                    const pin = entity.pendingIn;
                    util.elmById("pending-in-count").innerHTML = escapeHtml(pin.length);
                    util.setElmVisibility(util.elmById("pin-cnt-container"), pin.length > 0);
                    if(packet.spontaneous && oldEntity.pendingIn.length !== entity.pendingIn.length
                        && shouldReceiveNotif()) {
                        const newFriends = entity.pendingIn.filter(x => !oldEntity.pendingIn.includes(x));
                        // Request their entities
                        util.reqEntities(newFriends.map(x => new packets.EntityGetRequest(entities.User.typeNum, x)), false, () => {
                            for(const fid of newFriends) {
                                const f = window.entityCache[fid];
                                // Download avatars of each one
                                util.download(f.avaFile, (ava) => {
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
                        util.elmById("owned-bot-list").innerHTML = entity.ownedBots.join(", ");
                }

                // Update info about other users
                if(entity instanceof entities.User)
                    domUtil.updateUser(entity.id);
            }
        } else if(packet instanceof packets.MFASecretPacket) {
            // Construct the string to put into the QR code
            const qrString = "otpauth://totp/"
                + encodeURIComponent(remote.getGlobal("webprotState").self.email)
                + "?secret="
                + packet.secret
                + "&issuer=Yamka";
            // Generate the code
            const placeholder = util.elmById("mfa-qr-placeholder");
            while(placeholder.firstChild)
                placeholder.firstChild.remove();
            const canvas = placeholder.appendChild(document.createElement("canvas"));
            qrcode.toCanvas(canvas, qrString, (err) => {
                if(err) throw err;
                util.elmById("mfa-code-manual").innerHTML = escapeHtml(packet.secret);
                util.triggerAppear(util.elmById("mfa-qr-banner"), true);
            });
        }

        // Call the callback
        if(reference !== undefined) {
            const cb = window.packetCallbacks[reference];
            cb(packet);
            delete window.packetCallbacks[reference];
        }
    }

    // Main process handler
    function ipcRecv(evt: Event, arg: any) {
        if(["webprot.status", "webprot.trigger-reference",
            "webprot.packet-recv", "webprot.connected", "webprot.connecting", "webprot.disconnected",
            "tasty.stats"]
                .indexOf(arg.type) === -1)
            console.log("%c[M->R]", "color: #bb00bb; font-weight: bold;", arg);
        switch(arg.type) {
            case "webprot.status":
                console.log("%c[STATUS]", "color: #6440a5; font-weight: bold;", arg.message);
                break;

            case "webprot.connecting":
                util.showElm(util.elmById("connecting-screen-bg"));
                break;
            case "webprot.connected":
                setTimeout(() => util.hideElm(util.elmById("connecting-screen-bg")), 1000); // kinda wait \(-_-)/
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
                    "MFASecretPacket":      new packets.MFASecretPacket()
                }[arg.pType];
                const packet = Object.assign(proto, arg.packet);
                if(packet instanceof packets.EntitiesPacket) {
                    packet.entities = packet.entities.map(e => {
                        const e_proto = {
                            "User":         new entities.User(),
                            "Channel":      new entities.Channel(),
                            "Group":        new entities.Group(),
                            "Message":      new entities.Message(),
                            "Role":         new entities.Role(),
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
                // single ref
                if(arg.references === undefined) {
                    if(arg.reference === undefined)
                        break;
                    const cb = window.packetCallbacks[arg.reference];
                    cb(...arg.args);
                } else {
                    arg.references.forEach(x => window.packetCallbacks[x](...arg.args));
                }
                break;

            case "webprot.ul-progress":
                // Call the callback
                (window.packetCallbacks[arg.operId] as (p: any, m: any) => any)(arg.progress, arg.max);
                break;

            case "webprot.bot-created":
                domUtil.showBox("BOT CREATED", "Bot ID: " + arg.id + "<br>Bot token: " + arg.token
                    + "<br>This token will be only shown once for security reasons. Please keep it safe.");
                break;

            case "tasty.status":
                if(arg.status === "connected")
                    util.showElm(util.elmById("message-area-voice-disconnect"));
                util.elmById("voice-status").innerHTML = escapeHtml(arg.status === "disconnected"
                    ? "" : `VOICE: ${arg.status.toUpperCase()}`);
                break;

            case "tasty.stats":
                const stats: tasty.TastyEncoderStats = arg.stats;
                util.elmById("voice-encoder-stats").title
                    = `Effective compression ratio: ${(stats.compressionRatio * 100).toFixed(0)}%\n`
                    + `Frame rate: ${stats.frameRate}\n`
                    + `Bit rate: ${stats.bitRate}\n`
                    + `Key length: ${stats.keySize}\n`
                    + `Channels: ${stats.channels === 2 ? "stereo" : "mono"}`;
                break;
        }
    }
    ipcRenderer.on("message", ipcRecv)

    // Add listeners to window control buttons
    util.elmById("minimize-button").onclick = (e) => {
        browserWindow.minimize();
    };
    util.elmById("maximize-button").onclick = (e) => {
        if(browserWindow.isMaximized())
            browserWindow.unmaximize();
        else
            browserWindow.maximize();
    };
    util.elmById("close-button").onclick = (e) => {
        browserWindow.hide();
    };

    // Add listeners to login controls
    util.elmById("login-button").onclick = (e) => {
        const email    = (util.elmById("login-email")    as HTMLInputElement).value;
        const password = (util.elmById("login-password") as HTMLInputElement).value;
        // hack: all permissions except the bot one. I'm too lazy to list all of them here :)
        const permissions = []; for(var i = 0; i < packets.AccessTokenPermission.BOT; i++) permissions.push(i);
        sendPacket(new packets.LoginPacket(email, password, permissions));
    };

    util.elmById("login-signup-button").onclick = (e) => {
        util.showElm(util.elmById("signup-form"));
        util.hideElm(util.elmById("login-form"));
    };

    // Add listeners to signup controls
    util.elmById("signup-back-button").onclick = (e) => {
        util.showElm(util.elmById("login-form"));
        util.hideElm(util.elmById("signup-form"));
    };

    util.elmById("signup-password").oninput = (e) => {
        // Reference components
        var strongRegex = new RegExp("^(?=.{10,})(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*\\W).*$", "g");
        var mediumRegex = new RegExp("^(?=.{8,})(((?=.*[A-Z])(?=.*[a-z]))|((?=.*[A-Z])(?=.*[0-9]))|((?=.*[a-z])(?=.*[0-9]))).*$", "g");
        const password              = (util.elmById("signup-password")         as HTMLInputElement).value;
        const passwordStrengthText  = (util.elmById("password-strength-text")  as HTMLInputElement);
        const passwordStrengthMeter = (util.elmById("password-strength-meter") as HTMLProgressElement);

        // Display the strength to the user
        if(password.length === 0) {
            passwordStrengthText.innerHTML = "";
            passwordStrengthMeter.value = 0;
        } else if(password.length < 6) {
            passwordStrengthText.className = "password-weak";
            passwordStrengthText.innerHTML = "TOO SHORT";
            passwordStrengthMeter.value = 0;
            passwordStrengthMeter.className = "fill-width " + "password-weak";
        } else if(strongRegex.test(password)) {
            passwordStrengthText.className = "password-strong";
            passwordStrengthText.innerHTML = "STRONG";
            passwordStrengthMeter.value = 3;
            passwordStrengthMeter.className = "fill-width " + "password-strong";
        } else if(mediumRegex.test(password)) {
            passwordStrengthText.className = "password-medium";
            passwordStrengthText.innerHTML = "MEDIUM";
            passwordStrengthMeter.value = 2;
            passwordStrengthMeter.className = "fill-width " + "password-medium";
        } else {
            passwordStrengthText.className = "password-weak";
            passwordStrengthText.innerHTML = "WEAK";
            passwordStrengthMeter.value = 1;
            passwordStrengthMeter.className = "fill-width " + "password-weak";
        }
    };

    util.elmById("signup-button").onclick = (e) => {
        // Check everything
        const username = (util.elmById("signup-username") as HTMLInputElement).value;
        const email    = (util.elmById("signup-email")    as HTMLInputElement).value;
        const password = (util.elmById("signup-password") as HTMLInputElement).value;
        const emailRequired = util.elmById("email-required");
        const nameRequired  = util.elmById("username-required");
        const passwordStrengthText = util.elmById("password-strength-text")
        var proceed = true;

        if(!util.emailRegex.test(email)) {
            util.showElm(emailRequired);
            emailRequired.style.color = "var(--red)";
            proceed = false;
        } else {
            util.hideElm(emailRequired);
        }

        if(password.length < 6) {
            passwordStrengthText.style.color = "var(--red)";
            passwordStrengthText.innerHTML = "TOO SHORT";
            proceed = false;
        }
            
        if(username.length == 0) {
            util.showElm(nameRequired);
            nameRequired.style.color = "var(--red)";
            proceed = false;
        } else {
            util.hideElm(nameRequired);
        }

        if(proceed) sendPacket(new packets.SignupPacket(email, username, password));
    };

    // Add listeners that open and close the user settings panel
    util.elmById("self-avatar")        .onclick = showUserSettings;
    util.elmById("self-nickname")      .onclick = showUserSettings;
    util.elmById("user-settings-exit") .onclick = hideUserSettings;
    util.elmById("user-settings-bg")   .onclick = hideUserSettings;

    util.elmById("floating-message-bg").onclick = domUtil.hideFloatingMessage;
    util.elmById("floating-image-bg")  .onclick = domUtil.hideFloatingImage;
    util.elmById("group-create-box-bg").onclick = hideGroupCreateBox;

    util.elmById("channel-list-header").onclick = showGroupSettings;
    util.elmById("group-settings-exit").onclick = hideGroupSettings;
    util.elmById("group-settings-bg")  .onclick = hideGroupSettings;

    util.elmById("user-settings")   .onclick = util.stopPropagation;
    util.elmById("group-settings")  .onclick = util.stopPropagation;
    util.elmById("group-create-box").onclick = util.stopPropagation;
    util.elmById("profile")         .onclick = util.stopPropagation;

    util.elmById("profile-bg").onclick = domUtil.hideProfile;

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
    const statusTextChange = util.elmById("self-status-text-change") as HTMLInputElement;
    statusTextChange.onkeypress = (evt) => {
        if(evt.keyCode === 13) // Enter
            setSelfStatusText(statusTextChange.value);
    }
    const usernameChange = util.elmById("self-name-change") as HTMLInputElement;
    usernameChange.onkeypress = (evt) => {
        if(evt.keyCode === 13)
            setSelfName(usernameChange.value);
    }
    const emailChange = util.elmById("self-email-change") as HTMLInputElement;
    emailChange.onkeypress = (evt) => {
        if(evt.keyCode === 13)
            setSelfEmail(emailChange.value);
    }
    const emailConfirm = util.elmById("self-email-confirm") as HTMLInputElement;
    emailConfirm.onkeypress = (evt) => {
        if(evt.keyCode === 13) {
            sendPacket(new packets.EmailConfirmationPacket(emailConfirm.value));
            emailConfirm.value = "";
        }
    }

    // 2FA toggling
    util.elmById("self-mfa-toggle-button").onclick = (evt) => {
        // Disable it if enabled, enable if disabled
        setSelfMfaStatus(!remote.getGlobal("webprotState").self.mfaEnabled);
    };

    // 2FA floating box closing
    util.elmById("mfa-qr-ok").onclick = (evt) => {
        util.triggerDisappear(util.elmById("mfa-qr-banner"), true)
    };

    // Floaty stuffs closing
    document.onkeydown = (e) => {
        if (e.keyCode === 27) {
            domUtil.hideProfile();
            hideUserSettings();
            domUtil.hideFloatingMessage();
            domUtil.hideFloatingImage();
            hideGroupCreateBox();
            hideGroupSettings();
        }
    }

    // Add listeners to self status selectors
    // We can"t query multiple sections and just iterate them :(
    util.elmById("self-status-offline").addEventListener("click", (e) => setSelfStatus(0));
    util.elmById("self-status-online") .addEventListener("click", (e) => setSelfStatus(1));
    util.elmById("self-status-sleep")  .addEventListener("click", (e) => setSelfStatus(2));
    util.elmById("self-status-dnd")    .addEventListener("click", (e) => setSelfStatus(3));

    // User avatar/group icon selection
    util.elmById("self-avatar-huge").onclick = () => {
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
        util.upload(newAvaPath, (id) => {
            // When uploaded, download it (so it is cached and appears in out temp dir)
            util.download(id, (blob) => {
                domUtil.updateSelfAva(blob);
            });
            // Update the blob ID
            sendSelfValue("avaFile", id);
        }, undefined, true);
    }

    util.elmById("group-icon-huge").onclick = () => {
        var newIconPath: string[]|string = dialog.showOpenDialogSync(browserWindow, {
            properties: ["openFile"],
            filters: [
                { name: "Images", extensions: ["jpg", "png", "gif", "bmp"] }
            ]
        });
        if(newIconPath === undefined)
            return;

        newIconPath = newIconPath[0];
        util.upload(newIconPath, (id) => {
            util.download(id);
            const group = new entities.Group();
            group.id = window.viewingGroup; group.icon = id;
            util.putEntities([group]);
        });
    }

    // "About Yamka" buttons
    util.elmById("view-on-github")  .onclick = (e) => shell.openExternal("https://github.com/yamka-app");
    util.elmById("donate")          .onclick = (e) => shell.openExternal("https://yamka.app/donate");
    util.elmById("connecting-tweet").onclick = (e) => shell.openExternal("https://twitter.com/yamka-app");

    // Friend control buttons
    util.elmById("friends-all").onclick = (e) => {
        window.viewingGroup = 0;
        window.viewingContactGroup = 0;
        layout.updMemberList();
    };
    util.elmById("friends-online").onclick = (e) => {
        window.viewingGroup = 0;
        window.viewingContactGroup = 1;
        layout.updMemberList();
    };
    util.elmById("friends-pending-in").onclick = (e) => {
        window.viewingGroup = 0;
        window.viewingContactGroup = 2;
        layout.updMemberList();
    };
    util.elmById("friends-pending-out").onclick = (e) => {
        window.viewingGroup = 0;
        window.viewingContactGroup = 3;
        layout.updMemberList();
    };
    util.elmById("friends-blocked").onclick = (e) => {
        window.viewingGroup = 0;
        window.viewingContactGroup = 4;
        layout.updMemberList();
    };
    util.elmById("friend-add").onclick = (e) => {
        util.toggleElm(util.elmById("user-search-bar"));
    };
    util.elmById("friend-add-commit").onclick = (e) => {
        sendPacket(new packets.UserSearchPacket(
            (util.elmById("user-search-input") as HTMLInputElement).value));
    };

    util.elmById("message-area-leave").onclick = (e) => {
        window.viewingGroup = 0;
        window.viewingChan = 0;
        layout.updLayout();
    };
    util.elmById("message-area-voice").onclick = (e) => {
        window.voiceChan = window.viewingChan;
        ipcSend({ action: "tasty.connect", channel: window.voiceChan });
    };
    util.elmById("message-area-voice-disconnect").onclick = (e) => {
        window.voiceChan = 0;
        util.hideElm(util.elmById("message-area-voice-disconnect"));
        ipcSend({ action: "tasty.disconnect", channel: window.voiceChan });
    };

    // Message section buttons
    util.elmById("message-text-section-button").onclick = (e) => {
        const id = window.msgSections.length;
        domMsgUtil.createInputSection(types.MessageSectionType.TEXT, id, () => {
            domMsgUtil.removeInputSection(id);
        });
    };
    util.elmById("message-file-section-button").addEventListener("click", (e) => {
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
        const id = window.msgSections.length;
        domMsgUtil.createInputSection(types.MessageSectionType.FILE, id, () => {
            domMsgUtil.removeInputSection(id);
        }, filePath, fs.statSync(filePath).size);

        const fileProgressBar = window.msgSections[id].typeElm.getElementsByTagName("progress")[0];

        // Upload the file
        util.upload(filePath, (blobId) => {
            window.msgSections[id].blob = blobId;
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
                const id = window.msgSections.length;
                domMsgUtil.createInputSection(types.MessageSectionType.FILE, id, () => {
                    domMsgUtil.removeInputSection(id);
                }, fileName, fs.statSync(fileName).size);
        
                // Upload the file
                const fileProgressBar = window.msgSections[id].typeElm.getElementsByTagName("progress")[0];
                util.upload(fileName, (blobId) => {
                    window.msgSections[id].blob = blobId;
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
    util.elmById("message-code-section-button").addEventListener("click", (e) => {
        const id = window.msgSections.length;
        domMsgUtil.createInputSection(types.MessageSectionType.CODE, id, () => {
            domMsgUtil.removeInputSection(id);
        });
    })
    util.elmById("message-quote-section-button").addEventListener("click", (e) => {
        const id = window.msgSections.length;
        domMsgUtil.createInputSection(types.MessageSectionType.QUOTE, id, () => {
            domMsgUtil.removeInputSection(id);
        });
    })

    // Message send button
    util.elmById("message-send-button").onclick = (e) => {
        domMsgUtil.sendMessage();
    };

    // Load new messages when scrolled to the top
    const msgScrollArea = util.elmById("message-scroll-area") as HTMLElement
    const loadingFunc = (e) => {
        const messages = window.entityCache[window.viewingChan].messages
        if(msgScrollArea.scrollTop <= 500 && messages.length === 50) { // if the last batch gave less than 50 msgs, it must be the end
            // Remove the handler and request messages
            msgScrollArea.onscroll = undefined
            layout.appendMsgsTop(messages[messages.length - 1], () => {
                // Bring the handler back when messages finish loading
                msgScrollArea.onscroll = loadingFunc;
            });
        }
    }
    msgScrollArea.onscroll = loadingFunc;

    // Create/join a group
    util.elmById("group-create-join-panel").onclick = showGroupCreateBox;
    util.elmById("group-create-ok").onclick = (e) => {
        const group = new entities.Group();
        group.id = 0; group.name = (util.elmById("group-create-name") as HTMLInputElement).value;
        util.putEntities([group]);
    }
    util.elmById("group-join-ok").onclick = (e) => {
        sendPacket(new packets.InviteResolvePacket(
            (util.elmById("group-join-code") as HTMLInputElement).value,
            true
        ));
    }

    // Group settings
    const groupNameChange = util.elmById("group-name-change") as HTMLInputElement;
    groupNameChange.onkeypress = (evt) => {
        if(evt.keyCode === 13) {
            const group = new entities.Group();
            group.id = window.viewingGroup; group.name = groupNameChange.value;
            util.putEntities([group]);
        }
    }

    util.elmById("channel-add-button").onclick = (e) => {
        const channel = new entities.Channel();
        channel.id = 0; channel.name = "Text channel"; channel.group = window.viewingGroup;
        util.putEntities([channel]);
    }

    const chanNameChange = util.elmById("channel-name-change") as HTMLInputElement;
    chanNameChange.onkeypress = (e) => {
        if(e.keyCode === 13) {
            const channel = new entities.Channel();
            channel.id = window.editingChan; channel.name = chanNameChange.value;
            util.putEntities([channel]);
        }
    }

    const chanVoiceChange = util.elmById("channel-voice-change") as HTMLInputElement;
    chanVoiceChange.onclick = (e) => {
        const channel = new entities.Channel();
        channel.id = window.editingChan; channel.voice = chanVoiceChange.checked;
        util.putEntities([channel]);
    }

    util.elmById("channel-remove-button").onclick = (e) => {
        const channel = new entities.Channel();
        channel.id = window.editingChan; channel.group = 0;
        util.putEntities([channel]);
    }

    util.elmById("invite-create-button").onclick = (e) => {
        const invites = window.entityCache[window.viewingGroup].invites;
        const group = new entities.Group();
        group.id = window.viewingGroup; group.invites = [...invites, ""];
        util.putEntities([group]);
    }

    util.elmById("role-add-button").onclick = (e) => {
        const role = new entities.Role();
        role.id = 0; role.name = "New role"; role.color = "#ffffff"; role.group = window.viewingGroup;
        util.putEntities([role]);
    }

    const roleNameChane = util.elmById("role-name-change") as HTMLInputElement;
    roleNameChane.onkeypress = (e) => {
        if(e.keyCode === 13) {
            const role = new entities.Role();
            role.id = window.editingRole; role.name = roleNameChane.value;
            util.putEntities([role]);
        }
    }

    util.elmById("role-remove-button").onclick = (e) => {
        const role = new entities.Role();
        role.id = window.editingRole; role.group = 0;
        util.putEntities([role]);
    };

    const roleColorChange = util.elmById("role-color-change") as HTMLInputElement;
    roleColorChange.onchange = (e) => {
        const role = new entities.Role();
        role.id = window.editingRole; role.color = roleColorChange.value;
        util.putEntities([role]);
    };

    util.elmById("group-leave").onclick = (e) => {
        util.stopPropagation(e);
        ipcSend({
            action:      "webprot.manage-contacts",
            contactType: "group",
            method:      "remove",
            id:          window.viewingGroup
        });
    };

    util.elmById("group-delete-revert").onclick = (e) => { util.triggerDisappear(util.elmById("group-delete-box"), true); }
    util.elmById("group-delete-confirm").onclick = (e) => {
        if((util.elmById("group-delete-name-input") as HTMLInputElement).value === window.entityCache[window.viewingGroup].name) {
            // change da world, my final message.. goodbye
            const group = new entities.Group();
            group.id = window.viewingGroup; group.owner = 0;
            util.putEntities([group]);
            window.viewingGroup = 0;
            window.viewingChan = 0;
            window.editingChan = 0;
            layout.updLayout();
            util.triggerDisappear(util.elmById("group-delete-box"), true);
        }
    };

    util.elmById("create-bot").onclick = (e) => {
        ipcSend({
            action: "webprot.create-bot",
            name:   (util.elmById("create-bot-name") as HTMLInputElement).value
        });
    };

    util.elmById("invite-bot-button").onclick = (e) => {
        ipcSend({
            action: "webprot.invite-bot",
            bot:    (util.elmById("invite-bot-id") as HTMLInputElement).value,
            group:  window.viewingGroup
        });
    };

    util.elmById("update-popup-upd").onclick = (e) => {
        shell.openExternal("https://yamka.app/download");
        util.hideElm(util.elmById("update-popup"));
    };
    util.elmById("update-popup-ign").onclick = (e) =>
        util.hideElm(util.elmById("update-popup"));

    // Blur the window if it's unfocused
    const mainLayoutCont = util.elmById("main-layout-container");
    browserWindow.addListener("blur",  (e) => { if(configGet("blurOnDefocus")) mainLayoutCont.classList.add   ("unfocused") });
    browserWindow.addListener("focus", (e) => { if(configGet("blurOnDefocus")) mainLayoutCont.classList.remove("unfocused") });

    window.addEventListener("keydown", (e) => {
        if(e.key === "F4" && e.altKey)
            browserWindow.minimize();
    });
}

window.addEventListener("load", _rendererFunc);