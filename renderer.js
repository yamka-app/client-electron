const escapeHTML = require('escape-html')

const emailRegex = /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|'(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*')@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/

// Cached entities and blobs
var entityCache = {}
var blobCache = {}

// Input message sections
var msgSections = []

// Operation finish triggers
var endCallbacks = []

// The group and channel the user's in
var viewingGroup = 0
var viewingChan = 0
var viewingContactGroup = 0

function _rendererFunc() {
    const { ipcRenderer, remote, shell } = require('electron')
    const { BrowserWindow, dialog } = remote
    const fs = remote.require('fs')
    const path = require('path')
    const escapeHtml = require('escape-html')

    // Get the browser window
    var window = BrowserWindow.getFocusedWindow()

    // Try to log in using the continuation token
    var contToken = localStorage.getItem('contToken')
    if(contToken != undefined) {
        ipcSend({
            'action': 'webprot.login',
            'email': '___@cont@token@___',
            'password': contToken
        })
    }

    // Open a specific user settings tab
    function showUserSettingsTab(name) {
        // "Log out" is not really a tab
        if(name == 'user-settings-section-logout') {
            hideElm(document.getElementById('main-layout-container'))
            showElm(document.getElementById('login-form'))

            // Clear the continuation token
            localStorage.removeItem('contToken')

            // Send a logout notification
            ipcSend({
                'action': 'webprot.login',
                'email': '___@logout@___',
                'password': ''
            })
            return
        }

        // Hide all sections
        var sections = document.getElementsByClassName("user-settings-section")
        for(var i = 0; i < sections.length; i++)
            hideElm(sections[i])

        // Show the tab we need
        showElm(document.getElementById(name))
        document.getElementById(name + '-sel').checked = true
    }

    // Upload and download blobs
    function upload(path, onEnd, onProgressMade) {
        ipcSend({
            'action': 'webprot.blob-ul',
            'path': path,
            'blobOperId': regCallback(onEnd),
            'progressOperId': regCallback(onProgressMade)
        })
    }
    function download(id, onEnd, onPreviewAvailable) {
        if(blobCache[id] == undefined) {
            ipcSend({
                'action': 'webprot.blob-dl',
                'id': id,
                'blobOperId': regCallback(onEnd),
                'previewOperId': regCallback(onPreviewAvailable)
            })
        } else {
            if(onEnd != undefined)
                onEnd(blobCache[id])
        }
    }

    // Adjust the height of a TextArea
    function adjTaHeight() {
        this.rows = Math.min(this.value.split(/\r\n|\r|\n/).length, 10)
    }

    // Show and hide elements
    function showElm(element) {
        element.style.display = ''
    }
    function hideElm(element) {
        element.style.display = 'none'
    }
    function toggleElm(element) {
        if(element.style.display == 'none')
            showElm(element)
        else
            hideElm(element)
    }

    // Apply "appear" and "disappear" animations (optionally hiding and whowing the parent element)
    function triggerAppear(element, affectParent) {
        if(affectParent)
            showElm(element.parentElement)

        element.classList.remove('disappearing')
        element.classList.add('appearing')
    }
    function triggerDisappear(element, affectParent) {
        if(affectParent)
            setTimeout(() => hideElm(element.parentElement), 200);

        element.classList.remove('appearing')
        element.classList.add('disappearing')
    }

    // Show and hide the user settings panel
    function showUserSettings() {
        // Reset to the profile tab
        showUserSettingsTab('user-settings-section-profile')
        triggerAppear(document.getElementById('user-settings'), true)
    }
    function hideUserSettings() {
        triggerDisappear(document.getElementById('user-settings'), true)
    }

    // Show a floating box
    function showBox(header, text) {
        document.getElementById('floating-box-header').innerHTML = header
        document.getElementById('floating-box-text').innerHTML = text
        triggerAppear(document.getElementById('floating-box'), true)

        document.getElementById('floating-box-ok').addEventListener('click', (e) => {
            triggerDisappear(document.getElementById('floating-box'), true)
        })
    }

    // Send a data packet
    function ipcSend(data) {
        console.log('%c[SENDING]', 'color: #00bb00; font-weight: bold;', data)
        ipcRenderer.send('asynchronous-message', data)
    }

    // Update info about self
    function statusStr(status) {
        return ['offline', 'online', 'sleep', 'dnd'][status]
    }
    function statusIconPath(status) {
        return path.join(__dirname, 'icons/' + statusStr(status) + '.png')
    }
    function updateSelfStatus(status) {
        // Update the icon in the user bar
        document.getElementById('self-status').src = statusIconPath(status)

        // Update the switch in the user settings
        document.getElementById('self-status-' + statusStr(status)).checked = 'checked'

        // Update the explainer below the switch
        var explainer = [
            'You will appear offline but will have full access to everything',
            'You will appear online',
            'You will appear as sleeping but will have full access to everything',
            'You will not receive any notifications'
        ][status]
        document.getElementById('self-status-explainer').innerHTML = explainer
    }
    function updateSelfStatusText(statusText) {
        document.getElementById('self-status-text').innerHTML = escapeHtml(statusText)
        document.getElementById('self-status-text-change').value = statusText
    }
    function updateSelfName(name) {
        document.getElementById('self-name-change').value = name
        document.getElementById('self-nickname').innerHTML = escapeHtml(name)
    }
    function formatTag(tag) {
        return '#' + String(tag).padStart(5, '0')
    }
    function updateSelfTag(tag) {
        document.getElementById('self-tag').innerHTML = escapeHtml(formatTag(tag))
        document.getElementById('self-tag-settings').innerHTML = escapeHtml(formatTag(tag))
    }
    function updateSelfEmail(email) {
        document.getElementById('self-email-change').value = email
    }
    function updateSelfMfaStatus(mfaEnabled) {
        document.getElementById('self-mfa-enable-status').innerHTML = mfaEnabled ? 'ENABLED' : 'DISABLED'
        document.getElementById('self-mfa-toggle-button').innerHTML = (mfaEnabled ? 'DISABLE' : 'ENABLE') + ' 2FA'
    }
    function updateSelfAva(path) {
        document.getElementById('self-avatar').src = path
        document.getElementById('self-avatar-huge').src = path
    }
    function updateSelfInfo(name, tag, status, statusText, email, mfaEnabled) {
        updateSelfName(name)
        updateSelfTag(tag)
        updateSelfStatus(status)
        updateSelfStatusText(statusText)
        updateSelfEmail(email)
        updateSelfMfaStatus(mfaEnabled)
    }

    // Change info about self
    function sendSelfValue(key, val) {
        entity = {
            'type': 'user',
            'id': 0
        }
        entity[key] = val

        ipcSend({
            'action': 'webprot.entity-put',
            'entities': [entity]
        })
    }
    function setSelfStatus(status) {
        updateSelfStatus(status)
        sendSelfValue('status', status)
    }
    function setSelfStatusText(statusText) {
        updateSelfStatusText(statusText)
        sendSelfValue('statusText', statusText)
    }
    function setSelfName(name) {
        updateSelfName(name)
        sendSelfValue('name', name)
    }
    function setSelfEmail(email) {
        updateSelfEmail(email)
        sendSelfValue('email', email)
    }
    function setSelfMfaStatus(mfaStatus) {
        updateSelfMfaStatus(mfaStatus)
        remote.getGlobal('webprotState').self.mfaEnabled = mfaStatus
        sendSelfValue('mfaEnabled', mfaStatus)
    }

    // Registers a callback
    function regCallback(cb) {
        if(cb == undefined)
            return undefined
        
        var idx = endCallbacks.length
        endCallbacks[idx] = cb
        return idx
    }

    // Requests entities
    function reqEntities(ents, dontUseCached, cb) {
        if(ents.length == 0)
            return

        if(dontUseCached) {
            ipcSend({
                'action': 'webprot.entity-get',
                'entities': ents,
                'operId': regCallback(cb)
            })
        } else {
            var remaining_ents = []
            for(var i = 0; i < ents.length; i++)
                if(entityCache[ents[i].id] == undefined)
                    remaining_ents.push(ents[i])
            if(remaining_ents.length > 0) {
                ipcSend({
                    'action': 'webprot.entity-get',
                    'entities': remaining_ents,
                    'operId': regCallback(cb)
                })
            } else {
                if(cb != undefined)
                    cb()
            }
        }
    }

    // Updates all information about a user in the app
    function updateUser(id) {
        const user = entityCache[id]
        // Update avatars
        const avas = document.getElementsByClassName('user-avatar-' + id)
        if(avas.length > 0) {
            download(user.avaBlob, (blob) => {
                for(const ava of avas)
                    ava.src = 'file://' + blob.path
            })
        }

        // Update statuses
        const statuses = document.getElementsByClassName('user-online-' + id)
        for(const status of statuses)
            status.src = statusIconPath(user.status)

        // Update nicknames and tags
        const nicknames = document.getElementsByClassName('user-nickname-' + id)
        const tags = document.getElementsByClassName('user-tag-' + id)
        for(const name of nicknames)
            name.innerHTML = escapeHtml(user.name)
        for(const tag of tags)
            tag.innerHTML = escapeHtml(formatTag(user.tag))

        // Update status texts
        const statusTexts = document.getElementsByClassName('user-status-' + id)
        for(st of statusTexts)
            st.innerHTML = escapeHtml(user.statusText)
    }

    // Creates an element that should be placed in the member list
    function createUserSummary(id, special) {
        // Elements applied to all users
        var elm = document.createElement('div')
        elm.classList.add('user-summary')
        elm.classList.add('user-summary-' + id)

        var avaContainer = document.createElement('div')
        avaContainer.classList.add('user-avatar-container')
        elm.appendChild(avaContainer)

        var ava = document.createElement('img')
        ava.classList.add('user-avatar')
        ava.classList.add('user-avatar-' + id)
        avaContainer.appendChild(ava)

        var status = document.createElement('img')
        status.classList.add('user-online')
        status.classList.add('user-online-' + id)
        avaContainer.appendChild(status)

        var statusText = document.createElement('span')
        statusText.classList.add('user-status')
        statusText.classList.add('user-status-' + id)
        elm.appendChild(statusText)

        var nicknameContainer = document.createElement('div')
        nicknameContainer.classList.add('flex-row')
        nicknameContainer.classList.add('user-nickname-container')
        elm.appendChild(nicknameContainer)

        var nickname = document.createElement('span')
        nickname.classList.add('user-nickname')
        nickname.classList.add('user-nickname-' + id)
        nicknameContainer.appendChild(nickname)

        var tag = document.createElement('span')
        tag.classList.add('user-tag')
        tag.classList.add('user-tag-' + id)
        nicknameContainer.appendChild(tag)

        // Special users (friends, pending, blocked)
        if(special != undefined) {
            var friendRemoveBtn = document.createElement('button')
            friendRemoveBtn.classList.add('hover-show-button')
            friendRemoveBtn.classList.add('icon-button')
            friendRemoveBtn.classList.add('friend-remove-button')
            friendRemoveBtn.addEventListener('click', (e) => {
                ipcSend({
                    'action': 'webprot.manage-contacts',
                    'contactType': special,
                    'method': 'remove',
                    'id': id
                })
            })
            elm.appendChild(friendRemoveBtn)

            var friendRemoveImg = document.createElement('img')
            friendRemoveImg.src = path.join(__dirname, 'icons/friend_remove.png')
            friendRemoveBtn.appendChild(friendRemoveImg)
        }
        // Pending in users (add an accept button)
        if(special == 'pending-in') {
            var friendAcceptBtn = document.createElement('button')
            friendAcceptBtn.classList.add('hover-show-button')
            friendAcceptBtn.classList.add('icon-button')
            friendAcceptBtn.classList.add('friend-accept-button')
            friendAcceptBtn.addEventListener('click', (e) => {
                ipcSend({
                    'action': 'webprot.manage-contacts',
                    'contactType': 'friend',
                    'method': 'add',
                    'id': id
                })
            })
            elm.appendChild(friendAcceptBtn)

            var friendAcceptImg = document.createElement('img')
            friendAcceptImg.src = path.join(__dirname, 'icons/approve.png')
            friendAcceptBtn.appendChild(friendAcceptImg)
        }
        // Friends (open DMs when clicked)
        if(special == 'friend') {
            elm.addEventListener('click', (e) => {
                // Determine which channel we should switch to
                for(const chanId of remote.getGlobal('webprotState').self.channels) {
                    reqEntities([{'type':'channel', 'id':chanId}], false, () => {
                        const members = entityCache[chanId].members
                        if(members.length == 2 && members.every(mId => mId == id || mId == remote.getGlobal('webprotState').self.id)) {
                            viewingChan = chanId
                            updLayout()
                        }
                    })
                }
            })
        }

        return elm
    }

    // Updates the member list sidebar
    function updMemberList() {
        const memberList = document.getElementById('member-list-bar')

        // Remove all previous members
        while(memberList.firstChild)
            memberList.removeChild(memberList.firstChild)

        // Determine what users should end up in the member list
        var userIds = []
        // Group 0 = own direct messages
        if(viewingGroup == 0) {
            const self = remote.getGlobal('webprotState').self

            switch(viewingContactGroup) {
                case 0: // all my friends are watching, I can hear them talking
                case 1: // online friends
                    userIds = self.friends
                    break
                case 2: // pending in requests
                    userIds = self.pendingIn
                    break
                case 3: // pending out requests
                    userIds = self.pendingOut
                    break
                case 4: // blocked people
                    userIds = self.blocked
                    break
            }
        }

        // Request users
        const users = userIds.map(id => { return { 'type':'user', 'id':id } })
        reqEntities(users, false, () => {
            // Create summaries for each one and append them to the member list
            userIds.forEach(id => {
                if(viewingGroup == 0) { // special case for DMs
                    var add = true
                    if(viewingContactGroup == 1 && entityCache[id].status == 0) // don't add offline friends if we only want to see online ones
                        add = false
                    if(add) {
                        memberList.appendChild(createUserSummary(
                            id, ['friend', 'friend', 'pending-in', 'pending-out', 'blocked'][viewingContactGroup]
                        ))
                        updateUser(id)
                    }
                } else {
                    memberList.appendChild(createUserSummary(id))
                }
            })
        })
    }

    // Creates an input message section
    function createInputSection(type, id, removeCb, filename, fileSize) {
        const section = document.createElement('div')
        section.classList.add('message-section', 'message-section-' + type, 'flex-row', 'message-section-' + id)
        section.id = 'message-section-' + id

        const removeBtn = document.createElement('button')
        removeBtn.classList.add('icon-button')
        section.appendChild(removeBtn)
        removeBtn.addEventListener('click', removeCb)

        const removeImg = document.createElement('img')
        removeImg.src = path.join(__dirname, 'icons/remove_section.png')
        removeBtn.appendChild(removeImg)

        var typeElm

        switch(type) {
            case 'text':
                typeElm = document.createElement('textarea')
                typeElm.classList.add('message-input', 'fill-width')
                typeElm.placeholder = 'Text section'
                typeElm.rows = 1
                typeElm.oninput = adjTaHeight
                break
            case 'file':
                typeElm = document.createElement('div')
                typeElm.classList.add('message-file-section', 'flex-col')

                var readableSize = ''
                if(fileSize < 1024)
                    readableSize = fileSize + ' B'
                else if(fileSize >= 1024 * 1024)
                    readableSize = (fileSize / (1024 * 1024)).toFixed(2) + ' MiB'
                else if(fileSize >= 1024)
                    readableSize = (fileSize / 1024).toFixed(2) + ' KiB'

                const headerSpan = document.createElement('span')
                headerSpan.innerHTML = 'File (' + readableSize + '):'
                headerSpan.classList.add('message-file-header-span')
                typeElm.appendChild(headerSpan)

                const nameSpan = document.createElement('code')
                nameSpan.innerHTML = escapeHtml(filename)
                typeElm.appendChild(nameSpan)

                const progress = document.createElement('progress')
                progress.classList.add('fill-width')
                typeElm.appendChild(progress)
                progress.max = 100
                progress.value = 0 
                break
            case 'code':
                typeElm = document.createElement('textarea')
                typeElm.classList.add('code-input', 'fill-width')
                typeElm.placeholder = 'Code section'
                typeElm.rows = 1
                typeElm.oninput = adjTaHeight
                typeElm.spellcheck = false
                break
        }
        section.appendChild(typeElm)

        // Append the section
        const container = document.getElementById('message-input-container')
        container.insertBefore(section, container.lastChild)

        // Play an animation
        triggerAppear(section)

        msgSections.push({ 'type':type, 'typeElm':typeElm, 'elm':section })
    }

    // Removes an input message section
    function removeInputSection(id) {
        // Find the element
        const elm = document.getElementById('message-section-' + id)
        // Remove it
        for(var i = 0; i < msgSections.length; i++) {
            if(msgSections[i].elm == elm) {
                msgSections.splice(i, 1);
                break
            }
        }
        triggerDisappear(elm)
        setTimeout(() => elm.remove(), 200)

        // If there are no elements left, create an empty one
        if(msgSections.length == 0)
            resetMsgInput()
    }

    // Resets the message input field
    function resetMsgInput() {
        const container = document.getElementById('message-input-container')

        // Remove all sections
        for(var i = container.children.length - 1; i >= 0; i--) {
            const child = container.children[i]
            if(child.id != 'message-section-add-btns')
                child.remove()
        }

        msgSections = []

        // Add a default section
        const id = msgSections.length
        createInputSection('text', id, () => {
            removeInputSection(id)
        })
    }

    // Updates the message area
    function updMessageArea() {

    }

    // Updates the layout: member list, messages, etc.
    function updLayout() {
        console.log('Updating layout, gId=' + viewingGroup + ', cId=' + viewingChan + ', cgId=' + viewingContactGroup)

        // Show or hide the friend hedaer
        const friendHeader = document.getElementById('member-list-friend-header')
        if(viewingGroup == 0)
            showElm(friendHeader)
        else
            hideElm(friendHeader)

        // Show or hide the channel list
        const channelList = document.getElementById('channel-list-sidebar')
        if(viewingGroup == 0)
            hideElm(channelList)
        else
            showElm(channelList)

        updMemberList()
        updMessageArea()
    }
    
    // Packet reception handler
    function ipcRecv(evt, arg) {
        if(arg.type != 'webprot.status' && arg.type != 'webprot.ul-progress')
            console.log('%c[RECEIVED]', 'color: #bb0000; font-weight: bold;', arg)
        switch(arg.type) {
            case 'webprot.status':
                    console.log('%c[STATUS]', 'color: #6440a5; font-weight: bold;', arg.message)
                break

            case 'webprot.2fa-required':
                hideElm(document.getElementById('login-form'))
                showElm(document.getElementById('mfa-form'))

                document.getElementById('mfa-login-button').addEventListener('click', (e) => {
                    ipcSend({
                        'action': 'webprot.login',
                        'email': '___@mfa@token@___',
                        'password': document.getElementById('login-mfa-code').value
                    })
                })
                break

            case 'webprot.login-success':
                // Show the main UI
                hideElm(document.getElementById('login-form'))
                hideElm(document.getElementById('mfa-form'))
                hideElm(document.getElementById('signup-form'))
                showElm(document.getElementById('main-layout-container'))

                // Request info about self
                ipcSend({
                    'action': 'webprot.entity-get',
                    'entities': [
                        {'type': 'user', 'id': 0}
                    ]
                })

                // Clear input fields
                document.getElementById('login-email').value = ''
                document.getElementById('login-password').value = ''
                document.getElementById('login-mfa-code').value = ''
                document.getElementById('signup-username').value = ''
                document.getElementById('signup-email').value = ''
                document.getElementById('signup-password').value = ''

                // Reset all caches
                entityCache = {}
                blobCache = {}
                endCallbacks = []

                // Reset the view
                viewingGroup = 0
                viewingChan = 0
                viewingContactGroup = 0
                resetMsgInput()
                break

            case 'webprot.login-err':
                showBox('LOGIN ERROR', arg.message)
                document.getElementById('login-password').value = ''
                break

            case 'webprot.signup-err':
                showBox('SIGNUP ERROR', arg.message)
                document.getElementById('signup-password').value = ''
                break

            case 'webprot.outdated':
                showBox('OUTDATED CLIENT', arg.message)
                break

            case 'webprot.rate-limit':
                showBox('RATE LIMITING', arg.message)
                break

            case 'webprot.entities':
                arg.entities.forEach((entity) => {
                    // Add entities to the entity list
                    entityCache[entity.id] = entity

                    // Update info about self
                    if(entity.id == remote.getGlobal('webprotState').self.id) {
                        remote.getGlobal('webprotState').self = entity
                        updateSelfInfo(entity.name, entity.tag, entity.status, entity.statusText, entity.email, entity.mfaEnabled)

                        // Request self avatar
                        download(entity.avaBlob, (blob) => {
                            updateSelfAva(blob.path)
                        })

                        // Update DM list
                        updLayout()
                    }

                    // Update info about other users
                    if(entity.type == 'user')
                        updateUser(entity.id)
                })
                break

            case 'webprot.dl-end':
                // Add the blob to the blob cache
                var blob = arg.state.info
                blobCache[blob.id] = blob

                // Trigger the download end trigger
                endCallbacks[arg.state.operId](blob)
                break

            case 'webprot.ul-end':
                // Add the blob to the blob cache
                var blob = arg.state.info
                blobCache[blob.id] = blob

                // Trigger the upload end trigger
                endCallbacks[arg.state.operId](blob.id)
                break

            case 'webprot.ul-progress':
                // Call the callback
                endCallbacks[arg.operId](arg.progress, arg.max)
                break

            case 'webprot.mfa-secret':
                // Construct the string to put into the QR code
                var qrString = 'otpauth://totp/'
                               + encodeURIComponent(remote.getGlobal('webprotState').self.email)
                               + '?secret='
                               + arg.secret
                               + '&issuer=Order'
                var qr = qrcode(10, 'L')
                qr.addData(qrString)

                // Generate the code
                qr.make()
                document.getElementById('mfa-qr-placeholder').innerHTML = qr.createSvgTag(3)

                // Show the banner
                triggerAppear(document.getElementById('mfa-qr-banner'), true)
                break

            case 'webprot.cont-token':
                // Store the token
                localStorage.setItem('contToken', arg.token)
                break

            case 'webprot.completion-notification':
                // Call the callback
                var cb = endCallbacks[arg.operId]
                cb()

                // Remove the element
                delete endCallbacks[arg.operId]
                if(endCallbacks.every(x => x == undefined))
                    endCallbacks = []
        }
    }
    ipcRenderer.on('message', ipcRecv)

    // Add listeners to window control buttons
    document.getElementById('minimize-button').addEventListener('click', (e) => {
        window.minimize()
    })
    document.getElementById('maximize-button').addEventListener('click', (e) => {
        if(window.isMaximized())
            window.unmaximize()
        else
            window.maximize()
    })
    document.getElementById('close-button').addEventListener('click', (e) => {
        window.hide()
    })

    // Add listeners to login controls
    document.getElementById('login-button').addEventListener('click', (e) => {
        var email = document.getElementById('login-email').value
        var password = document.getElementById('login-password').value
        ipcSend({
            'action': 'webprot.login',
            'email': email,
            'password': password
        })
    })

    document.getElementById('login-signup-button').addEventListener('click', (e) => {
        document.getElementById('signup-form').style = 'display: show;'
        document.getElementById('login-form').style = 'display: none;'
    })

    // Add listeners to signup controls
    document.getElementById('signup-back-button').addEventListener('click', (e) => {
        document.getElementById('login-form').style = 'display: show;'
        document.getElementById('signup-form').style = 'display: none;'
    })

    document.getElementById('signup-password').addEventListener('input', (e) => {
        // Reference components
        var strongRegex = new RegExp('^(?=.{10,})(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*\\W).*$', 'g')
        var mediumRegex = new RegExp('^(?=.{8,})(((?=.*[A-Z])(?=.*[a-z]))|((?=.*[A-Z])(?=.*[0-9]))|((?=.*[a-z])(?=.*[0-9]))).*$', 'g')
        var password = document.getElementById('signup-password').value
        var passwordStrengthText = document.getElementById('password-strength-text')
        var passwordStrengthMeter = document.getElementById('password-strength-meter')

        // Display the strength to the user
        if(password.length == 0) {
            passwordStrengthText.innerHTML = ''
            passwordStrengthMeter.value = 0
        } else if(password.length < 6) {
            passwordStrengthText.style = 'color: var(--red)'
            passwordStrengthText.innerHTML = 'TOO SHORT'
            passwordStrengthMeter.value = 0
            passwordStrengthMeter.className = 'fill-width ' + 'password-weak'
        } else if(strongRegex.test(password)) {
            passwordStrengthText.style = 'color: var(--green)'
            passwordStrengthText.innerHTML = 'STRONG'
            passwordStrengthMeter.value = 3
            passwordStrengthMeter.className = 'fill-width ' + 'password-strong'
        } else if(mediumRegex.test(password)) {
            passwordStrengthText.style = 'color: var(--yellow)'
            passwordStrengthText.innerHTML = 'MEDIUM'
            passwordStrengthMeter.value = 2
            passwordStrengthMeter.className = 'fill-width ' + 'password-medium'
        } else {
            passwordStrengthText.style = 'color: var(--red)'
            passwordStrengthText.innerHTML = 'WEAK'
            passwordStrengthMeter.value = 1
            passwordStrengthMeter.className = 'fill-width ' + 'password-weak'
        }
    })

    document.getElementById('signup-button').addEventListener('click', (e) => {
        // Check everything
        var username = document.getElementById('signup-username').value
        var email = document.getElementById('signup-email').value
        var password = document.getElementById('signup-password').value
        var proceed = true;
        var passwordStrengthText = document.getElementById('password-strength-text')

        if(!emailRegex.test(email)) {
            document.getElementById('email-required').style = 'color: var(--red); display: show;'
            proceed = false
        } else {
            document.getElementById('email-required').style = 'color: var(--red); display: none;'
        }

        if(password.length < 6) {
            passwordStrengthText.style = 'color: #d12b2b'
            passwordStrengthText.innerHTML = 'TOO SHORT'
            proceed = false
        }
            
        if(username.length == 0) {
            document.getElementById('username-required').style = 'color: var(--red); display: show;'
            proceed = false
        } else {
            document.getElementById('username-required').style = 'color: var(--red); display: none;'
        }

        if(proceed) {
            ipcSend({
                'action': 'webprot.signup',
                'email': email,
                'name': username,
                'password': password
            })
        }
    })

    // Add listeners that open and close the user settings panel
    document.getElementById('self-avatar').addEventListener('click', showUserSettings)
    document.getElementById('self-nickname').addEventListener('click', showUserSettings)
    document.getElementById('user-settings-exit').addEventListener('click', hideUserSettings)
    document.getElementById('user-settings-bg').addEventListener('click', hideUserSettings)

    document.getElementById('user-settings').addEventListener('click', evt => {
        evt.stopPropagation()
        evt.cancelBubble = true
    })

    // Status changing
    document.querySelectorAll('input[name="user-settings-sections"]').forEach((element) => {
        element.addEventListener('click', (event) => {
            showUserSettingsTab(element.id.substring(0, element.id.length - 4))
        })
    })

    // Various text peoperties changing
    var statusTextChange = document.getElementById('self-status-text-change')
    statusTextChange.addEventListener('keypress', (evt) => {
        if(evt.keyCode == 13) // Enter
            setSelfStatusText(statusTextChange.value)
    })
    var usernameChange = document.getElementById('self-name-change')
    usernameChange.addEventListener('keypress', (evt) => {
        if(evt.keyCode == 13) // Enter
            setSelfName(usernameChange.value)
    })
    var emailChange = document.getElementById('self-email-change')
    emailChange.addEventListener('keypress', (evt) => {
        if(evt.keyCode == 13) // Enter
            setSelfEmail(emailChange.value)
    })

    // 2FA toggling
    document.getElementById('self-mfa-toggle-button').addEventListener('click', (evt) => {
        // Disable it if enabled, enable if disabled
        setSelfMfaStatus(!remote.getGlobal('webprotState').self.mfaEnabled)
    })

    // 2FA floating box closing
    document.getElementById('mfa-qr-ok').addEventListener('click', (evt) => {
        triggerDisappear(document.getElementById('mfa-qr-banner'), true)
    })

    // Floaty stuffs closing
    document.onkeydown = function(evt) {
        evt = evt || window.event
        if (evt.keyCode == 27)
            hideUserSettings()
    }

    // Add listeners to self status selectors
    // We can't query multiple sections and just iterate them :(
    document.getElementById('self-status-offline').addEventListener('click', evt => setSelfStatus(0))
    document.getElementById('self-status-online') .addEventListener('click', evt => setSelfStatus(1))
    document.getElementById('self-status-sleep')  .addEventListener('click', evt => setSelfStatus(2))
    document.getElementById('self-status-dnd')    .addEventListener('click', evt => setSelfStatus(3))

    // User avatar selection
    document.getElementById('self-avatar-huge').addEventListener('click', () => {
        var newAvaPath = dialog.showOpenDialogSync(window, {
            properties: ['openFile'],
            filters: [
                { name: 'Images', extensions: ['jpg', 'png', 'gif', 'bmp'] }
            ]
        })
        // Don't if the user decided not to
        if(newAvaPath == undefined)
            return

        newAvaPath = newAvaPath[0]
        upload(newAvaPath, (id) => {
            // When uploaded, download it (so it is cached and appears in out temp dir)
            download(id, (blob) => {
                updateSelfAva(blob.path)
            })
            // Update the blob ID
            sendSelfValue('avaBlob', id)
        })
    })

    // Theme switching
    document.getElementById('theme-switch').addEventListener('change', (e) => {
        if(document.getElementById('theme-switch').checked)
            document.getElementById('theme-css').href = 'themes/light.css'
        else
            document.getElementById('theme-css').href = 'themes/dark.css'
    })

    // "About Order" buttons
    document.getElementById('view-on-github').addEventListener('click', (e) => {
        shell.openExternal("https://github.com/ordermsg")
    })

    // Friend control buttons
    document.getElementById('friends-all').addEventListener('click', (e) => {
        viewingGroup = 0
        viewingContactGroup = 0
        updLayout()
    })
    document.getElementById('friends-online').addEventListener('click', (e) => {
        viewingGroup = 0
        viewingContactGroup = 1
        updLayout()
    })
    document.getElementById('friends-pending-in').addEventListener('click', (e) => {
        viewingGroup = 0
        viewingContactGroup = 2
        updLayout()
    })
    document.getElementById('friends-pending-out').addEventListener('click', (e) => {
        viewingGroup = 0
        viewingContactGroup = 3
        updLayout()
    })
    document.getElementById('friends-blocked').addEventListener('click', (e) => {
        viewingGroup = 0
        viewingContactGroup = 4
        updLayout()
    })
    document.getElementById('friend-add').addEventListener('click', (e) => {
        toggleElm(document.getElementById('user-search-bar'))
    })
    document.getElementById('friend-add-commit').addEventListener('click', (e) => {
        ipcSend({
            'action': 'webprot.search-user',
            'name': document.getElementById('user-search-input').value,
        })
    })

    // Message section buttons
    document.getElementById('message-text-section-button').addEventListener('click', (e) => {
        const id = msgSections.length
        createInputSection('text', id, () => {
            removeInputSection(id)
        })
    })
    document.getElementById('message-file-section-button').addEventListener('click', (e) => {
        // Select the file
        var filePath = dialog.showOpenDialogSync(window, {
            properties: ['openFile'],
            filters: [
                { name: 'All files', extensions: ['*'] },
                { name: 'Images', extensions: ['jpg', 'png', 'gif', 'bmp'] },
                { name: 'Videos', extensions: ['mp4', 'mkv', 'avi'] },
                { name: 'Audio', extensions: ['mp3', 'wav', 'flac'] }
            ]
        })
        // Don't continue if the user decided not to
        if(filePath == undefined)
            return
        filePath = filePath[0]

        // Add the section
        const id = msgSections.length
        createInputSection('file', id, () => {
            removeInputSection(id)
        }, filePath, fs.statSync(filePath).size)

        const fileProgressBar = msgSections[id].typeElm.getElementsByTagName('progress')[0]

        // Upload the file
        upload(filePath, (blobId) => {
            msgSections[id].blobId = blobId
            fileProgressBar.remove()
        }, (progress, max) => {
            fileProgressBar.max = max
            fileProgressBar.value = progress
        })
    })
    document.getElementById('message-code-section-button').addEventListener('click', (e) => {
        const id = msgSections.length
        createInputSection('code', id, () => {
            removeInputSection(id)
        })
    })
}

window.addEventListener('load', _rendererFunc)