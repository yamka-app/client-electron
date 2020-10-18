const { app, BrowserWindow, Tray, Menu, ipcMain, remote } = require('electron')
const fs = require('fs')
const tls = require('tls')
const path = require('path')
const tmp = require('tmp')
const zlib = require('zlib')

if (require('electron-squirrel-startup')) return app.quit()

const configPath = path.join(__dirname, "_order_config.json")
var config = {}

var mainWindow = null
var tray = null
var windowCreated = false

// Create a temporary directory for downloaded files
tmp.setGracefulCleanup()
var tmpDir = tmp.dirSync().name
global.tmpDir = tmpDir
console.log('Temporary directory: ' + tmpDir)

function createWindow() {
    if(!windowCreated){
        // Create the window
        mainWindow = new BrowserWindow({
            title: 'Order',
            icon: path.join(__dirname, 'logo.png'),
            maximizable: true,
            frame: false,
            transparent: true,
            minWidth: 1000,
            minHeight: 600,
            webPreferences: {
                nodeIntegration: true,
                enableRemoteModule: true
            },
            width:  (config && config.bounds) ? config.bounds.width  : 1280,
            height: (config && config.bounds) ? config.bounds.height : 720
        })
        //mainWindow.maximize()
        mainWindow.loadFile('src/index.html')
        windowCreated = true

        // Write configuration when closing
        mainWindow.on('close', (e) => {
            config.bounds = mainWindow.getBounds()
            fs.writeFileSync(configPath, JSON.stringify(config))
        })
    } else {
        mainWindow.show()
        //mainWindow.hide()
    }
}

app.on('ready', () => {
    // Read config
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    catch(e) {
        // Default config
        config = {
            width: 1280,
            height: 720
        }
    }

    // Create the window
    createWindow()

    // Create the icon in the tray
    tray = new Tray(path.join(__dirname, 'logo.png'))
    tray.setToolTip('Order')
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open Order', type: 'normal', click() { createWindow() } },
        { label: 'Exit Order', type: 'normal', click() {
            // Clean the temporary files
            fs.rmdir(tmpDir, { recursive: true }, () => {})
            app.quit()
        } }
    ]))

    // Ping the server occasionally
    setInterval(() => {
        if(!webprotState.sendPings)
            return

        webprotSendPacket({
            'type': 'ping',
            'payload': 123
        })
    }, 5000)
})

app.on('window-all-closed', () => {
    windowCreated = false
})

// =========================================== PROTOCOL SECTION

const webprotSettings = {
    'host': 'ordermsg.tk',
    'port': 1746,
    'blobPort': 1747,
    'version': 1,
    'compressionThreshold': 32
}

var webprotState = {
    'connected' : false,
    'connecting' : false,
    'sendPings' : false,
    'socket': null,
    'seqId': 1,
    'queue': [],
    'selfRequestId': -1,
    'self': {},

    'blobStates' : [],
    'reqStates': []
}

global.webprotState = webprotState

function webprotEncNum(val, bytes) {
    var byteArray = Array.apply(null, Array(bytes)).map((x, i) => { return 0 })

    for (var i = byteArray.length - 1; i >= 0; i--) {
        var byte = val & 0xff
        byteArray[i] = val
        val = (val - byte) / 256
    }

    return Buffer.from(byteArray)
}

function webprotEncNumList(val, bytes) {
    var concatArr = [ webprotEncNum(val.length, 2) ]
    for(const num in val)
        concatArr.push(webprotEncNum(num, bytes))
    return Buffer.concat(concatArr)
}

function webprotDecNum(byteArray) {
    var val = 0

    for (var i = 0; i < byteArray.length; i++)
        val = (val * 256) + byteArray[i]

    return val
}

function webprotDecNumList(byteArray, bytesPerNum) {
    const cnt = webprotDecNum(byteArray.slice(0, 2))
    var arr = []

    for(var i = 0; i < cnt * bytesPerNum; i += bytesPerNum)
        arr.push(webprotDecNum(byteArray.slice(2 + i, 2 + i + bytesPerNum)))

    return arr
}

function webprotEncStr(str) {
    // String consists of the actual UTF-8 encoded string and a 16-bit length (in bytes) preceding it
    var utf8 = Buffer.from(str, 'utf8')
    return Buffer.concat([webprotEncNum(utf8.length, 2), utf8])
}

function webprotDecStr(bytes) {
    var len = webprotDecNum(bytes.slice(0, 2), 2)
    return bytes.toString('utf8', 2, 2 + len)
}

function webprotSendBytes(bytes) {
    if(!webprotState.connected) {
        webprotState.queue.push(bytes)
        webprotConnect()
        return
    }

    console.log('Sending:', bytes)
    webprotState.socket.write(bytes)
}

function webprotSendPacket(packet) {
    var type = 0
    var data = null

    // Fill data based on the packet type
    switch(packet.type) {
        case 'login':
            type = 1
            data = Buffer.concat([
                webprotEncNum(webprotSettings.version, 2),
                webprotEncStr(packet.email),
                webprotEncStr(packet.password)
            ])
            break

        case 'signup':
            type = 5
            data = Buffer.concat([
                webprotEncNum(webprotSettings.version, 2),
                webprotEncStr(packet.email),
                webprotEncStr(packet.name),
                webprotEncStr(packet.password)
            ])
            break

        case 'ping':
            type = 2
            data = webprotEncNum(packet.payload, 4)
            break

        case 'entity-get':
            type = 6
            var concatArr = [ webprotEncNum(packet.entities.length, 2) ]
            for(var i = 0; i < packet.entities.length; i++) {
                const entity = packet.entities[i]
                const numType = { user: 1, channel: 2, group: 3, message: 4, role: 5 }[entity.type]
                concatArr.push(
                    webprotEncNum(numType, 2),
                    webprotEncNum(entity.id, 8),
                    webprotEncNum((entity.pageField == undefined) ? 0 : 1, 1),
                    webprotEncNum((entity.contextEntity == undefined) ? 0 : 1, 1)
                )
                // Pagination
                if(entity.pageField != undefined) {
                    concatArr.push(
                        webprotEncNum(entity.pageField, 2),
                        webprotEncNum(entity.pageDir ? 1 : 0, 1),
                        webprotEncNum(entity.pageFrom, 8),
                        webprotEncNum(entity.pageCnt, 1)
                    )
                }
                // Context
                if(entity.contextEntity != undefined) {
                    concatArr.push(
                        webprotEncNum(entity.contextEntity, 2),
                        webprotEncNum(entity.contextId, 8)
                    )
                }
                // Additionally save self info request ID for future reference
                if(entity.id == 0)
                    webprotState.selfRequestId = webprotState.seqId
            }
            data = Buffer.concat(concatArr)
            break

        case 'blob-get':
            type = 8
            data = webprotEncNum(packet.id, 8)
            break

        case 'blob-put':
            type = 11
            data = Buffer.concat([
                webprotEncNum(packet.length, 4),
                webprotEncStr(packet.name)
            ])
            break

        case 'entities':
            type = 7
            var concatArr = [ webprotEncNum(packet.entities.length, 2) ]
            packet.entities.forEach(ent => {
                // Encode the entity
                var propCnt = 0
                var props = []
                switch(ent.type) {
                    case 'user':
                        concatArr.push(webprotEncNum(1, 2))
                        if(ent.id != undefined) {
                            propCnt++
                            props.push(
                                webprotEncNum(0, 2),
                                webprotEncNum(ent.id, 8)
                            )
                        }
                        if(ent.name != undefined) {
                            propCnt++
                            props.push(
                                webprotEncNum(2, 2),
                                webprotEncStr(ent.name)
                            )
                        }
                        if(ent.email != undefined) {
                            propCnt++
                            props.push(
                                webprotEncNum(1, 2),
                                webprotEncStr(ent.email)
                            )
                        }
                        if(ent.mfaEnabled != undefined) {
                            propCnt++
                            props.push(
                                webprotEncNum(8, 2),
                                webprotEncNum(ent.mfaEnabled ? 1 : 0, 1)
                            )
                        }
                        if(ent.status != undefined) {
                            propCnt++
                            props.push(
                                webprotEncNum(4, 2),
                                webprotEncNum(ent.status, 1)
                            )
                        }
                        if(ent.statusText != undefined) {
                            propCnt++
                            props.push(
                                webprotEncNum(5, 2),
                                webprotEncStr(ent.statusText)
                            )
                        }
                        if(ent.avaBlob != undefined) {
                            propCnt++
                            props.push(
                                webprotEncNum(7, 2),
                                webprotEncNum(ent.avaBlob, 8)
                            )
                        }
                        break

                    case 'message':
                        concatArr.push(webprotEncNum(4, 2))
                        if(ent.id != undefined) {
                            propCnt++
                            props.push(
                                webprotEncNum(0, 2),
                                webprotEncNum(ent.id, 8)
                            )
                        }
                        if(ent.sections != undefined) {
                            propCnt++
                            props.push(
                                webprotEncNum(1, 2),
                                webprotEncNum(ent.sections.length, 1)
                            )
                            ent.sections.forEach(section => {
                                const t = { 'text': 0, 'file': 1, 'code': 2, 'quote': 3 }[section.type]
                                props.push(
                                    webprotEncNum(t, 1),
                                    webprotEncNum(section.blob ?? 0, 8),
                                    webprotEncStr(section.text ?? '')
                                )
                            })
                        }
                        if(ent.channel != undefined) {
                            propCnt++
                            props.push(
                                webprotEncNum(2, 2),
                                webprotEncNum(ent.channel, 8)
                            )
                        }
                        if(ent.edited != undefined) {
                            propCnt++
                            props.push(
                                webprotEncNum(3, 2),
                                webprotEncNum(ent.edited ? 1 : 0, 1)
                            )
                        }
                        if(ent.sender != undefined) {
                            propCnt++
                            props.push(
                                webprotEncNum(4, 2),
                                webprotEncNum(ent.sender, 8)
                            )
                        }
                        break

                    case 'group':
                        concatArr.push(webprotEncNum(3, 2))
                        for(const kv of Object.entries(ent)) {
                            const k = kv[0]
                            const v = kv[1]
                            // Encode the field
                            let fieldId
                            let fieldVal
                            switch(k) {
                                       case 'id':
                                fieldId = 0
                                fieldVal = webprotEncNum(v, 8)
                                break; case 'name':
                                fieldId = 1
                                fieldVal = webprotEncStr(v)
                                break; case 'channels':
                                fieldId = 2
                                fieldVal = webprotEncNumList(v, 8)
                                break; case 'owner':
                                fieldId = 3
                                fieldVal = webprotEncNum(v, 8)
                                break; case 'roles':
                                fieldId = 4
                                fieldVal = webprotEncNumList(v, 8)
                                break; case 'icon':
                                fieldId = 5
                                fieldVal = webprotEncNum(v, 8)
                                break; case 'invites':
                                fieldId = 6
                                fieldVal = Buffer.concat([
                                    webprotEncNum(v.length, 2),
                                    ...v.map(x => webprotEncStr(x))
                                ])
                                break
                            }
                            if(fieldId != undefined) {
                                // We have one more field encoded
                                propCnt++
                                props.push(
                                    webprotEncNum(fieldId, 2),
                                    fieldVal
                                )
                            }
                        }
                        break

                    case 'channel':
                        concatArr.push(webprotEncNum(2, 2))
                        for(const kv of Object.entries(ent)) {
                            const k = kv[0]
                            const v = kv[1]
                            // Encode the field
                            let fieldId
                            let fieldVal
                            switch(k) {
                                        case 'id':
                                fieldId = 0
                                fieldVal = webprotEncNum(v, 8)
                                break; case 'name':
                                fieldId = 1
                                fieldVal = webprotEncStr(v)
                                break; case 'group':
                                fieldId = 3
                                fieldVal = webprotEncNum(v, 8)
                                break; case 'typing':
                                fieldId = 5
                                fieldVal = webprotEncNumList(v, 8)
                                break
                            }
                            if(fieldId != undefined) {
                                // We have one more field encoded
                                propCnt++
                                props.push(
                                    webprotEncNum(fieldId, 2),
                                    fieldVal
                                )
                            }
                        }
                        break

                    case 'role':
                        concatArr.push(webprotEncNum(5, 2))
                        for(const kv of Object.entries(ent)) {
                            const k = kv[0]
                            const v = kv[1]
                            // Encode the field
                            let fieldId
                            let fieldVal
                            switch(k) {
                                        case 'id':
                                fieldId = 0
                                fieldVal = webprotEncNum(v, 8)
                                break; case 'name':
                                fieldId = 1
                                fieldVal = webprotEncStr(v)
                                break; case 'color':
                                fieldId = 2
                                const raw = parseInt(v.substring(1), 16)
                                fieldVal = webprotEncNum(raw, 4)
                                break; case 'group':
                                fieldId = 3
                                fieldVal = webprotEncNum(v, 8)
                                break; case 'priority':
                                fieldId = 4
                                fieldVal = webprotEncNum(v, 2)
                                break; case 'perms':
                                fieldId = 5
                                fieldVal = Buffer.from(v)
                                break
                            }
                            if(fieldId != undefined) {
                                // We have one more field encoded
                                propCnt++
                                props.push(
                                    webprotEncNum(fieldId, 2),
                                    fieldVal
                                )
                            }
                        }
                        break
                }
                concatArr.push(webprotEncNum(propCnt, 2))
                props.forEach(prop => concatArr.push(prop))
            })
            data = Buffer.concat(concatArr)
            break

        case 'manage-contacts':
            type = 13
            var contact_types = ['friend', 'blocked', 'pending-in', 'pending-out', 'group']
            var actions = ['add', 'remove']
            data = Buffer.concat([
                webprotEncNum(contact_types.indexOf(packet.contactType), 1),
                webprotEncNum(actions.indexOf(packet.action), 1),
                webprotEncNum(packet.id, 8)
            ])
            break

        case 'search-user':
            type = 14
            data = webprotEncStr(packet.name)
            break

        case 'resolve-invite':
            type = 15
            data = Buffer.concat([
                webprotEncNum(packet.add ? 1 : 0, 1),
                webprotEncStr(packet.code)
            ])
            break
    }

    // Mash everything into one buffer
    var buf = Buffer.concat([
        webprotEncNum(type, 1),
        webprotEncNum(webprotState.seqId, 4),
        webprotEncNum((packet.replyTo != undefined) ? packet.replyTo : 0, 4),
        data
    ])

    // Compress the data
    var compressed = buf.length >= webprotSettings.compressionThreshold
    if(compressed)
        buf = zlib.gzipSync(buf, {})

    // Add a compression header
    buf = Buffer.concat([
        webprotEncNum(compressed ? 1 : 0, 1),
        webprotEncNum(buf.length, 4),
        buf
    ])

    // Add a request state
    if(packet.operId != undefined) {
        webprotState.reqStates.push({
            'seqId': webprotState.seqId,
            'operId': packet.operId
        })
    }

    // Send the resulting buffer
    webprotSendBytes(buf, webprotState.seqId++)

    // Reset the connection if we were logged out
    if(packet.type == 'login' && packet.email == '___@logout@___') {
        webprotState.connected = false
        webprotState.connecting = false
        webprotState.sendPings = false
        webprotState.socket = null
        webprotState.self = {}
        webprotState.queue.length = 0
        webprotState.selfRequestId = -1
        webprotState.seqId = 0
        webprotState.blobStates.length = 0
        webprotState.reqStates.length = 0
    }
}

function webprotData(bytes) {
    console.log('Received:', bytes)
    // Read the compression header and decompress the data
    var compressed = webprotDecNum(bytes.slice(0, 1), 1) > 0
    var totalLen = webprotDecNum(bytes.slice(1, 5), 4)
    bytes = bytes.slice(5, 5 + totalLen)
    if(compressed)
        bytes = zlib.gunzipSync(bytes)
    // Separate the packet type and actual data
    var type = webprotDecNum(bytes.slice(0, 1), 1)
    var seqId = webprotDecNum(bytes.slice(1, 5), 4)
    var replyTo = webprotDecNum(bytes.slice(5, 9), 4)
    var payload = bytes.slice(9)
    // Do something based on the packet type
    switch(type) {
        case 4: // status
            var code = webprotDecNum(payload.slice(0, 2), 2)
            var msg = webprotDecStr(payload.slice(2))
            var type_str = ''
            switch(code) {
                case 1:
                    type_str = 'outdated'
                    break
                case 2:
                    type_str = 'invalid-conn-state'
                    break
                case 3:
                    type_str = 'login-err'
                    break
                case 4:
                    type_str = '2fa-required'
                    // Start pinging the server every 15s (it will close the connection if no packets are sent for 30s)
                    webprotState.sendPings = true
                    break
                case 5:
                    type_str = 'login-success'
                    webprotState.sendPings = true
                    break
                case 6:
                    type_str = 'signup-err'
                    break
                case 7:
                    type_str = 'rate-limit'
                    break
                case 8:
                    type_str = 'invalid-id'
                    break
                case 9:
                    type_str = 'blob-too-large'
                    break
                case 10:
                    type_str = 'permission-denied'
                    break
                case 11:
                    type_str = 'invalid-cont-token'
                    break
                case 12:
                    type_str = 'user-not-pending'
                    break
                case 13:
                    type_str = 'cont-act-not-applicable'
                    break
                default:
                    type_str = 'unknown-status-code'
                    break
            }
            ipcSend({
                'type': 'webprot.' + type_str, 'message': msg
            })
            break

        case 7: // entities
            var entities = []
            var entityCount = webprotDecNum(payload.slice(0, 2), 2)
            var pos = 2
            for(var e = 0; e < entityCount; e++) {
                var entity = {}

                var entityType = webprotDecNum(payload.slice(pos, pos + 2), 2)
                pos += 2
                entity.type = ['unknown', 'user', 'channel', 'group', 'message', 'role'][entityType]
                var fieldCount = webprotDecNum(payload.slice(pos, pos + 2), 2)
                pos += 2

                for(var f = 0; f < fieldCount; f++) {
                    var fieldType = webprotDecNum(payload.slice(pos, pos + 2), 2)
                    pos += 2
                    if(entity.type == 'user') {
                        switch(fieldType) {
                            case 0: // id
                                entity.id = webprotDecNum(payload.slice(pos, pos + 8), 8)
                                pos += 8
                                break
                            case 1: // email
                                entity.email = webprotDecStr(payload.slice(pos))
                                pos += webprotDecNum(payload.slice(pos, pos + 2), 2) + 2
                                break
                            case 2: // name
                                entity.name = webprotDecStr(payload.slice(pos))
                                pos += webprotDecNum(payload.slice(pos, pos + 2), 2) + 2
                                break
                            case 3: // tag
                                entity.tag = webprotDecNum(payload.slice(pos, pos + 4), 4)
                                pos += 4
                                break
                            case 4: // status
                                entity.status = webprotDecNum(payload.slice(pos, pos + 1), 1)
                                pos += 1
                                break
                            case 5: // status text
                                entity.statusText = webprotDecStr(payload.slice(pos))
                                pos += webprotDecNum(payload.slice(pos, pos + 2), 2) + 2
                                break
                            case 6: // settings
                                entity.settings = []
                                var settingsKeys = webprotDecNum(payload.slice(pos, pos + 2), 2)
                                pos += 2
                                for(var k = 0; k < settingsKeys; k++) {
                                    var key = webprotDecStr(payload.slice(pos))
                                    pos += webprotDecNum(payload.slice(pos, pos + 2), 2) + 2
                                    var val = webprotDecStr(payload.slice(pos))
                                    pos += webprotDecNum(payload.slice(pos, pos + 2), 2) + 2
                                    entity.settings.push({ key: val })
                                }
                                break
                            case 7: // avatar blob id
                                entity.avaBlob = webprotDecNum(payload.slice(pos, pos + 8), 8)
                                pos += 8
                                break
                            case 8: // MFA enable status
                                entity.mfaEnabled = webprotDecNum(payload.slice(pos, pos + 1), 1) > 0
                                pos += 1
                                break
                            case 9: // friend list
                                entity.friends = webprotDecNumList(payload.slice(pos), 8)
                                pos += 2 + (entity.friends.length * 8)
                                break
                            case 10: // blocklist
                                entity.blocked = webprotDecNumList(payload.slice(pos), 8)
                                pos += 2 + (entity.blocked.length * 8)
                                break
                            case 11: // pending in
                                entity.pendingIn = webprotDecNumList(payload.slice(pos), 8)
                                pos += 2 + (entity.pendingIn.length * 8)
                                break
                            case 12: // pending out
                                entity.pendingOut = webprotDecNumList(payload.slice(pos), 8)
                                pos += 2 + (entity.pendingOut.length * 8)
                                break
                            case 13: // channels
                                entity.channels = webprotDecNumList(payload.slice(pos), 8)
                                pos += 2 + (entity.channels.length * 8)
                                break
                            case 14: // groups
                                entity.groups = webprotDecNumList(payload.slice(pos), 8)
                                pos += 2 + (entity.groups.length * 8)
                                break
                            case 15: // roles
                                entity.roles = webprotDecNumList(payload.slice(pos), 8)
                                pos += 2 + (entity.roles.length * 8)
                                break
                            case 16: // color
                                const raw = webprotDecNum(payload.slice(pos, pos + 4), 4).toString(16)
                                entity.color = '#' + ('00000' + raw).slice(-6)
                                pos += 4
                                break
                        }
                    } else if(entity.type == 'channel') {
                        switch(fieldType) {
                            case 0: // id
                                entity.id = webprotDecNum(payload.slice(pos, pos + 8), 8)
                                pos += 8
                                break
                            case 1: // name
                                entity.name = webprotDecStr(payload.slice(pos))
                                pos += webprotDecNum(payload.slice(pos, pos + 2), 2) + 2
                                break
                            case 2: // members
                                entity.members = webprotDecNumList(payload.slice(pos), 8)
                                pos += 2 + (entity.members.length * 8)
                                break
                            case 3: // group
                                entity.group = webprotDecNum(payload.slice(pos, pos + 8), 8)
                                pos += 8
                                break
                            case 4: // messages
                                entity.messages = webprotDecNumList(payload.slice(pos), 8)
                                pos += 2 + (entity.messages.length * 8)
                                break
                            case 5: // typing users
                                entity.typing = webprotDecNumList(payload.slice(pos), 8)
                                pos += 2 + (entity.typing.length * 8)
                                break
                        }
                    } else if(entity.type == 'message') {
                        switch(fieldType) {
                            case 0: // id
                                entity.id = webprotDecNum(payload.slice(pos, pos + 8), 8)
                                pos += 8
                                break
                            case 1: // sections
                                entity.sections = []
                                const cnt = webprotDecNum(payload.slice(pos, pos + 1), 1)
                                pos += 1
                                for(var i = 0; i < cnt; i++) {
                                    const type = webprotDecNum(payload.slice(pos, pos + 1), 1)
                                    pos += 1
                                    const blob = webprotDecNum(payload.slice(pos, pos + 8), 8)
                                    pos += 8
                                    const text = webprotDecStr(payload.slice(pos))
                                    pos += webprotDecNum(payload.slice(pos, pos + 2), 2) + 2
                                    entity.sections.push({
                                        'type': ['text', 'file', 'code', 'quote'][type],
                                        'blob': blob,
                                        'text': text
                                    })
                                }
                                break
                            case 2: // channel
                                entity.channel = webprotDecNum(payload.slice(pos, pos + 8), 8)
                                pos += 8
                                break
                            case 3: // edited
                                entity.edited = webprotDecNum(payload.slice(pos, pos + 1), 1) > 0
                                pos += 1
                                break
                            case 4: // sender
                                entity.sender = webprotDecNum(payload.slice(pos, pos + 8), 8)
                                pos += 8
                                break
                        }
                    } else if(entity.type == 'group') {
                        switch(fieldType) {
                            case 0: // id
                                entity.id = webprotDecNum(payload.slice(pos, pos + 8), 8)
                                pos += 8
                                break
                            case 1: // name
                                entity.name = webprotDecStr(payload.slice(pos))
                                pos += webprotDecNum(payload.slice(pos, pos + 2), 2) + 2
                                break
                            case 2: // channels
                                entity.channels = webprotDecNumList(payload.slice(pos), 8)
                                pos += 2 + (entity.channels.length * 8)
                                break
                            case 3: // owner
                                entity.owner = webprotDecNum(payload.slice(pos, pos + 8), 8)
                                pos += 8
                                break
                            case 4: // roles
                                entity.roles = webprotDecNumList(payload.slice(pos), 8)
                                pos += 2 + (entity.roles.length * 8)
                                break
                            case 5: // icon
                                entity.icon = webprotDecNum(payload.slice(pos, pos + 8), 8)
                                pos += 8
                                break
                            case 6: // invites
                                entity.invites = []
                                const cnt = webprotDecNum(payload.slice(pos, pos + 2), 2); pos += 2
                                for(let i = 0; i < cnt; i++) {
                                    entity.invites.push(webprotDecStr(payload.slice(pos)))
                                    pos += webprotDecNum(payload.slice(pos, pos + 2), 2) + 2
                                }
                                break
                            case 7: // everyone role
                                entity.everyoneRole = webprotDecNum(payload.slice(pos, pos + 8), 8)
                                pos += 8
                                break
                        }
                    } else if(entity.type == 'role') {
                        switch(fieldType) {
                            case 0: // id
                                entity.id = webprotDecNum(payload.slice(pos, pos + 8), 8)
                                pos += 8
                                break
                            case 1: // name
                                entity.name = webprotDecStr(payload.slice(pos))
                                pos += webprotDecNum(payload.slice(pos, pos + 2), 2) + 2
                                break
                            case 2: // color
                                const raw = webprotDecNum(payload.slice(pos, pos + 4), 4).toString(16)
                                entity.color = '#' + ('00000' + raw).slice(-6)
                                pos += 4
                                break
                            case 3: // group
                                entity.group = webprotDecNum(payload.slice(pos, pos + 8), 8)
                                pos += 8
                                break
                            case 4: // priority
                                entity.priority = webprotDecNum(payload.slice(pos, pos + 2), 2)
                                pos += 2
                                break
                            case 5: // perms
                                entity.perms = payload.slice(pos, pos + 6)
                                pos += 6
                                break
                            case 6: // members
                                entity.members = webprotDecNumList(payload.slice(pos), 8)
                                pos += (entity.members.length * 8) + 2
                                break
                        }
                    }
                }

                entities.push(entity)
            }

            // If the reply ID of this packet matches the packet ID of self-info request, save self-info
            if(replyTo == webprotState.selfRequestId && replyTo != 0)
                webprotState.self = entities[0]

            ipcSend({
                'type': 'webprot.entities', 'entities': entities,
                'spontaneous': replyTo == 0 // did the server send these entities because it wanted to?
            })
            break

        case 9: // blob get/put response
            var pos = 0
            var id = webprotDecNum(payload.slice(pos, pos + 8), 8); pos += 8
            var name = webprotDecStr(payload.slice(pos)); pos += webprotDecNum(payload.slice(pos, pos + 2), 2) + 2
            var size = webprotDecStr(payload.slice(pos)); pos += webprotDecNum(payload.slice(pos, pos + 2), 2) + 2
            var preview = webprotDecStr(payload.slice(pos)); pos += webprotDecNum(payload.slice(pos, pos + 2), 2) + 2
            var hash = payload.slice(pos, pos + 32)
            var token = payload.slice(pos + 32, pos + 64)
            var length = webprotDecNum(payload.slice(pos + 64, pos + 72), 4)

            // Update blob state
            var blobState = webprotState.blobStates.find(x => x.id == id)
            blobState.state = 'connecting'
            blobState.info = {
                'id': id,
                'name': name,
                'size': size,
                'preview': preview,
                'hash': hash
            }

            // Send a "preview available" message
            if(id > 0) {
                ipcSend({
                    'type': 'webprot.blob-preview-available',
                    'operId': blobState.previewOperId,
                    'id': id,
                    'name': name,
                    'size': size,
                    'preview': preview,
                    'hash': hash,
                    'length': length
                })
            }

            // Abort if we don't actually need to download
            if(id > 0 && !blobState.actuallyDownload) {
                webprotState.blobStates = webprotState.blobStates.filter(elm => elm != blobState)
                break
            }

            if(id > 0) {
                // Create a temporary file to write to (when downloading)
                blobState.info.path = path.join(tmpDir, id + '_' + name)
                blobState.file = fs.createWriteStream(blobState.info.path, {})
            } else {
                // Set the path (when uploading)
                blobState.info.path = blobState.path
                blobState.file = fs.readFileSync(blobState.path)
            }

            // Connect to the blob server
            blobState.socket = tls.connect({
                'host': webprotSettings.host,
                'port': webprotSettings.blobPort
            }, () => {
                if(blobState.socket != null) {
                    // Send our download/upload token
                    blobState.state = 'sendingToken'
                    blobState.socket.write(token)
                }
            })

            blobState.socket.on('data', (bytes) => {
                if(blobState.state == 'sendingToken') {
                    // The response is a status code
                    var status = bytes[0]
                    if(status != 0) {
                        blobState.state = 'error'
                        ipcSend({
                            'type': 'webprot.status',
                            'message': 'Blob download/upload error (id=' + blobState.info.id + ')'
                        })
                        if(blobState.info.id !== 0 && blobState.actuallyDownload) {
                            blobState.previewOperId = undefined
                            //webprotSendPacket({
                            //    'type': 'blob-get',
                            //    'id': blobState.id,
                            //    'operId': blobState.operId
                            //})
                        }
                    } else {
                        blobState.state = (blobState.info.id === 0) ? 'uploading' : 'awaitingLength'
                        if(blobState.state != 'uploading')
                            return

                        // Pump data
                        blobState.info.length = blobState.length
                        function sendChunk(from) {
                            // Send a chunk
                            const chunk = blobState.file.slice(from, from + 10240)
                            blobState.socket.write(chunk, (err) => {
                                // Count number of bytes sent
                                blobState.sent += chunk.length
                                // Send a progress info if needed
                                if(blobState.progressOperId != undefined) {
                                    ipcSend({
                                        'type': 'webprot.ul-progress',
                                        'operId': blobState.progressOperId,
                                        'progress': blobState.sent,
                                        'max': blobState.info.length
                                    })
                                }
                                // Either send the next chunk or read the ID
                                if(blobState.sent == blobState.info.length)
                                    blobState.state = 'awaitingId'
                                else
                                    sendChunk(blobState.sent)
                            })
                        }
                        // Send the first chunk
                        sendChunk(0)
                    }
                } else if(blobState.state == 'awaitingLength') {
                    // It's length
                    blobState.info.length = webprotDecNum(bytes)
                    blobState.state = 'downloading'
                } else if(blobState.state == 'downloading') {
                    // It's data
                    blobState.received += bytes.length
                    blobState.file.write(bytes)
                    blobState.progress = blobState.received / blobState.info.length

                    // Check if we downloaded everything
                    if(blobState.received >= blobState.info.length) {
                        blobState.file.close()
                        blobState.socket.end()
                        delete blobState.file
                        delete blobState.socket
                        webprotState.blobStates = webprotState.blobStates.filter(elm => elm != blobState)

                        blobState.state = 'finished'
                        ipcSend({
                            'type': 'webprot.status',
                            'message': 'Blob download finished'
                        })
                        ipcSend({
                            'type': 'webprot.dl-end',
                            'state': blobState
                        })
                    }
                } else if(blobState.state == 'awaitingId') {
                    // It's the ID of the uploaded blob
                    var id = webprotDecNum(bytes, 8)
                    blobState.socket.end()
                    delete blobState.file
                    delete blobState.socket
                    webprotState.blobStates = webprotState.blobStates.filter(elm => elm != blobState)

                    blobState.state = 'finished'
                    blobState.info.id = id
                    ipcSend({
                        'type': 'webprot.status',
                        'message': 'Blob upload finished'
                    })
                    ipcSend({
                        'type': 'webprot.ul-end',
                        'state': blobState
                    })
                }
            })
            break

        case 10: // generated MFA secret
            ipcSend({
                'type': 'webprot.mfa-secret', 'secret': webprotDecStr(payload)
            })
            break

        case 12: // generated continuation token
            ipcSend({
                'type': 'webprot.cont-token', 'token': webprotDecStr(payload)
            })
            break
    }

    // Send an operation completion notification
    var operState = webprotState.reqStates.find(x => x.seqId == replyTo)
    if(operState != undefined) {
        ipcSend({
            'type': 'webprot.completion-notification',
            'operId': operState.operId
        })
        webprotState.reqStates.splice(webprotState.reqStates.indexOf(operState), 1)
    }
}

function ipcSend(data) {
    if(mainWindow?.webContents)
        mainWindow.webContents.send('message', data)
}

function webprotConnect() {
    if(webprotState.connecting)
        return
    webprotState.connecting = true
    webprotState.sendPings = false
    webprotState.seqId = 1
    webprotState.selfRequestId = -1
    webprotState.self = {}
    // Close the existing connection if it is open
    if(webprotState.connected)
        webprotState.socket.destroy()
    // Initiate a TLS connection to the server
    console.log('Connecting to ' + webprotSettings.host + ':' + webprotSettings.port)
    ipcSend({
        'type': 'webprot.status', 'message': 'Connecting'
    })
    ipcSend({
        'type': 'webprot.connecting'
    })
    var timeStart = new Date().getTime();
    webprotState.socket = tls.connect({
        'host': webprotSettings.host,
        'port': webprotSettings.port
    }, () => {
        // We have connected
        var timeEnd = new Date().getTime();
        console.log('Connected in', timeEnd - timeStart, 'ms');
        ipcSend({
            'type': 'webprot.status',
            'message': 'Connected in ' + (timeEnd - timeStart) + ' ms'
        })
        ipcSend({
            'type': 'webprot.connected'
        })
        webprotState.connected = true
        webprotState.connecting = false
        // Send the packets in the queue
        webprotState.queue.forEach((bytes) => {
            webprotSendBytes(bytes)
        })
        webprotState.queue = []
    })

    // Register some events
    webprotState.socket.on('data', (data) => {
        webprotData(data)
    })
    webprotState.socket.on('end', () => {
        webprotState.connected = false
        webprotState.connecting = false
        webprotState.sendPings = false
        console.log('Disconnected')
        ipcSend({
            'type': 'webprot.status', 'message': 'Disconnected'
        })
        ipcSend({
            'type': 'webprot.disconnected'
        })
    })
    webprotState.socket.on('error', (error) => {
        webprotState.connected = false
        webprotState.connecting = false
        webprotState.sendPings = false
        console.log(error);
    })
}

ipcMain.on('asynchronous-message', (event, arg) => {
    if(arg.action == 'webprot.connect') {
        webprotConnect()
    } else if(arg.action == 'webprot.login') {
        webprotSendPacket({
            'type': 'login',
            'operId': arg.operId,
            'email': arg.email,
            'password': arg.password
        })
    } else if(arg.action == 'webprot.signup') {
        webprotSendPacket({
            'type': 'signup',
            'operId': arg.operId,
            'email': arg.email,
            'name': arg.name,
            'password': arg.password
        })
    } else if(arg.action == 'webprot.entity-get') {
        webprotSendPacket({
            'type': 'entity-get',
            'operId': arg.operId,
            'entities': arg.entities
        })
    } else if(arg.action == 'webprot.blob-dl') {
        // Refuse if there's already a blob operation
        const existing = webprotState.blobStates.filter(x => x.id == arg.id)[0]
        if(existing) {
            return;
        } else {
            // Create a new state object
            webprotState.blobStates.push({
                'id': arg.id,
                'state': 'awaitingInfo',
                'progress': 0,
                'received': 0,
                'operId': arg.blobOperId,
                'previewOperId': arg.previewOperId,
                'actuallyDownload': arg.actuallyDownload
            })

            // Get blob info
            webprotSendPacket({
                'type': 'blob-get',
                'id': arg.id,
                'operId': arg.operId
            })   
        }
    } else if(arg.action == 'webprot.blob-ul') {
        // Get file length
        var len = fs.statSync(arg.path).size
        
        // Create a new state object
        webprotState.blobStates.push({
            'id': 0,
            'path': arg.path,
            'length': len,
            'state': 'awaitingUploadToken',
            'progress': 0,
            'sent': 0,
            'operId': arg.blobOperId,
            'progressOperId': arg.progressOperId,
        })

        // Get the upload token
        webprotSendPacket({
            'type': 'blob-put',
            'operId': arg.operId,
            'name': path.basename(arg.path),
            'length': len
        })
    } else if(arg.action == 'webprot.entity-put') {
        webprotSendPacket({
            type: 'entities',
            operId: arg.operId,
            entities: arg.entities
        })
    } else if(arg.action == 'webprot.manage-contacts') {
        webprotSendPacket({
            'type': 'manage-contacts',
            'operId': arg.operId,
            'contactType': arg.contactType,
            'action': arg.method,
            'id': arg.id
        })
    } else if(arg.action == 'webprot.search-user') {
        webprotSendPacket({
            'type': 'search-user',
            'operId': arg.operId,
            'name': arg.name
        })
    } else if(arg.action == 'webprot.resolve-invite') {
        webprotSendPacket({
            type:   'resolve-invite',
            operId: arg.operId,
            code:   arg.code,
            add:    arg.add
        })
    }
})