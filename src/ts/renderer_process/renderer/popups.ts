// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { updAgentList } from "./dom_util/dom_util.js";
import { escapeHtml, stopPropagation } from "./util.js";

var popups: [HTMLElement, HTMLElement][] = [];

export function position(x: number, y: number, elm: HTMLElement, setOpacity: boolean = true) {
    // if it won't fit on either of the axes due
    // to its THICCness, flip it

    const bw = elm.clientWidth;
    const bh = elm.clientHeight;
    const ww = window.innerWidth;
    const wh = window.innerHeight;

    const xright  = (x + bw) > ww;
    const ybottom = (y + bh) > wh;

    if (xright) elm.style.right  = `${ww - x}px`;
           else elm.style.left   = `${x}px`;
    if(ybottom) elm.style.bottom = `${wh - y}px`;
           else elm.style.top    = `${y}px`;

    if(setOpacity)
        elm.style.opacity = "1";
}

export function create(x: number, y: number, menuElm: HTMLElement) {
    // this image is only used to trigger an "onload"
    const loadImg = document.createElement("img");
    loadImg.width = 1;
    loadImg.height = 1;
    loadImg.style.opacity = "0";
    loadImg.src = window["_modules"].path.join(window["__dirname"], "icons/leave.png"); // random image
    menuElm.appendChild(loadImg);
    menuElm.style.opacity = "0";
    menuElm.style.position = "absolute";

    loadImg.onload = (e) => position(x, y, menuElm);
}

export function createWrapper(x: number, y: number, menuElm: HTMLElement) {
    create(x, y, menuElm);
    const background = document.createElement("div");
    background.classList.add("popup-bg");
    background.appendChild(menuElm);

    background.onclick = (e) => {
        menuElm.remove();
        background.remove();
        popups = popups.filter(x => x !== [background, menuElm]);
    };
    popups.push([background, menuElm]);

    document.body.appendChild(background);
}

export function closeAll() {
    popups.forEach(([x, y]) => { x.remove(); y.remove(); });
    popups = [];
}

export function addHoverText(elm: HTMLElement, text: string) {
    elm.onmouseover = (e) => {
        stopPropagation(e);
        if(elm["hoverText"] !== undefined)
            return;
        elm["hoverText"] = document.createElement("div");
        document.body.appendChild(elm["hoverText"]);
        elm["hoverText"].classList.add("hover-text");
        elm["hoverText"].innerHTML = escapeHtml(text);
    };
    elm.onmousemove = (e) => {
        stopPropagation(e);
        if(elm["hoverText"] !== undefined)
            position(e.x, e.y, elm["hoverText"]);
    };
    elm.onmouseout = (e) => {
        stopPropagation(e);
        elm["hoverText"].style.opacity = 0;
        const h = elm["hoverText"];
        setTimeout(() => h.remove(), 200); // wait for it to fade away
        elm["hoverText"] = undefined;
    };
}