// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const _modules = window["_modules"];
const path       = _modules.path;
const fs         = _modules.fs;
const app        = _modules.electron.app;

import { User } from "../../protocol.s/entities.s.js";
import { appDataPath, configGet, configSet } from "../settings.js";
import { download, elmById, hideElm, showElm, stopPropagation } from "../util.js";
import { formatElements } from "./i18n.js";

function avaStorage() {
    return path.join(appDataPath(), "avatar_");
}

function panel(img: string, title: string, click: () => void, logout?: () => void) {
    const div = document.createElement("div");
    const user = !img.startsWith("icons");

    const span = title.startsWith("%") // i18n
            ? `<span x-key="${title.slice(1)}"></span>`
            : `<span>${title}</span>`;
    
    div.innerHTML = `<img class="${user ? "" : "cg-img"}" src="${img}"/>
        ${span}
        ${user ? "<button class=\"icon-button cg-button\" x-key-tt=\"account_selector.remove_tooltip\"><img src=\"icons/disconnect.png\"/></button>" : ""}`;
    div.onclick = (ev) => { stopPropagation(ev); click(); };
    if(user)
        div.querySelector("button").onclick =
            (ev) => { stopPropagation(ev); div.remove(); logout(); };

    formatElements(div);
    return div;
}

export function show(login: (id: number) => void, logout: (id: number) => void) {
    window.selfId = 0;

    const sel = elmById("user-select");
    for(var i = sel.children.length - 1; i >= 0; i--) {
        const child = sel.children[i];
        if(child.id !== "user-select-title")
            child.remove();
    }

    // Go thorugh all cached users
    const users = configGet("users");
    for(const user of users)
        sel.appendChild(panel(user.ava, user.name,
            () => login(user.id),
            () => logout(user.id)));

    // Add "log in" and "sign up" buttons
    sel.appendChild(panel("icons/account_add.png", "%account_selector.login", () => {
        hide();
        showElm("login-form");
    }));
    sel.appendChild(panel("icons/group_add.png", "%account_selector.signup", () => {
        hide();
        showElm("signup-form");
    }));

    showElm(sel);
}

export function hide() {
    hideElm("user-select");
}

export function cacheUser(user: User) {
    var users: {id: number, ava: string, name: string}[] = configGet("users");
    users = users.filter(x => x.id !== user.id);

    download(user.avaFile, (ava) => {
        // Copy the avatar to a persistent location
        const persistentAva = `${avaStorage()}${user.id}.png`;
        fs.copyFileSync(ava, persistentAva);

        users.splice(0, 0, { id: user.id, ava: persistentAva, name: user.name });
        configSet("users", users);
    });
}

export function deleteUser(id: number) {
    var users = configGet("users");
    users = users.filter(x => x.id !== id);
    configSet("users", users);
}