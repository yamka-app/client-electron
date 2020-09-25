const { app, BrowserWindow, Tray, Menu, ipcMain, remote } = require('electron')
const fs = require('fs')
const tls = require('tls')
const path = require('path')
const tmp = require('tmp')
const zlib = require('zlib')

if (require('electron-squirrel-startup')) return app.quit();

var mainWindow = null
var tray = null
var windowCreated = false

// Create a temporary directory for downloaded files
tmp.setGracefulCleanup()
var tmpDir = tmp.dirSync().name
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
            width: 1280,
            height: 720,
            minWidth: 1000,
            minHeight: 600,
            webPreferences: {
                nodeIntegration: true,
                enableRemoteModule: true
            }
        })
        //mainWindow.maximize()
        mainWindow.loadFile('index.html')

        windowCreated = true
    } else {
        mainWindow.show()
        //mainWindow.hide()
    }
}

app.whenReady().then(() => {
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
    }, 15000)
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
    'seqId': 0,
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
        byteArray[i] = byte
        val = (val - byte) / 256
    }

    return Buffer.from(byteArray)
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
            var concatArr = [webprotEncNum(packet.entities.length, 2)]
            for(var i = 0; i < packet.entities.length; i++) {
                var numType = 0
                switch(packet.entities[i].type) {
                    case 'user':
                        numType = 1
                        break
                    default:
                        numType = 0
                        break
                }
                concatArr.push(Buffer.concat([
                    webprotEncNum(numType, 2),
                    webprotEncNum(packet.entities[i].id, 8)
                ]))
                // Additionally save self info request ID for future reference
                if(packet.entities[i].id == 0)
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
                switch(ent.type) {
                    case 'user':
                        concatArr.push(webprotEncNum(1, 2))
                        var propCnt = 0
                        var props = []
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
                        // Append property count and properties themselves
                        concatArr.push(webprotEncNum(propCnt, 2))
                        props.forEach(prop => concatArr.push(prop))
                        break
                }
            })
            data = Buffer.concat(concatArr)
            break

        case 'manage-contacts':
            type = 13
            var contact_types = ['friend', 'blocked', 'pending-in', 'pending-out']
            var actions = ['add', 'remove']
            data = Buffer.concat([
                webprotEncNum(contact_types.indexOf(packet.contact_type), 1),
                webprotEncNum(actions.indexOf(packet.action), 1),
                webprotEncNum(packet.id, 8)
            ])
            break
    }

    // Mash everything into one buffer
    var buf = Buffer.concat([
        webprotEncNum(data.length, 4),
        webprotEncNum(type, 2),
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
    var type = webprotDecNum(bytes.slice(4, 6), 2)
    var seqId = webprotDecNum(bytes.slice(6, 10), 4)
    var replyTo = webprotDecNum(bytes.slice(10, 14), 4)
    var data = bytes.slice(14)
    // Do something based on the packet type
    switch(type) {
        case 4: // status
            var code = webprotDecNum(data.slice(0, 2), 2)
            var msg = webprotDecStr(data.slice(2))
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
            var entityCount = webprotDecNum(data.slice(0, 2), 2)
            var pos = 2
            for(var e = 0; e < entityCount; e++) {
                var entity = {}

                var entityType = webprotDecNum(data.slice(pos, pos + 2), 2)
                pos += 2
                switch(entityType) {
                    case 1:
                        entity.type = 'user'
                        break
                    default:
                        entity.type = 'unknown'
                        break
                }
                var fieldCount = webprotDecNum(data.slice(pos, pos + 2), 2)
                pos += 2

                for(var f = 0; f < fieldCount; f++) {
                    var fieldType = webprotDecNum(data.slice(pos, pos + 2), 2)
                    pos += 2

                    switch(fieldType) {
                        case 0: // id
                            entity.id = webprotDecNum(data.slice(pos, pos + 8), 8)
                            pos += 8
                            break
                        case 1: // email
                            entity.email = webprotDecStr(data.slice(pos))
                            pos += webprotDecNum(data.slice(pos, pos + 2), 2) + 2
                            break
                        case 2: // name
                            entity.name = webprotDecStr(data.slice(pos))
                            pos += webprotDecNum(data.slice(pos, pos + 2), 2) + 2
                            break
                        case 3: // tag
                            entity.tag = webprotDecNum(data.slice(pos, pos + 4), 4)
                            pos += 4
                            break
                        case 4: // status
                            entity.status = webprotDecNum(data.slice(pos, pos + 1), 1)
                            pos += 1
                            break
                        case 5: // status text
                            entity.statusText = webprotDecStr(data.slice(pos))
                            pos += webprotDecNum(data.slice(pos, pos + 2), 2) + 2
                            break
                        case 6: // settings
                            entity.settings = []
                            var settingsKeys = webprotDecNum(data.slice(pos, pos + 2), 2)
                            pos += 2
                            for(var k = 0; k < settingsKeys; k++) {
                                var key = webprotDecStr(data.slice(pos))
                                pos += webprotDecNum(data.slice(pos, pos + 2), 2) + 2
                                var val = webprotDecStr(data.slice(pos))
                                pos += webprotDecNum(data.slice(pos, pos + 2), 2) + 2
                                entity.settings.push({ key: val })
                            }
                            break
                        case 7: // avatar blob id
                            entity.avaBlob = webprotDecNum(data.slice(pos, pos + 8), 8)
                            pos += 8
                            break
                        case 8: // MFA enable status
                            entity.mfaEnabled = webprotDecNum(data.slice(pos, pos + 1), 1) > 0
                            pos += 1
                            break
                        case 9: // friend list
                            entity.friends = webprotDecNumList(data.slice(pos), 8)
                            pos += 2 + (entity.friends.length * 8)
                            break
                        case 10: // blocklist
                            entity.blocked = webprotDecNumList(data.slice(pos), 8)
                            pos += 2 + (entity.blocked.length * 8)
                            break
                        case 11: // pending in
                            entity.pendingIn = webprotDecNumList(data.slice(pos), 8)
                            pos += 2 + (entity.pendingIn.length * 8)
                            break
                        case 12: // pending out
                            entity.pendingOut = webprotDecNumList(data.slice(pos), 8)
                            pos += 2 + (entity.pendingOut.length * 8)
                            break
                    }
                }

                entities.push(entity)
            }

            // If the reply ID of this packet matches the packet ID of self-info request, save self-info
            if(replyTo == webprotState.selfRequestId)
                webprotState.self = entities[0]

            ipcSend({
                'type': 'webprot.entities', 'entities': entities
            })
            break

        case 9: // blob get/put response
            var pos = 0
            var id = webprotDecNum(data.slice(pos, pos + 8), 8); pos += 8
            var name = webprotDecStr(data.slice(pos)); pos += webprotDecNum(data.slice(pos, pos + 2), 2) + 2
            var size = webprotDecStr(data.slice(pos)); pos += webprotDecNum(data.slice(pos, pos + 2), 2) + 2
            var preview = webprotDecStr(data.slice(pos)); pos += webprotDecNum(data.slice(pos, pos + 2), 2) + 2
            var hash = data.slice(pos, pos + 32)
            var token = data.slice(pos + 32, pos + 64)

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

            if(id > 0) {
                // Create a temporary file to write to (when downloading)
                blobState.info.path = path.join(tmpDir, id + '_' + name)
                blobState.file = fs.createWriteStream(blobState.info.path, {})
            } else {
                // Set the path (when uploading)
                blobState.info.path = blobState.path
                blobState.file = fs.createReadStream(blobState.info.path, {})
            }

            // Connect to the blob server
            blobState.socket = tls.connect({
                'host': webprotSettings.host,
                'port': webprotSettings.blobPort
            }, () => {
                // Send our download/upload token
                blobState.state = 'sendingToken'
                blobState.socket.write(token)
            })

            blobState.socket.on('data', (bytes) => {
                if(blobState.state == 'sendingToken') {
                    // The response is a status code
                    var status = bytes[0]
                    if(status != 0) {
                        blobState.state = 'error'
                        ipcSend({
                            'type': 'webprot.status',
                            'message': 'Blob download/upload error'
                        })
                    } else {
                        blobState.state = (blobState.info.id == 0) ? 'uploading' : 'awaitingLength'
                        if(blobState.state != 'uploading')
                            return
                        // Pump data
                        blobState.info.length = blobState.length
                        blobState.file.on('data', data => {
                            blobState.socket.write(data)
                            blobState.sent += data.length
                            blobState.progress = blobState.sent / blobState.info.length
                        })
                        blobState.file.on('end', () => {
                            blobState.state = 'awaitingId'
                        })
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
                        blobState.file = null
                        blobState.socket.end()
                        blobState.socket = null
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
                    blobState.file.close()
                    blobState.file = null
                    blobState.socket.end()
                    blobState.socket = null
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
                'type': 'webprot.mfa-secret', 'secret': webprotDecStr(data)
            })
            break

        case 12: // generated continuation token
            ipcSend({
                'type': 'webprot.cont-token', 'token': webprotDecStr(data)
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
    mainWindow.webContents.send('message', data)
}

function webprotConnect() {
    if(webprotState.connecting)
        return
    webprotState.connecting = true
    webprotState.sendPings = false
    webprotState.seqId = 0
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
        // Create a new state object
        webprotState.blobStates.push({
            'id': arg.id,
            'state': 'awaitingInfo',
            'progress': 0,
            'received': 0,
            'operId': arg.operId
        })

        // Get blob info
        webprotSendPacket({
            'type': 'blob-get',
            'id': arg.id,
            'operId': arg.previewOperId
        })
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
            'operId': arg.operId
        })

        // Get upload token
        webprotSendPacket({
            'type': 'blob-put',
            'operId': arg.operId,
            'name': arg.path,
            'length': len
        })
    } else if(arg.action == 'webprot.entity-put') {
        webprotSendPacket({
            'type': 'entities',
            'entities': arg.entities
        })
    }
})