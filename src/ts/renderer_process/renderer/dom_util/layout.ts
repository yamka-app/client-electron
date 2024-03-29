// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Layout DOM utils
// for the specific elements of the app's layout

const _modules = window["_modules"];
const remote         = _modules.remote;

import * as util       from "../util.js";
import * as domUtil    from "./dom_util.js";
import * as domMsgUtil from "./msg_util.js";
import * as packets    from "../../protocol.s/packets.s.js";
import * as entities   from "../../protocol.s/entities.s.js";
import * as popups     from "../popups.js";
import * as i18n       from "./i18n.js";

// Updates the member list sidebar
export function updMemberList() {
    console.log("Updating member list");

    // Show or hide the friend hedaer
    const friendHeader = util.elmById("member-list-friend-header");
    const friendType   = util.elmById("member-list-friend-type");
    const groupHeader  = util.elmById("member-list-group-header");
    
    if(window.viewingGroup === 0) {
        util.showElm(friendHeader);
        util.showElm(friendType);
        util.hideElm(groupHeader);
    } else {
        util.hideElm(friendHeader);
        util.hideElm(friendType);
        util.showElm(groupHeader);
    }

    // Remove all previous members
    const memberList = util.elmById("member-list-bar");
    while(memberList.firstChild)
        memberList.removeChild(memberList.firstChild);

    if(window.viewingGroup === 0) {
        // Determine what users should end up in the member list
        const self = remote.getGlobal("sweet").self;
        const friendType = util.elmById("member-list-friend-type");

        friendType.setAttribute("x-key",
            "member_area.contacts." + ["all", "online", "pending", "sent", "blocked"][window.viewingContactGroup]);
        i18n.formatElement(friendType);
        const userIds =
            [self.friends,
                self.friends,
                self.pendingIn,
                self.pendingOut,
                self.blocked][window.viewingContactGroup];

        // Request users
        const users = userIds.map(id => new packets.EntityGetRequest(entities.User.typeNum, id));
        util.reqEntities(users, false, () => {
            // Request channels (we want to be able to show the unread count right away)
            const dms = userIds.map(id => new packets.EntityGetRequest(entities.Channel.typeNum,
                (window.entityCache[id] as entities.User).dmChannel)).filter(x => x.id !== undefined);
            util.reqEntities(dms, false, () => {
                // Create summaries for each one and append them to the member list
                userIds.forEach(id => {
                    if(window.viewingGroup === 0) { // special case for DMs
                        let add = true;
                        if(window.viewingContactGroup == 1 && window.entityCache[id].status === 0) // don"t add offline friends if we only want to see online ones
                            add = false;
                        if(add) {
                            memberList.appendChild(domUtil.createUserSummary(
                                id, ["friend", "friend", "pending-in", "pending-out", "blocked"][window.viewingContactGroup],
                                true
                            ));
                            domUtil.updateUser(id);
                        }
                    } else {
                        const elm = domUtil.createUserSummary(id);
                        elm.style.animationDelay = (0.2 * userIds.indexOf(id) / userIds.length) + "s";
                        memberList.appendChild(elm);
                    }
                });
            });
        });
    } else {
        appendMembersBottom(window.entityCache[window.viewingGroup].everyoneRole, 0, undefined, true);
    }
}

// Updates the channel list
export function updChannelList() {
    console.log("Updating channel list");

    // Show or hide the channel list
    const channelListSidebar = util.elmById("channel-list-sidebar");
    util.setElmVisibility(channelListSidebar, window.viewingGroup !== 0);

    if(window.viewingGroup === 0)
        return;

    const channelList = util.elmById("channel-list");
    const groupName = util.elmById("group-name");

    // Show the server name
    groupName.innerHTML = util.escapeHtml(window.entityCache[window.viewingGroup].name);

    // Request the channels of the group the user is viewing
    const channels = window.entityCache[window.viewingGroup].channels;
    util.reqEntities(channels.map(x => new packets.EntityGetRequest(entities.Channel.typeNum, x)), false, () => {
        // Delete old icons
        while(channelList.firstChild)
            channelList.firstChild.remove();
        // Add new ones
        for(let chanId of channels) {
            const elm = domUtil.createChannelButton(chanId, (e) => {
                window.viewingChan = chanId;
                updLayout();
            });
            channelList.append(elm);

            if(window.entityCache[chanId].rules) {
                const rulesBtn = document.createElement("button");
                rulesBtn.classList.add("apply-button", "rules-accept-button");
                rulesBtn.innerHTML = "Accept group rules";
                channelList.append(rulesBtn);
            }
        }
    });
}

// Updates the message area
export function updMessageArea(updMessages = true) {
    console.log("Updating message area");

    const chan = window.entityCache[window.viewingChan] as entities.Channel;

    // Hide the panel list if we're viewing messages
    util.setElmVisibility(util.elmById("message-container-area"), window.viewingChan !== 0);

    if(window.viewingChan !== window.previousChannel && window.previousChannel !== 0)
        util.markRead(window.previousChannel);
    window.previousChannel = window.viewingChan;

    if(window.viewingChan === 0) {
        const msgArea = util.elmById("message-area");
        for(var i = msgArea.children.length - 1; i >= 0; i--) {
            const child = msgArea.children[i];
            if(child.id !== "message-area-header")
                child.remove();
        }
        return;
    }

    const e2eeReady = (chan.group !== 0) || chan.__e2eeReady;
    util.setElmVisibility(util.elmById("message-input-popup"), e2eeReady);
    util.setElmVisibility(util.elmById("e2ee-placeholder"), !e2eeReady);

    // Set "join voice" button visibility
    util.setElmVisibility(util.elmById("message-area-voice"), chan.voice);
    util.setElmVisibility(util.elmById("message-area-e2ee"), chan.group === 0);

    // Get channel messages
    if(window.viewingChan !== 0 && updMessages)
        appendMsgsTop(0xFFFFFFFFFFFFF, () => util.markRead(window.viewingChan, true), true);

    util.reqEntities([new packets.EntityGetRequest(entities.Channel.typeNum, window.viewingChan)], false, () => {
        const channel = window.entityCache[window.viewingChan] as entities.Channel;
        // Show the list of people that are typing
        const typingElm = util.elmById("channel-typing");
        const typingAnim = util.elmById("typing-dots");
        // const typing = channel.typing;
        const typing = channel.typing.filter(x => x !== remote.getGlobal("sweet").self.id);
        util.reqEntities(typing.map(x => new packets.EntityGetRequest(entities.User.typeNum, x)), false, () => {
            if(typing.length >= 5) {
                typingElm.setAttribute("x-key", "message_input.typing.number");
                i18n.formatElement(typingElm, {num: `${typing.length}`});
                util.showElm(typingAnim);
            } else if(typing.length > 1) {
                typingElm.setAttribute("x-key", "message_input.typing.plural");
                i18n.formatElement(typingElm, {
                    name: typing.map(x => entityCache[x].name).join(", ")
                });
                util.showElm(typingAnim);
            } else if(typing.length === 1) {
                typingElm.setAttribute("x-key", "message_input.typing.singular");
                i18n.formatElement(typingElm, {name: entityCache[typing[0]].name});
                util.showElm(typingAnim);
            } else { // 0
                typingElm.setAttribute("x-key", "");
                i18n.formatElement(typingElm, {});
                util.hideElm(typingAnim);
            }
        });
    });
}

// Updates the group list
export function updGroupList() {
    console.log("Updating group list");

    const groupPanels = util.elmById("group-panel-area");

    // Hide the panel list if we're viewing messages
    util.setElmVisibility(groupPanels, window.viewingChan === 0);

    // Request the groups the user's in
    const groups = remote.getGlobal("sweet").self.groups;
    util.reqEntities(groups.map(x => new packets.EntityGetRequest(entities.Group.typeNum, x)), false, () => {
        // Delete old panels except for the "create" one
        for(var i = groupPanels.children.length - 1; i >= 0; i--) {
            const child = groupPanels.children[i];
            if(!child.classList.contains("group-action-panel"))
                child.remove();
        }
        // Add new ones
        for(const groupId of groups)
            groupPanels.append(domUtil.createGroupPanel(groupId));
    })
}

// Updates the layout: member list, messages, etc.
export function updLayout() {
    console.log("Updating layout, gId=" + window.viewingGroup + ", cId=" + window.viewingChan + ", cgId=" + window.viewingContactGroup);

    updMemberList();
    updChannelList();
    updMessageArea();
    updGroupList();
}

// Fetches and appends members to the bottom
export function appendMembersBottom(role: number, id_from: number, callback?: () => void, clear = false) {
    const memberList = util.elmById("member-list-bar");

    // Create placeholders
    const placeholders: HTMLDivElement[] = [];
    for(var i = 0; i < 50; i++) {
        const p = domUtil.createUserSummaryPlaceholder(i * 20);
        placeholders.push(p);
        memberList.appendChild(p);
    }
    
    util.reqEntities([new packets.EntityGetRequest(entities.Role.typeNum, role,
            new packets.EntityPagination(6 /* members */,
                packets.EntityPaginationDirection.UP, id_from, 50))], true, () => {
        var members = [...window.entityCache[role].members];
        members.sort();
        members = members.map(x => new packets.EntityGetRequest(entities.User.typeNum, x));
        // Request members
        util.reqEntities(members, false, () => {
            // Clear previous members if needed
            if(clear) {
                while(memberList.firstChild)
                    memberList.firstChild.remove();
            }

            // Remove placeholders
            for(const p of placeholders)
                p.remove();

            // Append real summaries
            members = members.map(x => window.entityCache[x.id]);
            members.forEach(member => {
                const id = member.id;
                const elm = domUtil.createUserSummary(id);

                elm.style.animationDelay = (0.2 * members.indexOf(member) / members.length) + "s";
                memberList.appendChild(elm);
                // Force user color (no need to request it since we know it from the role already)
                window.entityCache[id].color = window.entityCache[role].color;
                domUtil.updateUser(id);
            })

            // Call the callback
            if(callback !== undefined)
                callback();
        })
    })
}

// Fetches and appends messages to the top
export const messageTimeThres: number = 300000;
export function appendMsgsTop(id_from: number, callback?: () => void, clear: boolean =false) {
    window.fetchingMsgs = true;
    const msgArea = util.elmById("message-area");
    const header = util.elmById("message-area-header");
    
    util.reqEntities([new packets.EntityGetRequest(entities.Channel.typeNum, window.viewingChan,
            new packets.EntityPagination(4 /* messages */,
                packets.EntityPaginationDirection.DOWN, id_from, 50))], true, () => {
        var msgs = [...window.entityCache[window.viewingChan].messages];
        msgs.sort();
        msgs = msgs.map(x => new packets.EntityGetRequest(entities.Message.typeNum, x));
        // Request messages
        util.reqEntities(msgs, false, () => {
            // Clear previous messages if needed
            if(clear) {
                for(var i = msgArea.children.length - 1; i >= 0; i--) {
                    const child = msgArea.children[i];
                    if(child.id !== "message-area-header")
                        child.remove();
                }
            }

            msgs.reverse();
            msgs = msgs.map(x => window.entityCache[x.id]);
            msgs.forEach((msg: entities.Message) => {
                const id = msg.id;
                const lastMsg = msgs[msgs.indexOf(msg) + 1];
                const short = lastMsg ? (msg.sender === lastMsg.sender
                    && util.timeDiff(lastMsg.id, msg.id) <= messageTimeThres) : false;

                const chan = window.entityCache[msg.channel] as entities.Channel;
                if(id === chan.firstUnread && chan.unread > 0)
                    header.after(domUtil.createUnreadSep());

                const msgElm = domMsgUtil.createMessage(msg.latest, short);
                if(msgElm !== undefined)
                    header.after(msgElm);
                domUtil.updateRelatedUsers(msg.latest);
            });

            const vc = window.viewingChan;
            if(msgs.length > 0 && msgs[0].id > window.lastChanMsg[vc]) {
                window.lastChanSender[vc] = msgs[0].sender;
                window.lastChanMsg   [vc] = msgs[0].id;
            }

            // Request senders (uncached, because they might have different colors in different groups)
            if(window.viewingGroup !== 0) {
                let senders = msgs.map(x => new packets.EntityGetRequest(entities.User.typeNum, x.sender,
                    undefined, new packets.EntityContext(entities.Group.typeNum, window.viewingGroup)))

                // Only request those cached from a different group
                senders = senders.filter(x => window.entityCache[x.id] === undefined || window.entityCache[x.id].ctxGroup !== window.viewingGroup);
                senders = senders.filter((x, i, s) => s.findIndex(y => y.id === x.id) === i);
                if(senders.length > 0) {
                    util.reqEntities(senders, true, () => {
                        senders.forEach(x => window.entityCache[x.id].ctxGroup = window.viewingGroup)
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

// Generates random line art based on the conversation
// fingerprint. A snake starts off in the center pointed
// right. Grabs color, direction nudge and line length
// from input data.
// Go listen to Nurture by Porter Robinson.
function hashRandomart(data: Uint8Array) {
    const sz = 144;
    var x = sz / 2, y = sz / 2;
    var d = 0;

    const canv = document.createElement("canvas");
    canv.width  = sz;
    canv.height = sz;
    const ctx = canv.getContext("2d");
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, sz, sz);
    ctx.lineWidth = 1.5;

    for(var i = 0; i < data.length; i++) {
        const byte = data[i];
        d += ((byte & 3) - 1);
        const col = 128 + (((byte >> 2) & 15) * 8);
        const len = ((byte >> 6) & 3) * 2 + 1;
        const x1 = x, y1 = y;
        x += Math.cos(d) * len;
        y += Math.sin(d) * len;
        if(x < 0 || x >= sz || y < 0 || y >= sz)
            d -= Math.PI / 2;
        ctx.strokeStyle = `rgb(${col}, ${col}, ${col})`;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x, y);
        ctx.stroke();
    }

    return canv;
}

const ipcRenderer_layout = window["_modules"].electron.ipcRenderer;
export function showE2eeInfo(ev: MouseEvent) {
    const info: {
        checkString: string,
        checkBuf: Uint8Array
    } = ipcRenderer_layout.sendSync("synchronous-message", {
        action: "salty.convInfo",
        cid: window.viewingChan
    });

    const div = document.createElement("div");
    div.classList.add("e2ee-info");

    const title = document.createElement("span");
    const complete = (window.entityCache[window.viewingChan] as entities.Channel).__e2eeReady;
    div.appendChild(title);
    title.setAttribute("x-key", "e2ee_info." + (complete ? "complete" : "setup"));
    i18n.formatElement(title);

    if(complete) {
        const str = document.createElement("code");
        div.appendChild(str);
        str.innerHTML = util.escapeHtml(info.checkString);
    
        const randomart = hashRandomart(info.checkBuf);
        div.appendChild(randomart);
    }

    div.onclick = (e) => util.stopPropagation(e);
    popups.createWrapper(ev.x, ev.y, div);
}

export function addTooltip(elm: HTMLElement, tooltip?: string) {
    if(tooltip !== undefined)
        elm.setAttribute("x-tooltip", tooltip);
    popups.addHoverText(elm, tooltip ?? elm.getAttribute("x-tooltip"));
}
export function addTooltips() {
    const elms = document.querySelectorAll("[x-tooltip]");
    for(const elm of elms)
        popups.addHoverText(elm as HTMLElement, elm.getAttribute("x-tooltip"));
}