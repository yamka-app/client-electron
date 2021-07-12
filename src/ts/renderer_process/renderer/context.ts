import * as popups from "./popups.js";

export class Entry {
    title: string;

    icon:          string;
    iconThemeable: boolean;

    constructor(title: string, icon?: string, themeable?: boolean) {
        this.title = title;
        this.icon  = icon;
        this.iconThemeable = themeable;
    }

    create(): HTMLElement {
        const elm  = document.createElement("div");
        const head = document.createElement("div");

        if(this.icon !== undefined) {
            const icon = document.createElement("img");
            icon.src = this.icon;
            if(this.iconThemeable) icon.classList.add("cg-img");
            head.appendChild(icon);
        }

        if(this.title !== undefined) {
            const title = document.createElement("span");
            title.innerText = this.title;
            head.appendChild(title);
        }

        elm.appendChild(head);
        return elm;
    }
}

export type callback = (...args: any[]) => any;

export class ButtonEntry extends Entry {
    action: callback;
    args:   any[];

    constructor(title: string, action: callback, args?: any[], icon?: string, themeable?: boolean) {
        super(title, icon, themeable);

        this.action = action;
        this.args = args;
    }

    create() {
        const element = super.create();

        element.classList.add("pointer");
        element.onclick = (e) => this.action(...(this.args ?? []));

        return element;
    }
}

export class Separator extends Entry {
    constructor() {
        super(undefined);
    }

    create() {
        const elm = document.createElement("div");
        elm.classList.add("ctx-sep");
        return elm;
    }
}

export class ContextMenu {
    element: HTMLElement;

    close() {
        this.element.remove();
    }
}

export function create(x: number, y: number, entries: Entry[]) {
    const menu = new ContextMenu();
    const menuElm = document.createElement("div");
    menuElm.classList.add("context-menu");

    for(const entry of entries)
        menuElm.appendChild(entry.create());

    menu.element = menuElm;
    popups.create(x, y, menuElm);
    return menu;
}

export function createWrapper(x: number, y: number, entries: Entry[]) {
    const menu = create(x, y, entries);

    const background = document.createElement("div");
    background.classList.add("popup-bg");
    background.appendChild(menu.element);

    background.onclick = (e) => {
        menu.close();
        background.remove();
    };

    document.body.appendChild(background);
}

export function addRightClickMenu(thing: HTMLElement, entries: Entry[]) {
    thing.oncontextmenu = (e) => createWrapper(e.x, e.y, entries);
}