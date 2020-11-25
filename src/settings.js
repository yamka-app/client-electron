// Default settings
const defaultSettings = {
    accentColor:   '#b42fe4',
    fontSize:      9,
    customTheme:   false,
    theme:         'themes/dark.css', // will be computed later
    notifications: true,
    sendTyping:    true,
    previewYt:     true,
    blurOnDefocus: false
}

// Simple turn on/off settings that can be toggled with a switch
const toggleSettings = [
    { name: 'notifications', element: 'enable-notifications' },
    { name: 'sendTyping',    element: 'send-typing' },
    { name: 'previewYt',     element: 'preview-yt' },
    { name: 'blurOnDefocus', element: 'blur-unfocused' }
]

// Set ot get a setting
const ipcRenderer_settings = require('electron').ipcRenderer
function configGet(k) {
    return ipcRenderer_settings.sendSync('synchronous-message', {
        action: 'config.get',
        k:      k
    })
}
function configSet(k, v) {
    ipcRenderer_settings.sendSync('synchronous-message', {
        action: 'config.set',
        k:      k,
        v:      v
    })
}

function _settingsFunc() {
    const escapeHtml = require('escape-html')

    // Set default settings
    for(const kv of Object.entries(defaultSettings))
        if(isNullOrUndefined(configGet(kv[0])))
            configSet(kv[0], kv[1])

    // Assign event handlers and existing values to toggle switches
    for(const desc of toggleSettings) {
        const elm = document.getElementById(desc.element)
        elm.onchange = (e) => configSet(desc.name, elm.checked)
        elm.checked = configGet(desc.name)
    }

    // Theme-related settings
    const accentColorChange = document.getElementById('accent-color-change')
    const fontSizeChange    = document.getElementById('font-size-change')
    const themeSwitch       = document.getElementById('theme-switch')
    const themeSelector     = document.getElementById('theme-change')
    accentColorChange.onchange = (e) => setAccentColor(accentColorChange.value)
    fontSizeChange.onchange    = (e) => setFontSize(fontSizeChange.value)
    themeSwitch.onchange       = (e) => setTheme(themeSwitch.checked ? 'light' : 'dark')

    themeSelector.onclick = (e) => {
        const stylePath = dialog.showOpenDialogSync(window, {
            properties: ['openFile'],
            filters: [
                { name: 'Styles', extensions: ['css'] }
            ]
        })
        if(stylePath !== undefined)
            loadTheme(stylePath)
    }

    // Sets the font size
    const docStyle     = document.documentElement.style
    const docStyleComp = getComputedStyle(document.documentElement)
    function setFontSize(pt) {
        configSet('fontSize', pt)
        fontSizeChange.value = pt

        docStyle.setProperty('--font-size', pt + 'pt')
        document.getElementById('font-size-indicator').innerHTML = escapeHtml(pt)
    }

    // Sets the accent color
    function setAccentColor(color) {
        configSet('accentColor', color)
        accentColorChange.value = color
        recomputeStyling()
    }

    function recomputeStyling() {
        const color = configGet('accentColor')

        docStyle.setProperty('--accent',            tinycolor(color).toString())
        docStyle.setProperty('--accent-dim',        tinycolor(color).darken(amount=10).toString())
        docStyle.setProperty('--accent-dim-2',      tinycolor(color).darken(amount=20).toString())
        docStyle.setProperty('--accent-trans',      tinycolor(color).setAlpha(0x48).toString())
        docStyle.setProperty('--accent-foreground', tinycolor(color).isLight() ? '#000000' : '#ffffff')

        const tc = tinycolor(color)
        for(let i = 1; i <= 7; i++) {
            const original =  tinycolor(docStyleComp.getPropertyValue('--default-shade-' + i))
            const colorzied = tinycolor.mix(original, tc, amount=1)
            docStyle.setProperty('--shade-' + i, colorzied.toString())

            if(i === 3 || i === 4) {
                const originalTrans = tinycolor(docStyleComp.getPropertyValue('--default-shade-' + i + '-trans'))
                docStyle.setProperty('--shade-' + i + '-trans', colorzied.setAlpha(originalTrans.getAlpha()).toString())
            }
        }

        document.getElementById('theme-name')  .innerHTML = escapeHtml(docStyleComp.getPropertyValue('--theme-name'))
        document.getElementById('theme-author').innerHTML = escapeHtml(docStyleComp.getPropertyValue('--theme-author'))
    }

    // Loads a (presumably custom) theme
    function loadTheme(theme, custom=true) {
        document.getElementById('theme-css').href = (custom ? 'file://' : '') + theme
        setTimeout(recomputeStyling, 100) // TODO: fix :^)

        configSet('theme', theme)
        configSet('customTheme', custom)

        if(!custom)
            themeSwitch.checked = (theme === 'themes/light.css')
    }

    // Sets one of the default themes
    function setTheme(theme) {
        loadTheme('themes/' + theme + '.css', false)
    }

    setAccentColor(configGet('accentColor'))
    setFontSize   (configGet('fontSize'))
    loadTheme     (configGet('theme'), configGet('customTheme'))
}