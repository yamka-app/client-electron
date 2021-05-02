// Message DOM utils
// for the specific elements of the app's layout

const _modules = window["_modules"];
const path           = _modules.path;
const twemoji        = _modules.twemoji;
const highlightBlock = _modules.highlightBlock;
const blurhash       = _modules.blurhash;
const remote         = _modules.remote;
const fs             = _modules.fs;

const { BrowserWindow, dialog } = remote;
const { shell, clipboard }      = _modules.electron;

import * as util     from "../util.js";
import * as packets  from "../../protocol.s/packets.s.js";
import * as entities from "../../protocol.s/entities.s.js";
import * as types    from "../../protocol.s/dataTypes.s.js";
import * as yGlobal  from "../yGlobal.js";
import { configGet } from "../settings.js";
import * as domUtil  from "./dom_util.js";
import * as layout   from "./layout.js";

// Creates a message box seen in the message area
export function createMessage(state: entities.MessageState, short: boolean =false): HTMLElement {
    // Get the message entity by the id
    const msg = window.entityCache[state.msg_id] as entities.Message;

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
        ava.onclick = (e) => { util.stopPropagation(e); domUtil.showProfile(msg.sender) };
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
        verifiedBadge.src = path.join(window["__dirname"], "icons/badges/verified.png");
        nicknameContainer.appendChild(verifiedBadge);

        const nickname = document.createElement("span");
        nickname.classList.add("message-user-nickname", "user-nickname-" + msg.sender);
        nicknameContainer.appendChild(nickname);

        const timeElm = document.createElement("span");
        timeElm.classList.add("message-time");
        timeElm.innerHTML = util.escapeHtml("· " + util.idToTime(state.msg_id) + ((msg.states.length > 1) ? " (edited)" : ""));
        nicknameContainer.appendChild(timeElm);
    }

    for(const section of state.sections) {
        const creationFunctions: ((s: types.MessageSection) => HTMLElement|undefined)[] = [
            createTextSection,   createFileSection,
            createCodeSection,   createQuoteSection,
            createInviteSection, createUserSection,
            createBotUiSection,  createPollSection
        ];

        const sectionElement = creationFunctions[section.type](section);
        if(sectionElement !== undefined)
            content.appendChild(sectionElement);
    }

    // Edit on double-click
    elm.ondblclick = () => {
        if(msg.sender === remote.getGlobal("webprotState").self.id)
            editMessage(state.msg_id)
    };

    parseLinks(elm, content);

    elm.appendChild(createMessageActionBar(state.msg_id));

    return elm;
}

function createTextSection(section: types.MessageSection) {
    const elm = document.createElement("div");
    elm.classList.add("message-text-section");
    const text = util.markupText(section.text);
    elm.innerHTML = text;
    twemoji.parse(elm, { folder: "svg", ext: ".svg" });
    util.formatMentions(elm);
    // If the text cosists of emojis only, increase their size
    if(util.allEmojiRegex.test(text)) {
        const emojis = elm.getElementsByTagName("img");
        for(const emoji of emojis)
            emoji.classList.add("large-emoji");
    }

    return elm;
}

function createCodeSection(section: types.MessageSection) {
    const wrapper = document.createElement("pre");

    const elm = document.createElement("pre");
    elm.classList.add("message-code-section");
    elm.innerHTML = util.prepareMsgText(section.text);
    highlightBlock(elm);
    wrapper.appendChild(elm);

    const copyButton = document.createElement("button");
    copyButton.classList.add("icon-button");
    copyButton.onclick = (e) => {
        util.stopPropagation(e);
        clipboard.writeText(section.text);
    };
    wrapper.appendChild(copyButton);

    const copyImg = document.createElement("img");
    copyImg.src = path.join(window["__dirname"], "icons/copy.png");
    copyButton.appendChild(copyImg);

    return wrapper;
}

function createFileSection(section: types.MessageSection) {
    const elm = document.createElement("div"); // a temporary replacement
    util.reqEntities([new packets.EntityGetRequest(entities.File.typeNum, section.blob)], false,
            (files) => {
        const file = files[0] as entities.File;
        // Check if it"s an image
        const extenstion = file.name.split(".").pop();
        if(["png", "jpeg", "jpg", "gif", "bmp"].includes(extenstion)) {
            const w = Number(file.size.split("x")[0]);
            const h = Number(file.size.split("x")[1]);
            elm.classList.add("message-img-section-container");

            /*const fake = document.createElement("img"); // to force container dimensions
            fileSectionElement.appendChild(fake);
            fake.classList.add("message-img-section-fake");
            fake.width = w; fake.height = h;*/
            
            // Create the preview element
            var canvasElement: HTMLCanvasElement;
            const imgElement = document.createElement("img");
            imgElement.classList.add("message-img-section");
            elm.appendChild(imgElement);
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
                //fake.src = canvasElement.toDataURL();
                imageObj.src = canvasElement.toDataURL();

                elm.appendChild(canvasElement);
            }

            // Download the image
            util.download(section.blob, (imgPath) => {
                imgElement.src = "file://" + imgPath;
                elm.appendChild(imgElement);
                // Deblur the preview element
                if(canvasElement)
                    canvasElement.classList.add("deblur");
                // Enlarge the image when clicking on it
                elm.onclick = (e) => {
                    util.stopPropagation(e);
                    domUtil.showFloatingImage(section.blob);
                }
            });
        } else {
            elm.classList.add("message-file-section", "flex-row");

            const info = document.createElement("div");
            info.classList.add("file-section-info", "flex-col");
            elm.appendChild(info);

            const sizeElm = document.createElement("div");
            sizeElm.classList.add("message-file-header");
            sizeElm.innerHTML = "File (" + util.readableFileSize(file.length) + ")";
            info.appendChild(sizeElm);

            const nameElm = document.createElement("code");
            nameElm.classList.add("file-section-name");
            nameElm.innerHTML = util.escapeHtml(file.name);
            info.appendChild(nameElm);

            const dlBtn = document.createElement("button");
            dlBtn.classList.add("icon-button", "file-dl-button");
            elm.appendChild(dlBtn);

            // Download the file
            dlBtn.onclick = (e) => {
                e.stopPropagation()
                // Ask where to save it
                var filePath = dialog.showSaveDialogSync(BrowserWindow.getFocusedWindow(), {
                    properties: [ "showOverwriteConfirmation", "createDirectory" ],
                    defaultPath: "~/" + file.name
                });
                // Don"t continue if the user decided not to
                if(filePath == undefined)
                    return;

                // Download the file
                util.download(section.blob, (blob) => fs.copyFileSync(blob, filePath));
            }

            const dlBtnIcon = document.createElement("img");
            dlBtnIcon.src = path.join(window["__dirname"], "icons/download.png");
            dlBtn.appendChild(dlBtnIcon);
        }
    });

    return elm;
}

function createQuoteSection(section: types.MessageSection) {
    const elm = document.createElement("div");
    elm.classList.add("message-quote-section");

    const txt = document.createElement("div");
    if(section.blob === 0)
        txt.innerHTML = util.markupText(section.text);
    twemoji.parse(txt, { folder: "svg", ext: ".svg" });
    elm.appendChild(txt);

    // If "blob" ID (actually message ID in this case) != 0 then show the message when clicking on it
    // also add the "*nickname* said on *time*:" thingy
    // and set the text
    if(section.blob !== 0) {
        elm.onclick = (e) => {
            e.stopImmediatePropagation();
            domUtil.showFloatingMessage((window.entityCache[section.blob] as entities.Message).latest);
        };
        util.reqEntities([new packets.EntityGetRequest(entities.Message.typeNum, section.blob)], false, () => {
            const replyMsg = window.entityCache[section.blob] as entities.Message;
            txt.innerHTML = util.markupText(util.messageStateSummary(replyMsg.latest));
            util.reqEntities([new packets.EntityGetRequest(entities.User.typeNum, replyMsg.sender)], false, () => {
                const replyAvaContainer = document.createElement("div");
                replyAvaContainer.classList.add("reply-avatar-container", "flex-row");
                elm.insertBefore(replyAvaContainer, txt);
        
                const replyAva = document.createElement("img");
                replyAva.classList.add("user-avatar", "tiny-avatar", "user-avatar-" + replyMsg.sender);
                replyAvaContainer.appendChild(replyAva);
                replyAva.onclick = (e) => { util.stopPropagation(e); domUtil.showProfile(replyMsg.sender) };

                const replyNickname = document.createElement("span");
                replyNickname.classList.add("message-user-nickname", "user-nickname-" + replyMsg.sender);
                replyAvaContainer.appendChild(replyNickname);

                const replySaid = document.createElement("span");
                replySaid.classList.add("message-time");
                replySaid.innerHTML = util.escapeHtml(`said on ${util.idToTime(replyMsg.id)}:`);
                replyAvaContainer.appendChild(replySaid);
            });
        });
    }

    return elm;
}

function createInviteSection(section: types.MessageSection) {
    const code = section.text;
    const elm = document.createElement("div");
    elm.classList.add("group-invite");

    yGlobal.sendPacket(new packets.InviteResolvePacket(code, false), (reply: packets.EntitiesPacket) => {
        const group = reply.entities[0] as entities.Group;
        const joined = yGlobal.self().groups.includes(group.id);
        
        util.download(group.icon, (iconPath) => {
            elm.innerHTML = `
                <img src="${iconPath}"/>
                <span>${group.name}</span>
            `;
            const join = document.createElement("button");
            if(!joined) {
                join.classList.add("apply-button");
                join.innerText = "Join";
                join.onclick = (e) => yGlobal.sendPacket(new packets.InviteResolvePacket(code, true), (r) => {
                    viewingGroup = group.id;
                    viewingChan = group.channels[0];
                    layout.updLayout();
                });
            } else {
                join.innerText = "Already joined";
            }
            elm.appendChild(join);
        });
    });

    return elm;
}

function createUserSection(section: types.MessageSection) {
    return undefined; // stub
}

function createBotUiSection(section: types.MessageSection) {
    return undefined; // stub
}

function createPollSection(section: types.MessageSection) {
    return createPoll(section.blob);
}

function createPoll(id: number) {
    const elm = document.createElement("div");
    elm.classList.add("message-poll-section", `poll-${id}`);

    util.reqEntities([new packets.EntityGetRequest(entities.Poll.typeNum, id)], false, (e) => {
        const poll = e[0] as entities.Poll;
        poll.options.forEach((v, i) => {
            const percent = Math.floor(100 * poll.optionVotes[i] / poll.totalVoted);
            const optionElm = document.createElement("div");
            elm.appendChild(optionElm);
            optionElm.innerHTML = `${util.escapeHtml(v)} <span>· ${poll.optionVotes[i]} (${percent}%)</span>`;
            optionElm.onclick = (evt) => {
                util.stopPropagation(evt);
                const vote = new entities.Poll();
                vote.id = id;
                vote.selfVote = i;
                util.putEntities([vote]);
            };
        });

        const total = document.createElement("span");
        total.innerHTML = `${util.escapeHtml(poll.totalVoted)} total votes`;
        elm.appendChild(total);
    });

    return elm;
}

export function updatePolls(id: number) {
    const polls = document.getElementsByClassName(`poll-${id}`);
    for(const poll of polls)
        poll.parentNode.replaceChild(createPoll(id), poll);
}

function parseLinks(elm: HTMLElement, whereToInsert: HTMLElement) {
    // When clicking a link, open it in the user's browser
    const links = elm.getElementsByTagName("a");
    for(const link of links) {
        const href = link.href;
        link.removeAttribute("href");
        link.onclick = (e) => {
            e.stopPropagation();
            shell.openExternal(href);
        }
        // If the link is a YouTube video, add an iframe
        const hostname = util.parseHostname(href);
        if((hostname === "youtube.com" || hostname === "youtu.be")
            && configGet("previewYt")) {
            // Get the video ID
            const videoId = (hostname == "youtube.com")
                ? util.escapeHtml(util.parseUrlParameter(href, "v"))
                : href.split("/")[href.split("/").length - 1]; // youtu.be
            
            // Add an iframe
            const iframe = document.createElement("iframe");
            iframe.width = "400";
            iframe.height = "225";
            iframe.allow = "clipboard-write; encrypted-media; picture-in-picture; fullscreen";
            iframe.src = "https://www.youtube.com/embed/" + videoId;
            whereToInsert.append(iframe);
        }
        // If the link is a Spotify %whatever%, add an iframe too
        if(hostname === "open.spotify.com" && configGet("previewYt")) {
            const tokens = href.split("/");
            const thingId = tokens[tokens.length - 1];
            const thingType = tokens[tokens.length - 2];
            
            // Add an iframe
            const iframe = document.createElement("iframe");
            iframe.width = String(300);
            iframe.height = String(380);
            iframe.allow = "encrypted-media";
            iframe.src = `https://open.spotify.com/embed/${thingType}/${thingId}`;
            whereToInsert.append(iframe);
        }
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
            const sectionId = window.msgSections.length
            createInputSection(types.MessageSectionType.QUOTE, sectionId, () => {
                removeInputSection(sectionId);
            })

            window.msgSections[sectionId].blob = id;

            (window.msgSections[sectionId].typeElm as HTMLInputElement).value
                    = util.messageSummary(window.entityCache[id]);
            util.adjTaHeight(window.msgSections[sectionId].typeElm as HTMLTextAreaElement);
        } },
        { icon: "delete",  selfOnly: true,  onclick: (e) => util.putEntities([msg]) },
        { icon: "edit",    selfOnly: true,  onclick: (e) => editMessage(id) },
        { icon: "history", selfOnly: false, onclick: (e) => domUtil.showMessageHistory(id, e.clientX, e.clientY) }
    ];

    for(const btnDesc of buttons) {
        // Don"t add "self-only" buttons to messages not sent by self
        const sentBySelf = window.entityCache[id].sender === remote.getGlobal("webprotState").self.id
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

// Sets up the message input field to edit a message
function editMessage(id: number) {
    window.editingMessage = id;

    // Remove input sections
    resetMsgInput(true);

    // Create input sections
    const msg = window.entityCache[id] as entities.Message;
    for(const srcSect of msg.latest.sections) {
        const sid = window.msgSections.length;
        createInputSection(srcSect.type, sid, () => removeInputSection(sid));
        
        const section = window.msgSections[sid];
        const type = section.type;
        section.text = srcSect.text;
        section.blob = srcSect.blob;

        if([types.MessageSectionType.TEXT,
            types.MessageSectionType.CODE,
            types.MessageSectionType.QUOTE,
            types.MessageSectionType.INVITE].includes(type))
                (section.typeElm as HTMLInputElement).value = section.text;
    }

    util.elmById("message-editing").innerHTML = util.escapeHtml("Editing message");
}

// Creates an input message section
export function createInputSection(type: types.MessageSectionType, id: number, removeCb: Function, filename?: string, fileSize?: number) {
    const section = document.createElement("div");
    section.classList.add("message-section", "message-section-" + type, "flex-row", "message-section-" + id);
    section.id = "message-section-" + id;

    const removeBtn = document.createElement("button");
    removeBtn.classList.add("icon-button", "cg-button");
    section.appendChild(removeBtn);
    removeBtn.addEventListener("click", (e) => removeCb());

    const removeImg = document.createElement("img");
    removeImg.src = path.join(window["__dirname"], "icons/remove_section.png");
    removeBtn.appendChild(removeImg);

    var typeElm;
    const editorSection: EditorMessageSection = { type: type, typeElm: null, elm: null };

    switch(type) {
        case types.MessageSectionType.TEXT:
            typeElm = document.createElement("textarea");
            typeElm.classList.add("message-input", "fill-width");
            typeElm.placeholder = "Text section";
            typeElm.rows = 1;
            var mentionLock = true;
            typeElm.oninput = () => {
                util.adjTaHeight(typeElm);
                util.updTyping(typeElm.value);

                if(viewingGroup === 0) return;
                const mention = util.extractMention(typeElm.value, typeElm.selectronStart, ["@"]);
                const tok     = util.mentionToken(typeElm.value, typeElm.selectronStart, ["@"])
                if(mention === undefined) { setMentionList([]); mentionLock = false; return; }
                const tag = mention.charAt(0);
                const name = mention.substr(1);
                mentionLock = true;
                switch(tag) {
                    case "@":
                        yGlobal.sendPacket(new packets.SearchPacket(
                            packets.SearchTarget.GROUP_MEMBER,
                            viewingGroup,
                            name),
                        (r: packets.Packet) => {
                            if(!mentionLock) return;
                            if(!(r instanceof packets.SearchResultPacket)) return;
                            const users = r.list;
                            setMentionList(users, typeElm, tok);
                        });
                        break;
                }
            };
            break;
        case types.MessageSectionType.FILE:
            typeElm = document.createElement("div");
            typeElm.classList.add("message-file-section", "flex-col");

            const readableSize = util.readableFileSize(fileSize);

            const headerSpan = document.createElement("span");
            headerSpan.innerHTML = (readableSize === undefined) ? "File" : ("File (" + readableSize + "):");
            headerSpan.classList.add("message-file-header")
            typeElm.appendChild(headerSpan)

            if(filename !== undefined) {
                const nameSpan = document.createElement("code");
                nameSpan.innerHTML = util.escapeHtml(filename);
                typeElm.appendChild(nameSpan);

                const progress = document.createElement("progress");
                progress.classList.add("fill-width");
                typeElm.appendChild(progress);
                progress.max = 100;
                progress.value = 0;
            }
            break;
        case types.MessageSectionType.CODE:
            typeElm = document.createElement("textarea");
            typeElm.classList.add("code-input", "fill-width");
            typeElm.placeholder = "Code section";
            typeElm.rows = 1;
            typeElm.oninput = () => { util.adjTaHeight(typeElm); util.updTyping(typeElm.value) };
            typeElm.spellcheck = false;
            break;
        case types.MessageSectionType.QUOTE:
            typeElm = document.createElement("textarea");
            typeElm.classList.add("message-input", "fill-width", "message-quote-section");
            typeElm.placeholder = "Quote section";
            typeElm.rows = 1;
            typeElm.oninput = () => { util.adjTaHeight(typeElm); util.updTyping(typeElm.value) };
            break;
        case types.MessageSectionType.INVITE:
            typeElm = document.createElement("textarea");
            typeElm.classList.add("message-input", "fill-width");
            typeElm.placeholder = "Text section";
            typeElm.rows = 1;
            typeElm.value = filename;
            typeElm.disabled = true;
            break;

        case types.MessageSectionType.POLL:
            typeElm = document.createElement("div");
            typeElm.classList.add("input-poll", "fill-width");
            
            editorSection.options = [];
            const optionContainer = document.createElement("div");
            const addOption = () => {
                const optObj: EditorPollOption = {};
                optObj.id = editorSection.options.reduce((acc, cur) => Math.max(acc, cur.id), 0) + 1;
                editorSection.options.push(optObj);

                const opt = document.createElement("div");
                optionContainer.appendChild(opt);

                const rem = document.createElement("button");
                opt.appendChild(rem);
                rem.classList.add("icon-button", "cg-button");
                rem.innerHTML = `<img src="icons/remove_section.png"/>`;
                rem.onclick = (e) => {
                    util.stopPropagation(e);
                    opt.remove();
                    editorSection.options = editorSection.options.filter((v, i) => v.id !== id);
                }

                const inp = document.createElement("input");
                opt.appendChild(inp);
                optObj.input = inp;
            };

            const addOptionButton = document.createElement("button");
            addOptionButton.classList.add("icon-button", "cg-button");
            addOptionButton.onclick = (e) => {
                util.stopPropagation(e);
                addOption();
            };
            addOptionButton.innerHTML = `<img src="icons/add_poll_option.png"/>`;

            typeElm.appendChild(optionContainer);
            typeElm.appendChild(addOptionButton);
            addOption();
            break;
    }
    section.appendChild(typeElm);

    // Append the section
    const container = util.elmById("message-input-container");
    container.insertBefore(section, container.lastChild);

    // Play an animation
    util.triggerAppear(section);
    
    section.onkeypress = (e) => {
        // Send the message when pressing enter, insert a line break on shift+enter
        if(e.keyCode === 13 && !e.shiftKey) {
            util.stopPropagation(e);
            sendMessage();
        }
    }

    editorSection.typeElm = typeElm;
    editorSection.elm = section;

    window.msgSections.push(editorSection);
}

// Removes an input message section
export function removeInputSection(id: number) {
    // Find the element
    const elm = util.elmById("message-section-" + id);
    // Remove it
    for(var i = 0; i < window.msgSections.length; i++) {
        if(window.msgSections[i].elm === elm) {
            window.msgSections.splice(i, 1);
            break;
        }
    }
    util.triggerDisappear(elm);
    setTimeout(() => elm.remove(), 200);

    // If there are no elements left, create an empty one
    if(window.msgSections.length === 0)
        resetMsgInput();
}

// Resets the message input field
export function resetMsgInput(fullReset: boolean =false) {
    const container = util.elmById("message-input-container")

    // Remove all sections
    for(var i = container.children.length - 1; i >= 0; i--) {
        const child = container.children[i];
        if(child.id !== "message-section-add-btns" && child.id !== "mention-list")
            child.remove();
    }

    setMentionList([]);

    window.msgSections = [];

    if(!fullReset) {
        // Add a default section
        const id = window.msgSections.length;
        createInputSection(types.MessageSectionType.TEXT, id, () => {
            removeInputSection(id);
        });

        // Focus on it
        window.msgSections[id].typeElm.focus();

        const elm = window.msgSections[id].typeElm as HTMLTextAreaElement;
        setTimeout(() => elm.value = "", 1);
        setTimeout(() => util.adjTaHeight(elm), 1);

        util.elmById("message-editing").innerHTML = "";
    }
}

// Sends the message
export function sendMessage() {
    var sects = window.msgSections;
    const polls:   entities.Poll[] = [];
    const pollIdx: number[] = [];

    for(var i = 0; i < sects.length; i++) {
        const type = sects[i].type;

        // Abort if any of the files haven't been uploaded yet
        if(type === types.MessageSectionType.FILE && sects[i].blob === undefined)
            return;

        if(sects[i].typeElm === undefined)
            return;
        if([types.MessageSectionType.TEXT,
            types.MessageSectionType.CODE,
            types.MessageSectionType.QUOTE,
            types.MessageSectionType.INVITE].includes(type))
                sects[i].text = (sects[i].typeElm as HTMLTextAreaElement).value;

        if(type === types.MessageSectionType.POLL) {
            const poll = new entities.Poll();
            poll.id = 0;
            poll.options = sects[i].options.map(x => x.input.value);
            polls.push(poll);
            pollIdx.push(i);
        }

        if(sects[i].blob === undefined) sects[i].blob = 0;
        if(sects[i].text === undefined) sects[i].text = "";
    }

    for(var i = 0; i < sects.length; i++) {
        delete sects[i].elm;
        delete sects[i].typeElm;
    }

    // Reset the typing status and send the message
    setTimeout(() => {
        const next = () => {
            const state = new entities.MessageState();
            const msg = new entities.Message();
            state.id = 0;
            state.sections = sects;
            msg.id = window.editingMessage;
            msg.latest = state;
            msg.channel = window.viewingChan;
            util.putEntities([msg]);
            util.clearTyping();

            util.markRead(window.viewingChan);
            util.markRead(window.viewingChan, true);
            util.elmById("message-unread-sep")?.remove();

            resetMsgInput();
            window.editingMessage = 0;
        };

        if(polls.length === 0) { next(); return; }

        // Upload polls
        util.putEntities(polls, (response) => {
            const pollIds = (response as packets.EntitiesPacket).entities.map(x => x.id);
            pollIds.forEach((v, i) => { 
                const section = sects[pollIdx[i]];
                section.blob = v;
                delete section.options;
                delete section.options;
            });
            next();
        });
    }, 50);
}

export function setMentionList(userIds: number[], field?: HTMLInputElement, tokenIdx?: number) {
    const list = util.elmById("mention-list");

    util.reqEntities(userIds.map(id => new packets.EntityGetRequest(
      entities.User.typeNum, id)), false, (e: entities.Entity[]) => {
        // kill all children :>
        while(list.firstChild) list.firstChild.remove();

        for(const user of e) {
            if(!(user instanceof entities.User)) continue;
            const elm  = document.createElement("div");

            const ava  = document.createElement("img");  elm.appendChild(ava);
            const name = document.createElement("span"); elm.appendChild(name);
            name.innerHTML = util.escapeHtml(user.name);
            util.download(user.avaFile, (avaPath: string) => ava.src = `file://${avaPath}`);

            list.appendChild(elm);

            if(field === undefined) continue;
            elm.onclick = (e) => {
                util.stopPropagation(e);

                const tokens = field.value.split(" ");
                const before = tokens.filter((v, i, a) => i < tokenIdx).join(" ") + " ";
                const after  = tokens.filter((v, i, a) => i > tokenIdx).join(" ") + " ";
                const result = `${before}@${user.id}${after}`;
                field.value = result;
                field.selectionEnd = field.selectionStart = `${before}@${user.id} `.length;
                field.focus();
                setMentionList([]);
            };
        }

        list.style.maxHeight = `${list.scrollHeight}px`;
    });
}