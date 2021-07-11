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

// Updates the member list sidebar
export function updMemberList() {
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

    if(window.viewingGroup === 0) {
        const memberList = util.elmById("member-list-bar");

        // Remove all previous members
        while(memberList.firstChild)
            memberList.removeChild(memberList.firstChild);

        // Determine what users should end up in the member list
        const self = remote.getGlobal("sweet").self;
        const friendType = util.elmById("member-list-friend-type");

        friendType.innerHTML = util.escapeHtml(
            ["ALL FRIENDS",
                "ONLINE FRIENDS",
                "INCOMING REQUESTS",
                "OUTGOING REQUESTS",
                "BLOCKED"][window.viewingContactGroup]);
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
            const elm = domUtil.createChannelButton(chanId, (e) => { window.viewingChan = chanId; updLayout() })
            elm.style.animationDelay = (0.2 * channels.indexOf(chanId) / channels.length) + "s";
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
export function updMessageArea(updMessages: boolean =true) {
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
            if(child.id != "message-area-header")
                child.remove();
        }
        return;
    }

    // Set "join voice" button visibility
    util.setElmVisibility(util.elmById("message-area-voice"), chan.voice);
    util.setElmVisibility(util.elmById("message-area-e2ee"), chan.group === 0);

    // Get channel messages
    if(window.viewingChan !== 0 && updMessages)
        appendMsgsTop(0xFFFFFFFFFFFFF, () => util.markRead(window.viewingChan, true), true);

    util.reqEntities([new packets.EntityGetRequest(entities.Channel.typeNum, window.viewingChan)], false, () => {
        const channel = window.entityCache[window.viewingChan];
        // Show the list of people that are typing
        const typingElm  = util.elmById("channel-typing");
        const typingAnim = util.elmById("typing-dots");
        const typing = channel.typing.filter(x => x !== remote.getGlobal("sweet").self.id);
        util.reqEntities(typing.map(x => new packets.EntityGetRequest(entities.User.typeNum, x)), false, () => {
            var content = "";
            const verb = (typing.length === 1) ? "is" : "are";
            if(typing.length > 0) {
                content = "<b>" + typing.map(x => util.escapeHtml(window.entityCache[x].name)).join("</b>, <b>") + "</b> " + verb + " typing";
                util.showElm(typingAnim);
            } else
                util.hideElm(typingAnim);
            typingElm.innerHTML = content;
        });
    });
}

// Updates the group list
export function updGroupList() {
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
export function appendMembersBottom(role: number, id_from: number, callback?: () => void, clear: boolean =false) {
    const memberList = util.elmById("member-list-bar")
    
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
                    if(child.id != "message-area-header")
                        child.remove();
                }
            }

            msgs.reverse();
            msgs = msgs.map(x => window.entityCache[x.id]);
            msgs.forEach((msg: entities.Message) => {
                const id = msg.id;
                const lastMsg = msgs[msgs.indexOf(msg) + 1];
                const short = lastMsg ? (msg.sender === lastMsg.sender
                    && util.timeDiff(lastMsg.id, msg.id) <= messageTimeThres) : false; // bundling
                const msgElm = domMsgUtil.createMessage(msg.latest, short);
                if(msgElm !== undefined)
                    header.after(msgElm);

                const chan = window.entityCache[msg.channel] as entities.Channel;
                if(id === chan.firstUnread && chan.unread > 0)
                    header.after(domUtil.createUnreadSep());
                    domUtil.updateRelatedUsers(msg.latest);
            });

            if(msgs.length > 0) {
                window.lastChanSender[window.viewingChan] = msgs[0].sender;
                window.lastChanMsg   [window.viewingChan] = msgs[0].id;
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

function fitColor(c: number) {
    return c >= 128 ? c : Math.min(c * 2, 255);
}
function hashRandomart(data: Uint8Array) {
    const w = 3, h = 3;
    const cw = 48, ch = 48;
    if(data.length < w * h * 3) throw new Error("Expected data length to be at least w*h*3 bytes");

    const canv = document.createElement("canvas");
    canv.width  = cw * w;
    canv.height = ch * h;
    const ctx = canv.getContext("2d");

    for(var y = 0; y < h; y++) {
        for(var x = 0; x < w; x++) {
            const r = fitColor(data[(y * w) + x + 0]);
            const g = fitColor(data[(y * w) + x + 1]);
            const b = fitColor(data[(y * w) + x + 2]);
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.fillRect(x * cw, y * ch, cw, ch);
        }
    }

    // The canvas gets blurred in CSS, so we get a nice colorful gradient
    // instead of a sharp image

    return canv;
}

const ipcRenderer_layout = window["_modules"].electron.ipcRenderer;
export function showE2eeInfo(ev: MouseEvent) {
    const info: {
        incomplete: boolean,
        checkString: string,
        checkBuf: Uint8Array
    } = ipcRenderer_layout.sendSync("synchronous-message", {
        action: "salty.convInfo",
        cid: window.viewingChan
    });

    const div = document.createElement("div");
    div.classList.add("e2ee-info");

    const title = document.createElement("span");
    div.appendChild(title);
    title.innerHTML = info.incomplete ? `
        This direct message conversation is getting set up to use end-to-end
        encryption.
    ` : `
        This direct message conversation is end-to-end encrypted.
        Nobody (even us) can read it except you and the person
        you're communicating with.
        You can make sure this is true by comparing this string
        and/or colorful image to what's displayed on their screen
        in real life or using another app.
    `;

    if(!info.incomplete) {
        const str = document.createElement("code");
        div.appendChild(str);
        str.innerHTML = util.escapeHtml(info.checkString);
    
        const randomart = hashRandomart(info.checkBuf);
        div.appendChild(randomart);
    }

    div.onclick = (e) => util.stopPropagation(e);
    popups.createWrapper(ev.x, ev.y, div);
}