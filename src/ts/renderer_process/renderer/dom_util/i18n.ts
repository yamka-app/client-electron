// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Internationalization

type dict = { [key: string]: string };
interface LocaleDescription {
    name:     string,
    title:    string,
    title_en: string,
    emoji:    string,
    authors:  string[]
}

import { elmById, escapeHtml } from "../util.js";
import { configSet }           from "../settings.js";
import { addTooltip }          from "./layout.js";

const _modules  = window["_modules"];
const path      = _modules.path;
const fs        = _modules.fs;
const nodeEmoji = _modules.nodeEmoji;
const twemoji   = _modules.twemoji;

var locale: dict = {};
var localeName = "";
const defaultLocale = "en_us";

export function listLocales() {
    const files: string[] = fs.readdirSync(path.join(window["__dirname"], "locale"));
    const locales = files.map(x => {
        return {
            ...JSON.parse(fs.readFileSync(path.join(window["__dirname"], "locale", x))),
            ...{name: path.basename(x, ".json")}
        };
    });
    for(let locale of locales) {
        for(const key in locale)
            if(!["name", "title", "title_en", "emoji", "authors"].includes(key))
                delete locale[key];
    }
    return locales as LocaleDescription[];
}

export function loadLocale(name: string) {
    const jsonPath = path.join(window["__dirname"], "locale", `${name}.json`);

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
        return;
    }

    formatElements();
}

export function format(key: string, args: dict = {}) {
    let str = locale[key] ?? key;
    if(str === key)
        console.warn(`No translation for "${key}" in "${localeName}"`);

    for(const [k, v] of Object.entries(args))
        str = str.replace("$" + k, v);

    return str;
}

export function encloseArgs(args: dict) {
    return JSON.stringify(args);
}
export function extractArgs(s: string) {
    return JSON.parse(s) as dict;
}

export function formatElement(elm: HTMLElement, args: dict = undefined) {
    // preserve arguments
    if(args === undefined && elm.getAttribute("x-i18n-args") !== null)
        args = extractArgs(elm.getAttribute("x-i18n-args"));
    args = args ?? {};
    elm.setAttribute("x-i18n-args", encloseArgs(args));

    // args may point to a key
    for(const [k, v] of Object.entries(args))
        if(v.startsWith("%"))
            args[k] = format(v.slice(1), args);

    if(elm.getAttribute("x-key") !== null)
        elm.innerHTML = escapeHtml(format(elm.getAttribute("x-key"), args));

    if(elm.getAttribute("x-key-ph") !== null && (elm instanceof HTMLInputElement || elm instanceof HTMLTextAreaElement))
        elm.placeholder = format(elm.getAttribute("x-key-ph"), args);

    if(elm.getAttribute("x-key-tt") !== null) {
        elm.setAttribute("x-tooltip", format(elm.getAttribute("x-key-tt"), args));
        addTooltip(elm);
    }
}

export function formatElements(root: any = document) {
    const lookFor = ["x-key", "x-key-ph", "x-key-tt"];
    var elements = [];
    for(const attr of lookFor)
        elements = [...elements, ...root.querySelectorAll(`[${attr}]`)];
    
    for(const elm of elements)
        formatElement(elm as HTMLElement);
}

export function updateLocaleList() {
    const list = elmById("language-list");
    const locales = listLocales();

    while(list.firstChild)
        list.firstChild.remove();

    for(const locale of locales) {
        const elm = document.createElement("div");
        const authors = "by " + locale.authors.join(", ");
        const title = locale.title === locale.title_en
                ? `${locale.emoji} ${escapeHtml(locale.title)} <span>${authors}</span>`
                : `${locale.emoji} ${escapeHtml(locale.title)} [${escapeHtml(locale.title_en)}] <span>${authors}</span>`;
        elm.innerHTML = nodeEmoji.emojify(title);
        twemoji.parse(elm, { folder: "svg", ext: ".svg" });
        elm.onclick = (e) => {
            loadLocale(locale.name);
            configSet("locale", locale.name);
            updateLocaleList();
        };

        if(locale.name === localeName)
            elm.classList.add("selected");

        list.appendChild(elm);
    }
}