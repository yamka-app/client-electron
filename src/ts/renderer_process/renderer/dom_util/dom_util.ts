// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// DOM utils
// for the specific elements of the app's layout

const _modules = window["_modules"];
const path   = _modules.path;
const remote = _modules.remote;

const { clipboard }      = _modules.electron;

import * as util     from "../util.js";
import * as packets  from "../../protocol.s/packets.s.js";
import * as entities from "../../protocol.s/entities.s.js";
import * as types    from "../../protocol.s/dataTypes.s.js";
import * as layout   from "./layout.js";
import * as msgUtil  from "./msg_util.js";
import * as yGlobal  from "../yGlobal.js";
import * as context  from "../context.js";
import * as notif    from "./notif.js";

// Show a floating message box
export function showBox(header: string, text: string, showUpdate: boolean =false, updCb?:Function) {
    util.elmById("floating-box-header").innerHTML = header;
    util.elmById("floating-box-text").innerHTML = text;
    util.triggerAppear(util.elmById("floating-box"), true);

    util.elmById("floating-box-ok").addEventListener("click", (e) => {
        util.triggerDisappear(util.elmById("floating-box"), true);
    })

    const updButton = util.elmById("floating-box-upd") as HTMLButtonElement;
    updButton.onclick = (e) => updCb();
    util.setElmVisibility(updButton, showUpdate);
}

// Show the update box
export function showUpdBox(text: string) {
    const box = util.elmById("update-popup");
    util.elmById("update-popup-text").innerHTML = util.escapeHtml(text);
    util.showElm(box);
    box.classList.remove("sliding-in");
    box.classList.add("sliding-in");
}

// Update info about self
export function updateSelfStatus(status: number) {
    // Update the icon in the user bar
    (util.elmById("self-status") as HTMLImageElement).src = util.statusIconPath(status);
    // Update the switch in the user settings
    (util.elmById("self-status-" + util.statusStr(status)) as HTMLInputElement).checked = true;
}
export function updateSelfStatusText(statusText: string) {
    util.elmById("self-status-text").innerHTML = util.escapeHtml(statusText);
    (util.elmById("self-status-text-change") as HTMLInputElement).value = statusText;
}
export function updateSelfName(name: string) {
    util.elmById("self-nickname").innerHTML = util.escapeHtml(name);
    (util.elmById("self-name-change") as HTMLInputElement).value = name;
}
export function updateSelfTag(tag: number) {
    util.elmById("self-tag").innerHTML = util.escapeHtml(util.formatTag(tag));
    util.elmById("self-tag-settings").innerHTML = util.escapeHtml(util.formatTag(tag));
}
export function updateSelfEmail(email: string) {
    (util.elmById("self-email-change") as HTMLInputElement).value = email;
}
export function updateSelfMfaStatus(mfaEnabled: boolean) {
    util.elmById("self-mfa-enable-status").innerHTML = mfaEnabled ? "ENABLED" : "DISABLED";
    util.elmById("self-mfa-toggle-button").innerHTML = (mfaEnabled ? "DISABLE" : "ENABLE") + " 2FA";
}
export function updateSelfAva(path: string) {
    (util.elmById("self-avatar") as HTMLInputElement).src = "file://" + path;
    (util.elmById("self-avatar-huge") as HTMLInputElement).src = "file://" + path;
}
export function updateSelfInfo(name: string, tag: number, status: number, statusText: string, email: string, mfaEnabled: boolean) {
    updateSelfName(name);
    updateSelfTag(tag);
    updateSelfStatus(status);
    updateSelfStatusText(statusText);
    updateSelfEmail(email);
    updateSelfMfaStatus(mfaEnabled);
}

// Shows/hides a floating message
export function showFloatingMessage(state: entities.MessageState) {
    const floatingMessage = util.elmById("floating-message")
    // Remove old junk
    while(floatingMessage.firstChild)
        floatingMessage.firstChild.remove();

    // Create the message
    const message = msgUtil.createMessage(state);
    message.style.margin = "0";
    floatingMessage.appendChild(message);
    updateRelatedUsers(state);

    util.triggerAppear(floatingMessage, true);
}
export function hideFloatingMessage() {
    const floatingMessage = util.elmById("floating-message");
    util.triggerDisappear(floatingMessage, true);
}

// Calls updateUser() for every user related to the message
export function updateRelatedUsers(state: entities.MessageState, deep:number =5) {
    if(deep <= 0 || state === undefined)
        return;

    const msg = window.entityCache[state.msg_id] as entities.Message;

    for(const section of state.sections)
        if(section.type === types.MessageSectionType.QUOTE && section.blob !== 0)
            updateRelatedUsers((window.entityCache[section.blob] as entities.Message)
                ?.latest, deep - 1);

    updateUser(msg.sender);
}

// Updates all information about a user
export function updateUser(id: number, cb?: (light: boolean) => any, profile = false) {
    util.reqEntities([new packets.EntityGetRequest(entities.User.typeNum, id)], false, () => {
        const user = window.entityCache[id] as entities.User;

        // Update avatars
        const avas = document.getElementsByClassName("user-avatar-" + id) as HTMLCollectionOf<HTMLImageElement>;
        if(avas.length > 0) {
            util.download(user.avaFile, (blob) => {
                for(const ava of avas)
                    ava.src = "file://" + blob;
            });
        }

        // Update statuses
        const statuses = document.getElementsByClassName("user-online-" + id) as HTMLCollectionOf<HTMLImageElement>;
        for(const status of statuses)
            status.src = util.statusIconPath(user.status);

        // Reset the color if in DMs
        if(window.viewingGroup === 0)
            user.color = undefined;

        // Update status texts
        const statusTexts = document.getElementsByClassName("user-status-" + id);
        for(const st of statusTexts)
            st.innerHTML = util.escapeHtml(user.statusText)

        // Update "verified" badges
        if(user.badges.includes(1)) {
            const verifiedBadges = document.getElementsByClassName("verified-badge-" + id);
            for(const b of verifiedBadges)
                b.classList.add("true");
        }

        // Update the unread bubbles
        const dm = window.entityCache[user.dmChannel] as entities.Channel;
        if(dm !== undefined) {
            const bubbles = document.getElementsByClassName("bubble-" + id);
            const bubbleCnts = document.getElementsByClassName("bubble-cnt-" + id);
            for(const bubble of bubbles) {
                if(window.viewingGroup !== 0 || dm.unread === 0)
                    bubble.classList.add("hidden");
                else
                    bubble.classList.remove("hidden");
            }
            for(const cnt of bubbleCnts) {
                cnt.innerHTML = util.escapeHtml(`${dm.unread}`);
            }
        }

        const updateColorRelated = () => {
            // update profile background
            const color = (window.entityCache[user.avaFile] as entities.File).__color;
            const light = util.isColorLight(color);
            const color2 = util.colorSpin(color);
            if(profile) {
                const topbar = util.elmById("profile-topbar");
                topbar.style.background = `linear-gradient(90deg, ${color}, ${color2})`;
            }
            // update notes
            const notes = document.getElementsByClassName("user-note-" + id) as HTMLCollectionOf<HTMLSpanElement>;
            for(const noteElm of notes) {
                // profile notes input fields should be black or white
                // normal notes should have the user's color
                const noteColor = noteElm.id === "profile-note"
                        ? (util.isColorLight(color) ? "#000" : "#fff")
                        : color;
                noteElm.style.background = noteColor;
                noteElm.style.color = util.isColorLight(noteColor) ? "#000" : "#fff";
                if(noteElm instanceof HTMLInputElement) {
                    noteElm.value = user.note ?? "";
                } else {
                    noteElm.style.display = (user.note === undefined || user.note === "") ? "none" : "";
                    noteElm.innerHTML = user.note;
                }
            }

            // Update nicknames and tags
            const profileNicknameColor = light ? "#000" : "#fff";
            const profileTagColor = light ? "#111" : "#eee";
            const nicknames = document.getElementsByClassName("user-nickname-" + id) as HTMLCollectionOf<HTMLElement>;
            const tags = document.getElementsByClassName("user-tag-" + id) as HTMLCollectionOf<HTMLElement>;
            for(const name of nicknames) {
                name.innerHTML = util.escapeHtml(user.name);
                if(name.id === "profile-nickname")
                    name.style.color = profileNicknameColor;
            }
            for(const tag of tags) {
                tag.innerHTML = util.escapeHtml(util.formatTag(user.tag));
                if(tag.id === "profile-tag")
                    tag.style.color = profileTagColor;
            }

            if(cb !== undefined)
                cb(light);
        };

        // Calculate the color of the avatar if not done already
        // then update user notes
        util.reqEntities([new packets.EntityGetRequest(entities.File.typeNum, user.avaFile)], false, () => {
            const ava = window.entityCache[user.avaFile] as entities.File;
            if(ava?.__color === undefined) {
                // if the user specified their favorite color, use it instead
                if(user.favColor !== "#00000000") {
                    ava.__color = user.favColor;
                    updateColorRelated();
                    return;
                }
                // or extract one from their avatar
                const avaZero = avas.item(0);
                if(avaZero !== null) {
                    avaZero.onload = () => {
                        ava.__color = util.getPrimaryColor(avaZero);
                        updateColorRelated();
                    };
                }
            } else if(ava !== undefined) {
                updateColorRelated();
            }
        });
    });
}

// Shows a profile tab
export function showProfileTab(tab: string) {
    (util.elmById("profile-tab-" + tab) as HTMLInputElement).checked = true;
    const tabs = document.querySelectorAll(".profile-tab");
    for(const tabPanel of tabs)
        (tabPanel as HTMLElement).style.display = "none";
    util.elmById("profile-" + tab).style.display = "";
}
export function setupProfileTabs() {
    const tabs = document.querySelectorAll("[name=\"profile-tabs\"]");
    for(const tab of tabs) {
        const name = tab.id.split("profile-tab-")[1];
        (tab as HTMLElement).onclick = (e) =>
            showProfileTab(name);
    }
}

// Shows/hides a profile
export function showProfile(id: number) {
    showProfileTab("groups");
    const user = window.entityCache[id] as entities.User;
    const profile  = util.elmById("profile");
    const nickname = util.elmById("profile-nickname").classList;
    const tag      = util.elmById("profile-tag").classList;
    const note     = util.elmById("profile-note") as HTMLInputElement;
    const noteCl   = note.classList;
    const avatar   = util.elmById("profile-avatar").classList;
    const badges   = util.elmById("profile-badges");
    const groups   = util.elmById("profile-groups");
    const friends  = util.elmById("profile-friends");
    
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
    for(const c of noteCl.values())
        if(c.startsWith("user-note-"))
            noteCl.remove(c);
    // Add new classes so that updateUser() picks them up
    nickname.add("user-nickname-" + id);
    tag     .add("user-tag-"      + id);
    avatar  .add("user-avatar-"   + id);
    noteCl  .add("user-note-"     + id);
    // updateUser() also determines whether the user's favorite color is light or dark
    // we're going to use that to color our badge icons
    updateUser(id, (light) => {
        // Set text color
        util.elmById("profile").style.setProperty("--color", light ? "#000" : "#fff");
        // Remove old badges
        while(badges.firstChild)
        badges.firstChild.remove();
        // Add badges
        for(const bid of user.badges) {
            const file = path.join(window["__dirname"], "icons", "badges", ["verified", "staff", "bot", "tester"][bid - 1] + ".png")
            const hint = ["This user is who they claim to be",
                        "This user is a member of the core Yamka team",
                        "This user is a bot",
                        "This user has helped test the software"][bid - 1];

            const iconElm = document.createElement("img");
            iconElm.src = "file://" + file;
            badges.appendChild(iconElm);
            layout.addHint(iconElm, hint);
            if(light)
                iconElm.classList.add("dark");
        }
    }, true);
    // Hide the note editor if we're viewing ourselves
    note.style.display = id === window.selfId ? "none" : "";

    // Remove old mutual servers/friends
    while(groups.firstChild)
        groups.firstChild.remove();
    while(friends.firstChild)
        friends.firstChild.remove();
    // Add mutual groups and friends
    for(const gid of user.groups) {
        const elm = document.createElement("div");
        elm.classList.add("mutual-thing");
        const group = window.entityCache[gid] as entities.Group;
        util.download(group.icon, (icon) =>
            elm.innerHTML = `<img src="${icon}"/> ${util.escapeHtml(group.name)}`);
        elm.onclick = (e) => {
            hideProfile();
            window.viewingGroup = gid;
            window.viewingChan = group.channels[0];
            layout.updLayout();
        }
        groups.appendChild(elm);
    }
    for(const fid of user.friends) {
        const elm = document.createElement("div");
        elm.classList.add("mutual-thing");
        const user = window.entityCache[fid] as entities.User;
        util.download(user.avaFile, (icon) =>
            elm.innerHTML = `<img src="${icon}"/> ${util.escapeHtml(user.name)}`);
        elm.onclick = (e) => showProfile(fid);
        friends.appendChild(elm);
    }

    // Update the note on tag editor defocus
    note.value = user.note ?? "";
    util.resizeSingleLineInput(note);
    note.onblur = () => {
        const noteUser = new entities.User();
        noteUser.id = id;
        noteUser.note = note.value;
        util.putEntities([noteUser]);
        (window.entityCache[id] as entities.User).note = note.value;
        updateUser(id);
    }
    note.oninput = () => util.resizeSingleLineInput(note);

    // Copy the name#tag when clicked
    util.elmById("profile-nickname").onclick = (e) => {
        clipboard.writeText(`${user.name}#${user.tag}`);
        notif.show("Copied", "icons/approve.png", "green");
    };

    util.triggerAppear(profile, true);
}

export function hideProfile() {
    const profile = util.elmById("profile");
    util.triggerDisappear(profile, true);
}

// Show/hides a floating image
export function showFloatingImage(id: number) {
    // Remove the old image
    const floatingImageBg = util.elmById("floating-image-bg");
    var floatingImage = util.elmById("floating-image");
    if(floatingImage)
        floatingImage.remove();

    // Create the image
    util.download(id, (blob) => {
        floatingImage = document.createElement("img");
        floatingImage.id = "floating-image";
        (floatingImage as HTMLImageElement).src = "file://" + blob;
        floatingImageBg.appendChild(floatingImage);
        util.triggerAppear(floatingImage, true);
    })
}
export function hideFloatingImage() {
    const floatingImage = util.elmById("floating-image");
    if(floatingImage)
        util.triggerDisappear(floatingImage, true);
}

// Shows/hides the message history
export function showMessageHistory(id: number, x: number, y: number) {
    const msg     = window.entityCache[id] as entities.Message
    const history = util.elmById("message-history");
    const bg      = util.elmById("message-history-bg");

    while(history.lastChild) history.lastChild.remove();

    util.reqEntities(msg.states.sort().reverse().map(x =>
                new packets.EntityGetRequest(entities.MessageState.typeNum, x)), false, () => {
        const states = msg.states.map(x => window.entityCache[x] as entities.MessageState);
        for(const state of states) {
            const marker = state.id == msg.latest.id ? "&nbsp;· LATEST" : "";
            const elm = document.createElement("div");
            elm.classList.add("message-state");
            elm.innerHTML = `<span>${util.idToTime(state.id)}<span class="current">${marker}</span>
                </span><span>${util.messageStateSummary(state)}</span>`;
            elm.onclick = (e) => showFloatingMessage(state);
            history.appendChild(elm);
        }

        history.style.right  = `${window.innerWidth  - x}px`;
        history.style.bottom = `${window.innerHeight - y}px`;
        util.triggerAppear(history, true);

        bg.onclick = (e) => util.triggerDisappear(history, true);
    });
}
export function hideMessageHistory() {

}

// Creates an element that should be placed in the member list
export function createUserSummary(id: number, special?: string, showUnread: boolean =false) {
    // Elements applied to all users
    const user = window.entityCache[id] as entities.User;
    const dm = window.entityCache[user.dmChannel] as entities.Channel;
    const elm = document.createElement("div");
    elm.classList.add("user-summary", "user-summary-" + id);

    const avaContainer = document.createElement("div");
    avaContainer.classList.add("user-avatar-container");
    elm.appendChild(avaContainer);

    const ava = document.createElement("img");
    ava.classList.add("user-avatar", "user-avatar-" + id);
    avaContainer.appendChild(ava);

    if(showUnread && dm !== undefined) {
        const bubble = document.createElement("div");
        bubble.classList.add("bubble", "bubble-" + id);
        if(dm.unread === 0) bubble.classList.add("hidden");
        avaContainer.appendChild(bubble);

        const cnt = document.createElement("span");
        cnt.classList.add("bubble-cnt-" + id);
        bubble.appendChild(cnt);
        cnt.innerHTML = util.escapeHtml(`${dm.unread}`);
    }

    const status = document.createElement("img");
    status.classList.add("user-online", "user-online-" + id);
    avaContainer.appendChild(status);

    const statusText = document.createElement("span");
    statusText.classList.add("user-status", "user-status-" + id);
    elm.appendChild(statusText);

    const nicknameContainer = document.createElement("div");
    nicknameContainer.classList.add("flex-row", "user-nickname-container");
    elm.appendChild(nicknameContainer);

    const verifiedBadge = document.createElement("img");
    verifiedBadge.classList.add("verified-badge", "verified-badge-" + id, "cg-img");
    verifiedBadge.src = path.join(window["__dirname"], "icons/badges/verified.png");
    nicknameContainer.appendChild(verifiedBadge);

    const nickname = document.createElement("span");
    nickname.classList.add("user-nickname", "user-nickname-" + id);
    nicknameContainer.appendChild(nickname);

    const tag = document.createElement("span");
    tag.classList.add("user-tag", "user-tag-" + id);
    nicknameContainer.appendChild(tag);

    const openDm = () => {
        const channel = window.entityCache[id].dmChannel;
        util.reqEntities([new packets.EntityGetRequest(entities.Channel.typeNum, channel)], false, () => {
            window.viewingChan = channel;
            layout.updLayout();
        });
    };

    // Special users (friends, pending, blocked)
    if(special !== undefined) {
        const friendRemoveBtn = document.createElement("button");
        friendRemoveBtn.classList.add("icon-button", "cg-button",
                "friend-remove-button", "hover-show-button");
        friendRemoveBtn.addEventListener("click", (e) => {
            const box = util.elmById("contact-remove-box");
            const title = {
                "friend":      `Do you really want to remove ${user.name} from your friend list?`,
                "pending-in":  `Do you really want to deny ${user.name}'s friend request?`,
                "pending-out": `Do you really want to cancel your friend request to ${user.name}?`,
                "blocked":     `Do you really want to unblock ${user.name}?`,
            }[special];
            util.elmById("contact-remove-title").innerHTML = util.escapeHtml(title);
            util.triggerAppear(box, true);
            util.elmById("contact-remove-confirm").onclick = () => {
                yGlobal.sendPacket(new packets.ContactsManagePacket({
                        "friend":      packets.ContactType.FRIEND,
                        "pending-in":  packets.ContactType.PENDING_IN,
                        "pending-out": packets.ContactType.PENDING_OUT,
                        "blocked":     packets.ContactType.BLOCKED,
                    }[special],
                    packets.ContactAction.REMOVE, id));
                util.triggerDisappear(box, true);
            };
            util.elmById("contact-remove-cancel").onclick = () =>
                util.triggerDisappear(box, true);
            util.stopPropagation(e);
        });
        layout.addHint(friendRemoveBtn, {
            "friend":      "Remove friend",
            "pending-in":  "Deny friend request",
            "pending-out": "Cancel friend request",
            "blocked":     "Unblock",
        }[special]);
        elm.appendChild(friendRemoveBtn);

        const friendRemoveImg = document.createElement("img");
        friendRemoveImg.src = path.join(window["__dirname"], "icons/friend_remove.png");
        friendRemoveBtn.appendChild(friendRemoveImg);
    }
    // Pending in users (add an accept button)
    if(special === "pending-in") {
        const friendAcceptBtn = document.createElement("button");
        friendAcceptBtn.classList.add("hover-show-button", "icon-button",
                "cg-button", "friend-accept-button");
        friendAcceptBtn.onclick = (e) => {
            yGlobal.sendPacket(new packets.ContactsManagePacket(packets.ContactType.FRIEND,
                packets.ContactAction.ADD, id));
            util.stopPropagation(e);
        };
        layout.addHint(friendAcceptBtn, "Accept friend request");
        elm.appendChild(friendAcceptBtn);

        const friendAcceptImg = document.createElement("img");
        friendAcceptImg.src = path.join(window["__dirname"], "icons/approve.png");
        friendAcceptBtn.appendChild(friendAcceptImg);
    }

    elm.onclick = (e) => (special === "friend") ? openDm() : showProfile(id);

    const isFriend = remote.getGlobal("sweet").self.friends.includes(id);
    var contextMenu: context.Entry[] = [
        new context.ButtonEntry("Profile", showProfile, [id])
    ];

    if(isFriend) contextMenu.push(new context.ButtonEntry("Open DM", openDm));

    if(isFriend)
        contextMenu.push(new context.ButtonEntry(`Remove friend`,
            yGlobal.sendPacket, [new packets.ContactsManagePacket(
                packets.ContactType.FRIEND, packets.ContactAction.REMOVE,
                id)]));
    else
        contextMenu.push(new context.ButtonEntry(`Add friend`,
            yGlobal.sendPacket, [new packets.SearchPacket(
                packets.SearchTarget.USER, 0, `${user.name}#${user.tag}`)]));

    contextMenu.push(new context.Separator());
    contextMenu.push(new context.ButtonEntry("Copy ID", clipboard.writeText, [`${id}`]));

    context.addRightClickMenu(elm, contextMenu);

    return elm;
}

export function createUserSummaryPlaceholder() {
    const div = document.createElement("div");
    div.classList.add("user-summary", "loading");
    return div;
}

export function createChannelButton(id: number, clickCb:
        (this: GlobalEventHandlers, ev: MouseEvent) => any, highlightSelected: boolean =true): HTMLDivElement {
    const channel = window.entityCache[id];

    const elm = document.createElement("div");
    elm.classList.add("channel-button");
    if(window.viewingChan === id && highlightSelected)
        elm.classList.add("channel-button-selected");
        
    elm.innerHTML = util.escapeHtml(channel.name);
    elm.onclick = clickCb;

    return elm;
}

// Creates a group panel
export function createGroupPanel(id: number) {
    const group = window.entityCache[id] as entities.Group;
    const panel = document.createElement("div");
    panel.classList.add("group-panel");

    const top = document.createElement("div"); panel.appendChild(top);
    const icon = document.createElement("img"); top.appendChild(icon);
    util.download(group.icon, (s) => icon.src = "file://" + s);
    const nameUnread = document.createElement("div"); top.appendChild(nameUnread);

    const name = document.createElement("span"); nameUnread.appendChild(name);
    name.innerHTML = util.escapeHtml(group.name);
    const unread = document.createElement("span"); nameUnread.appendChild(unread);

    // Fetch the channels to determine how many messages are unread
    util.reqEntities(group.channels.map(x => new packets.EntityGetRequest(entities.Channel.typeNum, x)), false, (e) => {
        var unreadMsgs = 0, unreadChans: {t: string, u: number, i: number, m:number}[] = [];
        var mentionCnt = 0;
        for(const c of e) {
            const chan = c as entities.Channel;
            unreadMsgs += chan.unread;
            mentionCnt += chan.mentions.length;
            if(chan.unread > 0)
                unreadChans.push({
                    t: chan.name,
                    u: chan.unread,
                    i: chan.id,
                    m: chan.mentions.length
                });
        }

        const mentions = (mentionCnt === 0) ? "" : `<span class="group-bubble">${mentionCnt}</span>`;

        unread.innerHTML = `<img src="icons/message.png" class="cg-img"/> ${util.escapeHtml(unreadMsgs)} NEW` + 
                           mentions + `<img src="icons/channel.png" class="cg-img"/> ${unreadChans.length}</span>`

        // Create the bottom panel
        if(unreadChans.length === 0) {
            panel.classList.add("bottomless");
            return;
        }

        const bottom = document.createElement("div"); panel.appendChild(bottom);
        var i; // to reference the leftover channel count later
        unreadChans = unreadChans.sort((a, b) => b.u - a.u); // reverse sort by unread count (most uptop)
        for(i = 0; i < Math.min(5, unreadChans.length); i++) {
            const desc = unreadChans[i];
            const chan = document.createElement("div"); bottom.appendChild(chan);
            chan.classList.add("gp-channel");
            const bubble = (mentionCnt === 0) ? "" : `<span class="channel-bubble">${desc.m}</span>`;
            chan.innerHTML = `<img src="icons/channel.png" class="cg-img"/>${util.escapeHtml(desc.t)} • ${util.escapeHtml(desc.u)}${bubble}`;
            chan.onclick = (e) => {
                window.viewingGroup = id;
                window.viewingChan = desc.i;
                layout.updLayout();
            }
        }

        const left = unreadChans.length - i;
        if(left !== 0) {
            const more = document.createElement("div"); bottom.appendChild(more);
            more.classList.add("gp-channel", "more");
            more.innerHTML = `${util.escapeHtml(left)} MORE`;
        }
    });

    panel.onclick = (e) => {
        window.viewingGroup = id;
        window.viewingChan = group.channels[0];
        layout.updLayout();
    }

    context.addRightClickMenu(panel, [
        new context.ButtonEntry(`Leave ${group.name}`, yGlobal.sendPacket, [new packets.ContactsManagePacket(
                packets.ContactType.GROUP, packets.ContactAction.REMOVE, id)]),
        new context.Separator(),
        new context.ButtonEntry("Copy ID", clipboard.writeText, [`${id}`])
    ]);

    return panel;
}
    
// Creates an "unread separator"
export function createUnreadSep() {
    const sep = document.createElement("div");
    sep.id = "message-unread-sep";
    const bubble = document.createElement("div");
    bubble.classList.add("bubble");
    sep.appendChild(bubble);
    const bubbleCnt = document.createElement("span");
    bubbleCnt.innerHTML = util.escapeHtml(" NEW ↴");
    bubble.appendChild(bubbleCnt);

    return sep;
}

// Creates a permission switch
export function createPermissionSwitch(onChanged: (status: types.PermissionStatus) => any) {
    const name = Math.random().toString(32).substr(2, 8);
    const elm = document.createElement("span");
    elm.id = `perm-switch-${name}`;
    elm.classList.add("radio-switch");
}

export function updAgentList() {
    const agentList = util.elmById("agent-list");
    while(agentList.firstChild) agentList.firstChild.remove();

    const agentIds: number[] = remote.getGlobal("sweet").self.agents
    util.reqEntities(agentIds.map(x => new packets.EntityGetRequest(entities.Agent.typeNum, x)), false, (agents) => {
        for(const agent of (agents as entities.Agent[])) {
            const div = document.createElement("div");
            const icon = agent.type > 7 ? "unknown" :
                ["linux", "windows", "macos", "desktop", "android", "ios", "mobile", "mcu", "app"][agent.type];
            // Display:
            // 1) icon
            // 2) name
            // 3) a left arrow if that's the current agent
            // 4) a green circle if that agent is online
            // 5) a button to unlink the agent if that's NOT the current one
            const thisAgent = remote.getGlobal("sweet").agentId == agent.id;
            div.innerHTML = `<img src="icons/agents/${icon}.png"/>
                <span>${util.escapeHtml(agent.name)}</span>
                ${agent.online ? "<img src=\"icons/online.png\">" : ""}
                ${thisAgent ? "<img class=\"cg-img\" src=\"icons/agents/this.png\">" : ""}
                ${thisAgent ? "" : "<button class=\"icon-button cg-button\"><img src=\"icons/disconnect.png\"/></img></button>"}`;
            // The unlinking button should do something
            const unlink = div.querySelector("button");
            if(unlink !== null) unlink.onclick = (e) => {
                util.stopPropagation(e);
                const user = new entities.User();
                user.id = 0;
                user.agents = agentIds.filter(x => x !== agent.id);
                util.putEntities([user]);
            };
            agentList.appendChild(div);
        }
    });
}