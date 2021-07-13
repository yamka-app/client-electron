// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const _modules = window["_modules"];

const electron   = _modules.electron;
const tinycolor  = _modules.tinycolor;
const escapeHtml = _modules.escapeHtml;

// Default settings
const defaultSettings = [
    { name: "accentColor",   value: "#fa3c1b"         },
    { name: "fontSize",      value: 9                 },
    { name: "customTheme",   value: false             },
    { name: "theme",         value: "themes/dark.css" },
    { name: "notifications", value: true              },
    { name: "sendTyping",    value: true              },
    { name: "previewYt",     value: true              },
    { name: "blurOnDefocus", value: false             },
    { name: "micGain",       value: 1                 },
    { name: "micThres",      value: 0.008             },
    { name: "agents",        value: {}                },
    { name: "tokens",        value: {}                },
    { name: "users",         value: []                },
    { name: "sslkeylog",     value: false             }
];

// Simple turn on/off settings that can be toggled with a switch
const toggleSettings: {name: string, element: string}[] = [
    { name: "notifications", element: "enable-notifications" },
    { name: "sendTyping",    element: "send-typing"          },
    { name: "previewYt",     element: "preview-yt"           },
    { name: "blurOnDefocus", element: "blur-unfocused"       },
    { name: "sslkeylog",     element: "en-sslkeylog"         }
];

// Set ot get a setting
const ipcRenderer_settings = electron.ipcRenderer;
export function configGet(k: string) {
    return ipcRenderer_settings.sendSync("synchronous-message", {
        action: "config.get",
        k:      k
    });
}
export function configSet(k: string, v: any) {
    ipcRenderer_settings.sendSync("synchronous-message", {
        action: "config.set",
        k:      k,
        v:      v
    });
}
export function appDataPath() {
    return ipcRenderer_settings.sendSync("synchronous-message", {
        action: "config.appDataPath"
    });
}

function _settingsFunc() {
    const { BrowserWindow, dialog } = electron.remote;
    
    // Set default settings
    for(const nv of defaultSettings)
        if(configGet(nv.name) === undefined || configGet(nv.name) === null)
            configSet(nv.name, nv.value);

    // Assign event handlers and existing values to toggle switches
    for(const desc of toggleSettings) {
        const elm = document.getElementById(desc.element) as HTMLInputElement;
        elm.onchange = (e) => configSet(desc.name, elm.checked);
        elm.checked = configGet(desc.name);
    }

    // Theme-related settings
    const accentColorChange = document.getElementById("accent-color-change") as HTMLInputElement;
    const themeSwitch       = document.getElementById("theme-switch")        as HTMLInputElement;
    const themeSelector     = document.getElementById("theme-change")        as HTMLInputElement;
    accentColorChange.onchange = (e) => setAccentColor(accentColorChange.value);
    themeSwitch.onchange       = (e) => setTheme(themeSwitch.checked ? "light" : "dark");

    themeSelector.onclick = (e) => {
        const stylePath = dialog.showOpenDialogSync(BrowserWindow.getFocusedWindow(), {
            properties: ["openFile"],
            filters: [
                { name: "CSS Styles", extensions: ["css"] }
            ]
        });
        if(stylePath !== undefined)
            loadTheme(stylePath[0]);
    }

    // Sets the font size
    const docStyle     = document.documentElement.style;
    const docStyleComp = getComputedStyle(document.documentElement);
    function setFontSize(pt: number) {
        configSet("fontSize", pt);
        docStyle.setProperty("--font-size", pt + "pt");
    }

    // Sets the accent color
    function setAccentColor(color: string) {
        configSet("accentColor", color);
        accentColorChange.value = color.toString();
        recomputeStyling();
    }

    // Basically modifies CSS vars so that they match the theme
    function recomputeStyling() {
        const color = configGet("accentColor");

        // Change accent color vars
        const black = "#000000"; const white = "#ffffff";
        const accentAlt = tinycolor(color).spin(-15).toHexString();
        docStyle.setProperty("--accent",            tinycolor(color).toString());
        docStyle.setProperty("--accent-alt",        accentAlt);
        docStyle.setProperty("--accent-alt-trans",  accentAlt + "90");
        docStyle.setProperty("--accent-trans",      color + "90");
        docStyle.setProperty("--accent-trans-2",    color + "40");
        docStyle.setProperty("--accent-dim",        tinycolor(color).darken(10).toString());
        docStyle.setProperty("--accent-dim-2",      tinycolor(color).darken(20).toString());
        docStyle.setProperty("--accent-foreground", tinycolor(color).isLight() ? black : white);

        // Set theme name and author fields
        document.getElementById("theme-name")  .innerHTML = escapeHtml(docStyleComp.getPropertyValue("--theme-name"));
        document.getElementById("theme-author").innerHTML = escapeHtml(docStyleComp.getPropertyValue("--theme-author"));
    }

    // Loads a (presumably custom) theme
    function loadTheme(theme: string, custom: boolean =true) {
        console.log(`Loading ${custom?"":"non-"}custom theme ${theme}`);
        const themeLink = document.getElementById("theme-css") as HTMLLinkElement;
        themeLink.href = (custom ? "file://" : "") + theme;
        setTimeout(recomputeStyling, 100); // TODO: fix :^)

        configSet("theme", theme);
        configSet("customTheme", custom);

        if(!custom)
            themeSwitch.checked = (theme === "themes/light.css");
    }

    // Sets one of the default themes
    function setTheme(theme: string) {
        loadTheme("themes/" + theme + ".css", false);
    }

    // Load everything from the config
    setAccentColor(configGet("accentColor"));
    setFontSize   (configGet("fontSize"));
    loadTheme     (configGet("theme"), configGet("customTheme"));
}

window.addEventListener("load", _settingsFunc);