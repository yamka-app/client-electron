import { elmById, escapeHtml, triggerAppear, triggerDisappear } from "../util.js";
const tinycolor = window["_modules"].tinycolor

export function show(text: string, img?: string, color?: string, click?: () => any) {
    if(color == undefined) color = "background";
    const colorVal = getComputedStyle(document.documentElement).getPropertyValue("--" + color);
    const textColor = tinycolor(colorVal).isLight() ? "#000000" : "#ffffff";

    const notif = document.createElement("div");
    text = `<span style="color: ${textColor}">${escapeHtml(text)}</span>`;
    notif.innerHTML = (img == undefined ? "" : `<img src="${img}"/>`) + text;
    notif.onclick = click;
    notif.style.background = `var(--${color})`;

    elmById("notification-list").appendChild(notif);
    setTimeout(() => triggerDisappear(notif, false, true), 5000);
    triggerAppear(notif, false);
}