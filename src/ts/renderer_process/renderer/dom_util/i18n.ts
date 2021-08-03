// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Internationalization

type dict = { [key: string]: string };

import { escapeHtml } from "../util.js";

const _modules = window["_modules"];
const path     = _modules.path;
const fs       = _modules.fs;

var locale: dict = {};
var localeName = "";
const defaultLocale = "en_us";

export function loadLocale(name: string) {
    const jsonPath = path.join(window["__dirname"], `locale/${name}.json`);
    try {
        const json = fs.readFileSync(jsonPath);
        locale = JSON.parse(json);
        localeName = name;
    } catch(ex) {
        if(name !== defaultLocale) {
            console.error(`Failed to load locale "${name}", reverting to "${defaultLocale}"`);
            loadLocale(defaultLocale);
        } else {
            console.error(`Failed to load default locale ${name}`);
        }
    }
}

export function format(key: string, args: dict = {}) {
    let str = locale[key] ?? key;
    if(str === key)
        console.warn(`No translation for "${key}" in "${localeName}"`);

    for(let [k, v] of Object.entries(args))
        str = str.replace("$" + k, v);

    return str;
}

export function formatElement(elm: HTMLElement, args: dict = {}) {
    if(elm.getAttribute("x-key") !== null)
        elm.innerHTML = escapeHtml(format(elm.getAttribute("x-key"), args));

    if(elm.getAttribute("x-key-ph") !== null && elm instanceof HTMLInputElement)
        elm.placeholder = escapeHtml(format(elm.getAttribute("x-key-ph"), args));

    if(elm.getAttribute("x-key-tt") !== null)
        elm.setAttribute("x-tooltip", format(elm.getAttribute("x-key-tt"), args));
}

export function formatDefault() {
    const lookFor = ["x-key", "x-key-ph", "x-key-tt"];
    var elements = [];
    for(const attr of lookFor)
        elements = [...elements, ...document.querySelectorAll(`[${attr}]`)]
    
    for(const elm of elements)
        formatElement(elm as HTMLElement);
}