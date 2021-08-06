// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Group emoji editor

import * as util            from "../util.js";
import { formatElement }    from "./i18n.js";
import { Group, File }      from "../../protocol.s/entities.s.js";
import { EntityGetRequest } from "../../protocol.s/packets.s.js";

const { remote: { BrowserWindow, dialog } } = window["_modules"];

function createEntry(id: number) {
    const elm = document.createElement("div");
    const emoji = window.entityCache[id] as File;

    util.download(id, (path) => {
        elm.innerHTML = `
            <img src="${path}"/>
            <input x-key-ph="group_settings.emoji.name_placeholder"></input>
            <button x-key-tt="group_settings.emoji.remove" class="icon-button cg-button"><img src="icons/friend_remove.png"/></button>
        `;

        const input = elm.querySelector("input");
        formatElement(input);
        input.value = emoji.emojiName;
        input.onblur = (e) => {
            const emoji = new File();
            emoji.id = id;
            emoji.emojiName = input.value;
            util.putEntities([emoji]);
        };

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

    // create the emoji
    util.upload(filePath, (id) => {
        // assign it to the group
        const group = new Group();
        group.id = window.viewingGroup;
        group.emoji = (entityCache[window.viewingGroup] as Group).emoji.concat(id);
        util.putEntities([group]);
        util.elmById("group-emoji-list").appendChild(createEntry(id));
    }, undefined, undefined, false, false, "new_emoji");
};