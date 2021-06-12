const _modules = window["_modules"];
const path       = _modules.path;
const fs         = _modules.fs;
const app        = _modules.electron.app;

import { User } from "../../protocol.s/entities.s.js";
import { appDataPath, configGet, configSet } from "../settings.js";
import { download, elmById, hideElm, showElm, stopPropagation } from "../util.js";

function avaStorage() {
    return path.join(appDataPath(), "avatar_");
}

function panel(img: string, title: string, click: () => void) {
    const div = document.createElement("div");
    
    div.innerHTML = `<img class="${img.startsWith("icons") ? "cg-img" : ""}" src="${img}"/>
        <span>${title}</span>`;
    div.onclick = (ev) => { stopPropagation(ev); click() };

    return div;
}

export function show(login: (id: number) => void) {
    window.selectedUser = 0;

    const sel = elmById("user-select");
    while(sel.lastChild)
        sel.lastChild.remove();

    // Go thorugh all cached users
    const users = configGet("users");
    for(const user of users)
        sel.appendChild(panel(user.ava, user.name, () => login(user.id)));

    // Add "log in" and "sign up" buttons
    sel.appendChild(panel("icons/account_add.png", "LOG IN", () => {
        hide();
        showElm("login-form");
    }));
    sel.appendChild(panel("icons/group_add.png", "SIGN UP", () => {
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
    if(!users.every(x => x.id !== user.id)) return;
    
    download(user.avaFile, (ava) => {
        // Copy the avatar to a persistent location
        const persistentAva = `${avaStorage()}${user.id}.png`;
        fs.copyFileSync(ava, persistentAva);

        users.push({ id: user.id, ava: persistentAva, name: user.name });
        configSet("users", users);
    });
}

export function deleteUser(id: number) {
    var users = configGet("users");
    users = users.filter(x => x.id !== id);
    configSet("users", users);
}