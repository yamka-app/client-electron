// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { elmById, escapeHtml, triggerAppear, triggerDisappear } from "../util.js";
const tinycolor = window["_modules"].tinycolor

function foreground(color: string) {
    if(["background", "bg-2", "bg-3"].includes(color))
        return "foreground";
    return `${color}-foreground`;
}

export function show(text: string, img: string = "", color?: string,
        click?: () => any, progress: boolean = false) {
    if(color == undefined) color = "background";
    const textColor = `var(--${foreground(color)})`;

    const notif = document.createElement("div");
    text = `<span style="color: ${textColor}">${escapeHtml(text)}</span>`;
    notif.innerHTML = (img === "" ? "" : `<img src="${img}"/>`) + text;
    // Make the image circular if it's not a builtin icon
    if(!img.startsWith("icons/") && img !== "")
        notif.querySelector("img").classList.add("round");
    notif.onclick = click;
    if(click !== undefined)
        notif.style.cursor = "pointer";
    notif.style.background = `var(--${color})`;

    elmById("notification-list").appendChild(notif);
    triggerAppear(notif, false);

    if(progress) {
        const bar = document.createElement("progress");
        notif.appendChild(bar);
        notif.classList.add("hasProgress");
        bar.classList.add("thin");
        return (val: number, max: number, newText?: string) => {
            bar.value = val;
            bar.max = max;
            if(newText !== undefined)
                notif.innerHTML = `<span style="color: ${textColor}">${escapeHtml(newText)}</span>`;
            if(val === max)
                triggerDisappear(notif, false, true)
        };
    } else {
        setTimeout(() => triggerDisappear(notif, false, true), 5000);
    }
}