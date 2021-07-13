// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

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

    loadImg.onload = (e) => {
        // calculate position of the context menu:
        // if it won't fit on either of the axes due
        // to its THICCness, flip it

        const bw = menuElm.clientWidth;
        const bh = menuElm.clientHeight;
        const ww = window.innerWidth;
        const wh = window.innerHeight;

        const xright  = (x + bw) > ww;
        const ybottom = (y + bh) > wh;

        if (xright) menuElm.style.right  = `${ww - x}px`;
               else menuElm.style.left   = `${x}px`;
        if(ybottom) menuElm.style.bottom = `${wh - y}px`;
               else menuElm.style.top    = `${y}px`;

        menuElm.style.opacity = "1";
    };
}

export function createWrapper(x: number, y: number, menuElm: HTMLElement) {
    create(x, y, menuElm);
    const background = document.createElement("div");
    background.classList.add("popup-bg");
    background.appendChild(menuElm);

    background.onclick = (e) => {
        menuElm.remove();
        background.remove();
    };

    document.body.appendChild(background);
}