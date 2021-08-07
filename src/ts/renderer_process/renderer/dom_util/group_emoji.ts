// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Group emoji editor

import * as util                 from "../util.js";
import * as notif                from "./notif.js";
import { format, formatElement } from "./i18n.js";
import { Group, File }           from "../../protocol.s/entities.s.js";
import { EntityGetRequest }      from "../../protocol.s/packets.s.js";

const { remote: { BrowserWindow, dialog }, fs } = window["_modules"];

function createEntry(id: number) {
    const elm = document.createElement("div");
    const emoji = window.entityCache[id] as File;

    util.download(id, (path) => {
        elm.innerHTML = `
            <img src="file://${path}"/>
            <input x-key-ph="group_settings.emoji.name_placeholder"></input>
            <button x-key-tt="group_settings.emoji.remove" class="icon-button cg-button"><img src="icons/friend_remove.png"/></button>
        `;

        // name changing
        const input = elm.querySelector("input");
        formatElement(input);
        formatElement(elm.querySelector("button"));
        input.value = emoji.emojiName;
        input.onblur = (e) => {
            // check the name
            if(!/([0-9]|_|[a-z]|[A-Z]){1,32}/.test(input.value)) {
                notif.show(format("group_settings.emoji.invl_name"), "icons/ban.png", "red");
                input.value = emoji.emojiName;
                return;
            }

            const emojiUpd = new File();
            emojiUpd.id = id;
            emojiUpd.emojiName = input.value;
            util.putEntities([emojiUpd]);
        };

        // removal
        const remove = elm.querySelector("button");
        remove.onclick = (e) => {
            const group = new Group();
            group.id = window.viewingGroup;
            entityCache[window.viewingGroup].emoji = group.emoji = (entityCache[window.viewingGroup] as Group).emoji
                .filter(x => x !== id);
            util.putEntities([group]);
            updateEntries();
        };
    });

    return elm;
}

export function updateEntries() {
    const group = window.entityCache[window.viewingGroup] as Group;
    const list = util.elmById("group-emoji-list");

    while(list.firstChild)
        list.firstChild.remove();

    util.reqEntities(group.emoji.map(x => new EntityGetRequest(File.typeNum, x)), false, (emojis: File[]) => {
        for(const emoji of emojis)
            list.appendChild(createEntry(emoji.id));
    });
}

util.elmById("group-emoji-add").onclick = (e) => {
    var filePath: string[]|string = dialog.showOpenDialogSync(BrowserWindow.getFocusedWindow(), {
        properties: ["openFile"],
        filters: [
            { name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "bmp"] }
        ]
    });
    if(filePath === undefined) return;
    filePath = filePath[0];

    // check size
    const size: number = fs.statSync(filePath).size;
    if(size > 256 * 1024) {
        notif.show(format("group_settings.emoji.too_large", {
            limit: "256KiB",
            size:  util.readableFileSize(size),
        }), "icons/ban.png", "red");
        return;
    }

    // create the emoji
    const progress = notif.show(format("group_settings.emoji.uploading"), undefined, "background", undefined, true);
    util.upload(filePath, (id) => {
        progress(1, 1);
        // assign it to the group
        const group = new Group();
        group.id = window.viewingGroup;
        group.emoji = (entityCache[window.viewingGroup] as Group).emoji.concat(id);
        util.putEntities([group]);
        util.elmById("group-emoji-list").appendChild(createEntry(id));
    }, (min, max) => {
        progress(min, max + 1);
    }, undefined, false, false, "new_emoji");
};