const escapeHTML = require('escape-html')
const { on } = require('process')
const { decode } = require('blurhash')

const hljs = require('highlight.js')
const marked = require("marked");
var remark = require('remark')
var gemojiToEmoji = require('remark-gemoji-to-emoji')

const { create } = require('domain')
const { url } = require('inspector')

hljs.configure({ useBR: true })

marked.setOptions({
    gfm: true,
    headerIds: false,
    highlight: false,
    silent: true,
    smartLists: true
})

const emailRegex = /(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|'(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21\x23-\x5b\x5d-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])*')@(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|\[(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?|[a-z0-9-]*[a-z0-9]:(?:[\x01-\x08\x0b\x0c\x0e-\x1f\x21-\x5a\x53-\x7f]|\\[\x01-\x09\x0b\x0c\x0e-\x7f])+)\])/
const allEmojiRegex = /^<span>\p{Emoji}{1,5}<\/span>$/gum

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
var editingChan = 0
var viewingContactGroup = 0

function _rendererFunc() {
    const { ipcRenderer, remote, shell, clipboard } = require('electron')
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

    // Upload and download blobs
    function upload(path, onEnd, onProgressMade) {
        ipcSend({
            'action': 'webprot.blob-ul',
            'path': path,
            'blobOperId': regCallback(onEnd),
            'progressOperId': regCallback(onProgressMade)
        })
    }
    function download(id, onEnd, onPreviewAvailable, actuallyDownload=true) {
        if(blobCache[id] != undefined && onPreviewAvailable == undefined && onEnd != undefined) {
            onEnd(blobCache[id])
        } else {
            ipcSend({
                'action': 'webprot.blob-dl',
                'id': id,
                'blobOperId': regCallback(onEnd),
                'previewOperId': regCallback(onPreviewAvailable),
                'actuallyDownload': actuallyDownload
            })
        }
    }

    // Adjust the height of a TextArea
    function adjTaHeight(elm) {
        elm.rows = Math.min(elm.value.split(/\r\n|\r|\n/).length, 10)
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

    // Creates an acronym for a group name
    function groupNameAcronym(name) {
        return escapeHtml(name.split(' ').map(x => x.charAt(0)).join(''))
    }

    // Shows a channel in the group settings
    function groupSettingsShowChannel(id) {
        editingChan = id
        document.getElementById('channel-name-change').value = entityCache[id].name
    }

    function updateGroupSettingsChannelList() {
        if(viewingGroup == 0)
            return

        const channelList = document.getElementById('group-settings-channel-list')
        const channels = entityCache[viewingGroup].channels
        reqEntities(channels.map(x => { return { type: 'channel', id: x } }), false, () => {
            while(channelList.firstChild)
                channelList.firstChild.remove()
            for(let chanId of channels) {
                const elm = createChannelButton(chanId, (e) => { groupSettingsShowChannel(chanId) }, false)
                channelList.append(elm)
            }
        })
    }

    // Shows/hides group settings
    function showGroupSettings() {
        // Load group info
        const group = entityCache[viewingGroup]
        document.getElementById('group-name-change').value = escapeHtml(group.name)
        triggerAppear(document.getElementById('group-settings'), true)

        showGroupSettingsTab('group-settings-section-general')
        groupSettingsShowChannel(entityCache[viewingGroup].channels[0])

        // Load settings
        // Channel list
        updateGroupSettingsChannelList()

        if(group.icon != 0) {
            download(group.icon, (b) => {
                document.getElementById('group-icon-huge').src = 'file://' + b.path
            })
        }
    }
    function hideGroupSettings() {
        triggerDisappear(document.getElementById('group-settings'), true)
    }
    function showGroupSettingsTab(name) {
        // "Delete group" is not really a tab
        if(name == 'group-settings-section-delete') {
            ipcSend({ // change da world, my final message.. goodbye
                action: 'webprot.entity-put',
                entities: [{
                    type:  'group',
                    id:    viewingGroup,
                    owner: 0
                }]
            })
            viewingGroup = 0
            viewingChan = 0
            editingChan = 0
            updLayout()
            hideGroupSettings()
            return
        }

        // Hide all sections
        var sections = document.getElementsByClassName("group-settings-section")
        for(var i = 0; i < sections.length; i++)
            hideElm(sections[i])

        // Show the tab we need
        showElm(document.getElementById(name))
        document.getElementById(name + '-sel').checked = true
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

    // Converts an ID into a time string
    function idToTime(id) {
        const timestamp = Number((BigInt(id) >> 16n) + 1577836800000n)
        const date = new Date(timestamp)
        return date.toLocaleString()
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
        document.getElementById('self-nickname').innerHTML = escapeHtml(name)
        document.getElementById('self-name-change').value = name
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

    // Updates all information about a group
    function updateGroup(id) {
        const group = entityCache[id]
        // Update icons
        const icons = document.getElementsByClassName('group-icon-' + id)
        if(icons.length > 0 && group.icon !== 0) {
            download(group.icon, (blob) => {
                for(const icon of icons)
                    icon.src = 'file://' + blob.path
            })
        } else if(group.icon === 0) {
            for(const icon of icons)
                icon.innerHTML = groupNameAcronym(group.name)
        }

        // Update the channel list
        if(id === viewingGroup)
            updChannelList()
        updateGroupSettingsChannelList()
    }

    // Updates all information about a user
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
                // Get all channel entities
                var channels = remote.getGlobal('webprotState').self.channels
                for(var i = 0; i < channels.length; i++)
                {
                    channels[i] = {
                        'type':'channel', 'id':channels[i],
                        'pageField': 2, // members,
                        'pageFrom': 0,
                        'pageDir': true, // older first
                        'pageCnt': 50
                    }
                }
                reqEntities(channels, false, () => {
                    for(const chanId of remote.getGlobal('webprotState').self.channels) {
                        // The DM channel with two members (self and target user) is the resulting channel
                        const members = entityCache[chanId].members
                        if(members.length == 2
                            && members.every(mId => mId == id || mId == remote.getGlobal('webprotState').self.id)) {
                            viewingChan = chanId
                            updLayout()
                        }
                    }
                })
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
            const friendType = document.getElementById('member-list-friend-type')

            friendType.innerHTML = escapeHtml(
                ['ALL FRIENDS',
                 'ONLINE FRIENDS',
                 'INCOMING REQUESTS',
                 'OUTGOING REQUESTS',
                 'BANNED'][viewingContactGroup])

            userIds = [self.friends, self.friends, self.pendingIn, self.pendingOut, self.blocked][viewingContactGroup]
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

    // Returns a human readable file size
    function readableFileSize(fileSize) {
        if(fileSize < 1024)
            return fileSize + ' B'
        else if(fileSize >= 1024 * 1024)
            return (fileSize / (1024 * 1024)).toFixed(2) + ' MiB'
        else if(fileSize >= 1024)
            return (fileSize / 1024).toFixed(2) + ' KiB'
    }

    // Sends the message
    function sendMessage() {
        var sects = msgSections

        for(var i = 0; i < sects.length; i++) {
            const typeName = sects[i].type
            if(typeName == 'text' || typeName == 'code' || typeName == 'quote')
                sects[i].text = sects[i].typeElm.value

            // Abort if any of the files haven't been uploaded yet
            if(typeName == 'file' && sects[i].blob == undefined)
                return

            sects[i].elm = undefined
            sects[i].typeElm = undefined
        }

        ipcSend({
            'action': 'webprot.entity-put',
            'entities': [
                {
                    'type': 'message',
                    'id': 0,
                    'sections': sects,
                    'channel': viewingChan
                }
            ]
        })

        resetMsgInput()
    }

    // Creates an input message section
    function createInputSection(type, id, removeCb, filename, fileSize) {
        const section = document.createElement('div')
        section.classList.add('message-section', 'message-section-' + type, 'flex-row', 'message-section-' + id)
        section.id = 'message-section-' + id

        const removeBtn = document.createElement('button')
        removeBtn.classList.add('icon-button', 'cg-button')
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
                typeElm.oninput = () => adjTaHeight(typeElm)
                break
            case 'file':
                typeElm = document.createElement('div')
                typeElm.classList.add('message-file-section', 'flex-col')

                const readableSize = readableFileSize(fileSize)

                const headerSpan = document.createElement('span')
                headerSpan.innerHTML = 'File (' + readableSize + '):'
                headerSpan.classList.add('message-file-header')
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
                typeElm.oninput = () => adjTaHeight(typeElm)
                typeElm.spellcheck = false
                break
            case 'quote':
                typeElm = document.createElement('textarea')
                typeElm.classList.add('message-input', 'fill-width', 'message-quote-section')
                typeElm.placeholder = 'Quote section'
                typeElm.rows = 1
                typeElm.oninput = () => adjTaHeight(typeElm)
                break
        }
        section.appendChild(typeElm)

        // Append the section
        const container = document.getElementById('message-input-container')
        container.insertBefore(section, container.lastChild)

        // Play an animation
        triggerAppear(section)

        // Send the message when pressing enter, insert a line break with shift+enter
        section.addEventListener('keypress', (e) => {
            if(e.keyCode == 13 && !e.shiftKey) {
                e.stopPropagation()
                e.stopImmediatePropagation()
                sendMessage()
                // idk why, it inserts a line break there
                setTimeout(() => msgSections[0].typeElm.value = '', 1)
            }
        })

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

        // Focus on it
        msgSections[id].typeElm.focus()
    }

    // Generates a summary text of the message
    function messageSummary(id) {
        const msg = entityCache[id]
        var summary = ''
        for(section of msg.sections) {
            if(section.type == 'text' || section.type == 'code') {
                summary = section.text
                break
            }
        }
        // If there's no text in the message, find a file
        if(summary == '') {
            for(section of msg.sections) {
                if(section.type == 'file') {
                    summary = 'File'
                    break
                }
            }
        }
        // If there's still nothing
        if(summary == '')
            summary = 'Empty message'

        return summary
    }

    // Prepares message text (sanitizes it and inserts line breaks)
    function prepareMsgText(txt) {
        return escapeHtml(txt).replace(/(?:\r\n|\r|\n)/g, '<br>')
    }
    function markupText(txt) {
        return remark().use(gemojiToEmoji).processSync(    // emoji parser
            ('<span>' +
            marked.parseInline(                            // Markdown parser
            escapeHtml(txt)) +                             // no XSS for 'ya today, sorry
            '</span>')
            .replace(/(?:\r\n|\r|\n)/g, '</span><span>'))  // insert line breaks
            .contents
    }

    // Shows/hides a floating message
    function showFloatingMessage(id) {
        const floatingMessage = document.getElementById('floating-message')
        // Remove old junk
        while(floatingMessage.firstChild)
            floatingMessage.firstChild.remove()

        // Create the message
        const message = createMessage(id)
        message.style.margin = '0'
        floatingMessage.appendChild(message)
        updateUser(entityCache[id].sender)

        triggerAppear(floatingMessage, true)
    }
    function hideFloatingMessage() {
        const floatingMessage = document.getElementById('floating-message')
        triggerDisappear(floatingMessage, true)
    }

    // Show/hides a floating image
    function showFloatingImage(id) {
        // Remove the old image
        const floatingImageBg = document.getElementById('floating-image-bg')
        var floatingImage = document.getElementById('floating-image')
        if(floatingImage)
            floatingImage.remove()

        // Create the image
        download(id, (blob) => {
            floatingImage = document.createElement('img')
            floatingImage.id = 'floating-image'
            floatingImage.src = 'file://' + blob.path
            floatingImageBg.appendChild(floatingImage)
            triggerAppear(floatingImage, true)
        })
    }
    function hideFloatingImage() {
        const floatingImage = document.getElementById('floating-image')
        if(floatingImage)
            triggerDisappear(floatingImage, true)
    }

    // Shows/hides the group create box
    function showGroupCreateBox() {
        const groupCreateBox = document.getElementById('group-create-box')
        triggerAppear(groupCreateBox, true)
    }
    function hideGroupCreateBox() {
        const groupCreateBox = document.getElementById('group-create-box')
        triggerDisappear(groupCreateBox, true)
    }

    // Parses URL hostname
    function parseHostname(url) {
        var match = url.match(/:\/\/(www[0-9]?\.)?(.[^/:]+)/i)
        if (match != null && match.length > 2 && typeof match[2] === 'string' && match[2].length > 0) {
            return match[2];
        } else {
            return null;
        }
    }

    // Parses a URL parameter
    function parseUrlParameter(url, param) {
        url = url.split('?')[1]
        var urlVars = url.split('&')
    
        for (var i = 0; i < urlVars.length; i++) {
            var parName = urlVars[i].split('=')
            if (parName[0] === param)
                return parName[1] === undefined ? true : parName[1]
        }
    }

    // Creates a message box seen in the message area
    function createMessage(id) {
        // Get the message entity by the id
        const msg = entityCache[id]

        const elm = document.createElement('div')
        elm.classList.add('message', 'message-' + msg.id, 'flex-row')

        const avaContainer = document.createElement('div')
        avaContainer.classList.add('message-avatar-container')
        elm.appendChild(avaContainer)

        const ava = document.createElement('img')
        ava.classList.add('user-avatar', 'message-avatar', 'user-avatar-' + msg.sender)
        avaContainer.appendChild(ava)

        const content = document.createElement('div')
        content.classList.add('message-content', 'flex-col')
        elm.appendChild(content)

        var nicknameContainer = document.createElement('div')
        nicknameContainer.classList.add('flex-row')
        content.appendChild(nicknameContainer)

        const nickname = document.createElement('span')
        nickname.classList.add('message-user-nickname', 'user-nickname-' + msg.sender)
        nicknameContainer.appendChild(nickname)

        const timeElm = document.createElement('span')
        timeElm.classList.add('message-time')
        timeElm.innerHTML = escapeHtml(idToTime(id))
        nicknameContainer.appendChild(timeElm)

        for(const section of msg.sections) {
            var sectionElement = null
            switch(section.type) {
                case 'text':
                    // Just plain text
                    sectionElement = document.createElement('div')
                    sectionElement.classList.add('message-text-section')
                    const text = markupText(section.text)
                    sectionElement.innerHTML = text
                    twemoji.parse(sectionElement, { folder: 'svg', ext: '.svg' })
                    // If the text cosists of emojis only, increase their size
                    //console.log(text, allEmojiRegex.test(text), text.match(allEmojiRegex))
                    if(allEmojiRegex.test(text)) {
                        const emojis = sectionElement.getElementsByTagName("img")
                        for(const emoji of emojis)
                            emoji.classList.add('large-emoji')
                    }
                    break
                case 'code':
                    // A code box with highlighting and a copy button
                    sectionElement = document.createElement('pre')
                    sectionElement.classList.add('message-code-section')
                    sectionElement.innerHTML = prepareMsgText(section.text)
                    hljs.highlightBlock(sectionElement)

                    const copyButton = document.createElement('button')
                    copyButton.classList.add('icon-button')
                    content.appendChild(copyButton)

                    copyButton.onclick = (e) => {
                        e.stopPropagation()
                        clipboard.writeText(section.text)
                    }

                    const copyImg = document.createElement('img')
                    copyImg.src = path.join(__dirname, 'icons/copy.png')
                    copyButton.appendChild(copyImg)

                    break
                case 'file':
                    const fileSectionElement = document.createElement('div') // a temporary replacement
                    content.appendChild(fileSectionElement)
                    download(section.blob, undefined, (name, size, preview, hash, length) => { // called when info becomes available
                        // Check if it's an image
                        const extenstion = name.split('.').pop()
                        if(['png', 'jpg', 'gif', 'bmp'].includes(extenstion)) {
                            const w = Number(size.split('x')[0])
                            const h = Number(size.split('x')[1])

                            // Create the image element
                            const imgElement = document.createElement('img')
                            imgElement.classList.add('message-img-section')
                            //imgElement.width = w
                            //imgElement.height = h
                            
                            // Create the preview element
                            const canvasElement = document.createElement('canvas')
                            canvasElement.classList.add('message-img-section')
                            canvasElement.width = w
                            canvasElement.height = h

                            const adjW = (32 * w / h).toFixed(0) // to preserve the aspect ratio
                            const pixels = decode(preview, adjW, 32);
                            const ctx = canvasElement.getContext('2d');
                            const imageData = ctx.createImageData(adjW, 32);
                            imageData.data.set(pixels);
                            ctx.putImageData(imageData, 0, 0);
                            // Scale it (blurhash decoding is too slow, scaling is faster)
                            const imageObj = new Image(adjW, 32)
                            imageObj.onload = () => {
                                ctx.clearRect(0, 0, w, h)
                                ctx.scale(w / adjW, h / 32)
                                ctx.drawImage(imageObj, 0, 0)
                            }
                            imageObj.src = canvasElement.toDataURL()

                            fileSectionElement.appendChild(canvasElement)
                            // Append the image as a child
                            fileSectionElement.appendChild(imgElement)

                            // Download the image
                            download(section.blob, (blob) => {
                                // Set the image source
                                imgElement.src = 'file://' + blob.path
                                // Remove the preview element
                                canvasElement.remove()
                                // Enlarge the image when clicking on it
                                imgElement.onclick = (e) => {
                                    e.stopPropagation()
                                    e.stopImmediatePropagation()
                                    showFloatingImage(section.blob)
                                }
                            })
                        } else {
                            fileSectionElement.classList.add('message-file-section', 'flex-row')

                            const info = document.createElement('div')
                            info.classList.add('file-section-info', 'flex-col')
                            fileSectionElement.appendChild(info)

                            const sizeElm = document.createElement('div')
                            sizeElm.classList.add('message-file-header')
                            sizeElm.innerHTML = 'File (' + readableFileSize(length) + ')'
                            info.appendChild(sizeElm)

                            const nameElm = document.createElement('code')
                            nameElm.innerHTML = escapeHtml(name)
                            info.appendChild(nameElm)

                            const dlBtn = document.createElement('button')
                            dlBtn.classList.add('icon-button', 'file-dl-button')
                            fileSectionElement.appendChild(dlBtn)

                            // Download the file
                            dlBtn.onclick = (e) => {
                                e.stopPropagation()
                                // Ask where to save it
                                var filePath = dialog.showSaveDialogSync(window, {
                                    properties: [ 'showOverwriteConfirmation', 'createDirectory' ]
                                })
                                // Don't continue if the user decided not to
                                if(filePath == undefined)
                                    return

                                // Download the file
                                download(section.blob, (blob) => {
                                    fs.copyFileSync(blob.path, filePath)
                                })
                            }

                            const dlBtnIcon = document.createElement('img')
                            dlBtnIcon.src = path.join(__dirname, 'icons/download.png')
                            dlBtn.appendChild(dlBtnIcon)
                        }
                    }, false) // don't actually download, just request information
                    break
                case 'quote':
                    // Just plain text
                    sectionElement = document.createElement('div')
                    sectionElement.classList.add('message-quote-section')
                    sectionElement.innerHTML = markupText(section.text)
                    twemoji.parse(sectionElement, { folder: 'svg', ext: '.svg' })

                    // If "blob" ID (actually message ID in this case) != 0 then show the message when clicking on it
                    if(section.blob != 0) {
                        const replyIndicator = document.createElement('span')
                        replyIndicator.classList.add('message-text-section')
                        replyIndicator.innerHTML = '<strong>Reply (click to show):</strong>'
                        content.appendChild(replyIndicator)

                        sectionElement.addEventListener('click', (e) => {
                            e.stopImmediatePropagation()
                            showFloatingMessage(section.blob)
                        })
                    }
                    break
            }
            if(sectionElement != null)
                content.appendChild(sectionElement)
        }

        // When the user clicks a message, quote its first section
        elm.addEventListener('click', (e) => {
            const sectionId = msgSections.length
            createInputSection('quote', sectionId, () => {
                removeInputSection(sectionId)
            })

            msgSections[sectionId].blob = id

            msgSections[sectionId].typeElm.value = messageSummary(id)
            adjTaHeight(msgSections[sectionId].typeElm)
        })

        // When clicking a link, open it in a browser
        const links = elm.getElementsByTagName("a")
        for(const link of links) {
            const href = link.href
            link.removeAttribute('href')
            link.onclick = (e) => {
                e.stopPropagation()
                shell.openExternal(href)
            }
            // Additionally, if the link is a YouTube video, add an iframe
            const hostname = parseHostname(href)
            if(hostname == 'youtube.com' || hostname == 'youtu.be') {
                // Get the video ID
                var videoId = ''
                if(hostname == 'youtube.com')
                    videoId = escapeHtml(parseUrlParameter(href, 'v'))
                else if(hostname == 'youtu.be')
                    videoId = href.split('/')[href.split('/').length - 1]
                
                // Add an iframe
                const iframe = document.createElement('iframe')
                iframe.width = 400
                iframe.height = 225
                iframe.allow = 'clipboard-write; encrypted-media; picture-in-picture; fullscreen'
                iframe.src = 'https://www.youtube.com/embed/' + videoId
                content.appendChild(iframe)
            }
        }

        return elm
    }

    // Fetches and appends messages to the top
    function appendMsgsTop(id_from, callback, clear=false) {
        const msgArea = document.getElementById('message-area')
        const header = document.getElementById('message-area-header')
        
        reqEntities([{
            'type': 'channel', 'id': viewingChan,
            'pageField': 4, // messages
            'pageFrom': id_from,
            'pageDir': false, // older than the supplied ID
            'pageCnt': 50
        }], true, () => {
            const msgs = [...entityCache[viewingChan].messages]
            // Sort message IDs
            msgs.sort()
            // Get messages
            for(var i = 0; i < msgs.length; i++)
                msgs[i] = { 'type': 'message', 'id': msgs[i] }
            // Add messages
            reqEntities(msgs, false, () => {
                // Clear previous messages if needed
                if(clear) {
                    for(var i = msgArea.children.length - 1; i >= 0; i--) {
                        const child = msgArea.children[i]
                        if(child.id != 'message-area-header')
                            child.remove()
                    }
                }
                msgs.reverse()
                msgs.forEach(msg => {
                    const id = msg.id
                    header.after(createMessage(id))
                    updateUser(entityCache[id].sender) // should assign the avatar and nickname
                })
                // Scroll to the bottom
                msgArea.scrollTop = msgArea.scrollHeight
            })
            // Call the callback
            if(callback != undefined)
                callback()
        })
    }

    // Updates the message area
    function updMessageArea() {
        if(viewingChan == 0)
            return;

        const msgArea = document.getElementById('message-area')

        // Show the hedaer
        showElm(document.getElementById('message-area-header'))

        // Get channel messages
        if(viewingChan != 0)
            appendMsgsTop(0xFFFFFFFFFFFFF, undefined, true)

        // Show the title
        reqEntities([{ type: 'channel', id: viewingChan }], false, () => {
            const channel = entityCache[viewingChan]
            const label = document.getElementById('channel-name')
            if(channel.name == 'DM') {
                // If the channel is a DM channel, get the ID of the other person and show their name instead
                const members = channel.members
                let   otherId = members[0]
                if(otherId == remote.getGlobal('webprotState').self.id)
                    otherId = members[1]
                channel.name = '@' + entityCache[otherId].name
            }
            label.innerHTML = escapeHtml(channel.name)
        })
    }

    // Updates the group list
    function updGroupList() {
        const groupList = document.getElementById('group-list')

        // Request the groups the user's in
        const groups = remote.getGlobal('webprotState').self.groups
        reqEntities(groups.map(x => { return { type: 'group', id: x } }), false, () => {
            // Delete old icons
            while(groupList.firstChild)
                groupList.firstChild.remove()
            // Add new ones
            for(let groupId of groups) {
                const group = entityCache[groupId]
                // We want the groupbar icon to be an image if an icon of the group is set
                let elm
                if(group.icon == 0) {
                    elm = document.createElement('div')
                    elm.innerHTML = groupNameAcronym(group.name)
                } else {
                    elm = document.createElement('img')
                    download(group.icon, (blob) => elm.src = 'file://' + blob.path)
                }
                // Add the default classes and a click listener
                elm.classList.add('group-icon', 'group-icon-' + group.id, 'cg-button')
                elm.onclick = (e) => { viewingGroup = group.id; viewingChan = group.channels[0]; updLayout() }
                groupList.append(elm)
            }
        })
    }

    function createChannelButton(id, clickCb, highlightSelected=true) {
        const channel = entityCache[id]

        const elm = document.createElement('div')
        elm.classList.add('channel-button')
        if(viewingChan == id && highlightSelected)
            elm.classList.add('channel-button-selected')
            
        elm.innerHTML = escapeHtml(channel.name)
        elm.onclick = clickCb

        return elm
    }

    // Updates the channel list
    function updChannelList() {
        if(viewingGroup == 0)
            return

        const channelList = document.getElementById('channel-list')
        const channelListHeader = document.getElementById('channel-list-header')

        // Show the server name
        channelListHeader.innerHTML = escapeHtml(entityCache[viewingGroup].name)

        // Request the channels of the group the user is viewing
        const channels = entityCache[viewingGroup].channels
        reqEntities(channels.map(x => { return { type: 'channel', id: x } }), false, () => {
            // Delete old icons
            while(channelList.firstChild)
                channelList.firstChild.remove()
            // Add new ones
            for(let chanId of channels) {
                const elm = createChannelButton(chanId, (e) => { viewingChan = chanId; updLayout() })
                channelList.append(elm)
            }
        })
    }

    // Updates the layout: member list, messages, etc.
    function updLayout() {
        console.log('Updating layout, gId=' + viewingGroup + ', cId=' + viewingChan + ', cgId=' + viewingContactGroup)

        // Show or hide the friend hedaer
        const friendHeader = document.getElementById('member-list-friend-header')
        const friendType   = document.getElementById('member-list-friend-type')
        if(viewingGroup === 0) {
            showElm(friendHeader)
            showElm(friendType)
        } else {
            hideElm(friendHeader)
            hideElm(friendType)
        }

        // Show or hide the channel list
        const channelList = document.getElementById('channel-list-sidebar')
        if(viewingGroup === 0)
            hideElm(channelList)
        else
            showElm(channelList)

        updMemberList()
        updChannelList()
        updMessageArea()
        updGroupList()
    }

    // Appends a message to the message area
    function appendMsg(id) {
        const msgArea = document.getElementById('message-area')

        // Check if scrolled all the way down
        const scrolled = msgArea.scrollTop === (msgArea.scrollHeight - msgArea.offsetHeight)

        // Create the message
        const msg = createMessage(id)
        msgArea.appendChild(msg)
        updateUser(entityCache[id].sender)
        triggerAppear(msg)

        // Scroll down again if it was like that before
        if(scrolled)
            msgArea.scrollTop = msgArea.scrollHeight
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
                    entityCache[entity.id] = { ...entityCache[entity.id], ...entity }

                    // Update info about self
                    if(entity.id == remote.getGlobal('webprotState').self.id) {
                        remote.getGlobal('webprotState').self = entity
                        updateSelfInfo(entity.name, entity.tag, entity.status, entity.statusText, entity.email, entity.mfaEnabled)

                        // Request self avatar
                        download(entity.avaBlob, (blob) => {
                            updateSelfAva(blob.path)
                        })

                        // Update DM and group list
                        updLayout()
                    }

                    // Append messages to the open channel
                    if(arg.spontaneous && entity.type == 'message' && entity.channel == viewingChan)
                        appendMsg(entity.id)

                    // Send notifications
                    if(arg.spontaneous && entity.type == 'message' &&
                        (entity.channel != viewingChan ||  // either we're sitting in another channel
                         !window.isFocused())) {           // or the window is out of focus
                        const sender = entityCache[entity.sender]
                        // Download the avatar of the sender
                        download(sender.avaBlob, (senderAvatar) => {
                            const notification = new Notification(sender.name, {
                                'body': messageSummary(entity.id),
                                'icon': senderAvatar.path
                            })
                            // Shitch to the channel when a notification has been clicked
                            notification.onclick = (e) => {
                                viewingChan = entity.channel
                                updLayout()
                                window.focus()
                            }
                            notification.show()
                        })
                    }

                    // Update info about other users
                    if(entity.type == 'user')
                        updateUser(entity.id)

                    // Update info about groups and channels
                    if(entity.type == 'group')
                        updateGroup(entity.id)
                    if(entity.type == 'channel' && entity.group != 0)
                        updateGroup(entity.group)
                })
                break

            case 'webprot.dl-end':
                // Add the blob to the blob cache
                var blob = arg.state.info
                blobCache[blob.id] = blob

                // Trigger the download end trigger
                var cb = endCallbacks[arg.state.operId]
                if(cb !== undefined)
                    cb(blob)
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

            case 'webprot.blob-preview-available':
                // Call the callback
                if(endCallbacks[arg.operId] != undefined)
                    endCallbacks[arg.operId](arg.name, arg.size, arg.preview, arg.hash, arg.length)
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

    function stopPropagation(evt) {
        evt.stopPropagation()
        evt.cancelBubble = true
    }

    // Add listeners that open and close the user settings panel
    document.getElementById('self-avatar')        .onclick = showUserSettings
    document.getElementById('self-nickname')      .onclick = showUserSettings
    document.getElementById('user-settings-exit') .onclick = hideUserSettings
    document.getElementById('user-settings-bg')   .onclick = hideUserSettings

    document.getElementById('floating-message-bg').onclick = hideFloatingMessage
    document.getElementById('floating-image-bg')  .onclick = hideFloatingImage
    document.getElementById('group-create-box-bg').onclick = hideGroupCreateBox

    document.getElementById('channel-list-header').onclick = showGroupSettings
    document.getElementById('group-settings-exit').onclick = hideGroupSettings
    document.getElementById('group-settings-bg')  .onclick = hideGroupSettings

    document.getElementById('user-settings')   .onclick = stopPropagation
    document.getElementById('group-settings')  .onclick = stopPropagation
    document.getElementById('group-create-box').onclick = stopPropagation

    // Settings sections
    document.querySelectorAll('input[name="user-settings-sections"]').forEach((element) => {
        element.onclick = (e) => {
            showUserSettingsTab(element.id.substring(0, element.id.length - 4))
        }
    })
    document.querySelectorAll('input[name="group-settings-sections"]').forEach((element) => {
        element.onclick = (w) => {
            showGroupSettingsTab(element.id.substring(0, element.id.length - 4))
        }
    })

    // Various text peoperties changing
    const statusTextChange = document.getElementById('self-status-text-change')
    statusTextChange.onkeypress = (evt) => {
        if(evt.keyCode == 13) // Enter
            setSelfStatusText(statusTextChange.value)
    }
    const usernameChange = document.getElementById('self-name-change')
    usernameChange.onkeypress = (evt) => {
        if(evt.keyCode == 13)
            setSelfName(usernameChange.value)
    }
    const emailChange = document.getElementById('self-email-change')
    emailChange.onkeypress = (evt) => {
        if(evt.keyCode == 13)
            setSelfEmail(emailChange.value)
    }

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
        if (evt.keyCode == 27) {
            hideUserSettings()
            hideFloatingMessage()
            hideFloatingImage()
            hideGroupCreateBox()
            hideGroupSettings()
        }
    }

    // Add listeners to self status selectors
    // We can't query multiple sections and just iterate them :(
    document.getElementById('self-status-offline').addEventListener('click', evt => setSelfStatus(0))
    document.getElementById('self-status-online') .addEventListener('click', evt => setSelfStatus(1))
    document.getElementById('self-status-sleep')  .addEventListener('click', evt => setSelfStatus(2))
    document.getElementById('self-status-dnd')    .addEventListener('click', evt => setSelfStatus(3))

    // User avatar/group icon selection
    document.getElementById('self-avatar-huge').onclick = () => {
        var newAvaPath = dialog.showOpenDialogSync(window, {
            properties: ['openFile'],
            filters: [
                { name: 'Images', extensions: ['jpg', 'png', 'gif', 'bmp'] }
            ]
        })
        // Don't if the user decided not to
        if(newAvaPath === undefined)
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
    }

    document.getElementById('group-icon-huge').onclick = () => {
        var newIconPath = dialog.showOpenDialogSync(window, {
            properties: ['openFile'],
            filters: [
                { name: 'Images', extensions: ['jpg', 'png', 'gif', 'bmp'] }
            ]
        })
        if(newIconPath === undefined)
            return

        newIconPath = newIconPath[0]
        upload(newIconPath, (id) => {
            download(id)
            ipcSend({
                action: 'webprot.entity-put',
                entities: [{
                    type: 'group',
                    id: viewingGroup,
                    icon: id
                }]
            })
        })
    }

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
            'name': document.getElementById('user-search-input').value
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
            msgSections[id].blob = blobId
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
    document.getElementById('message-quote-section-button').addEventListener('click', (e) => {
        const id = msgSections.length
        createInputSection('quote', id, () => {
            removeInputSection(id)
        })
    })

    // Message send button
    document.getElementById('message-send-button').addEventListener('click', (e) => {
        sendMessage()
    })

    // Load new messages when scrolled to the top
    const msgScrollArea = document.getElementById('message-scroll-area')
    const loadingFunc = (e) => {
        const messages = entityCache[viewingChan].messages
        if(msgScrollArea.scrollTop <= 500 && messages.length == 50) { // if the last batch gave less than 50 msgs, it must be the end
            // Remove the handler and request messages
            msgScrollArea.onscroll = ''
            appendMsgsTop(messages[messages.length - 1], () => {
                // Bring the handler back when messages finish loading
                msgScrollArea.onscroll = loadingFunc
            })
        }
    }
    msgScrollArea.onscroll = loadingFunc

    // Create/join a group
    document.getElementById('group-icon-add').onclick = showGroupCreateBox
    document.getElementById('group-create-ok').onclick = (e) => {
        ipcSend({
            action: 'webprot.entity-put',
            entities: [{
                type: 'group',
                id:   0,
                name: document.getElementById('group-create-name').value
            }],
            operId: regCallback(() => {
                hideGroupCreateBox()
            })
        })
    }

    // Open the home menu
    document.getElementById('group-icon-home').onclick = (e) => { viewingGroup = 0; viewingChan = 0; updLayout() }

    // Group settings
    const groupNameChange = document.getElementById('group-name-change')
    groupNameChange.onkeypress = (evt) => {
        if(evt.keyCode == 13) {
            ipcSend({
                action: 'webprot.entity-put',
                entities: [{
                    type: 'group',
                    id:   viewingGroup,
                    name: groupNameChange.value
                }]
            })
        }
    }

    document.getElementById('channel-add-button').onclick = (e) => {
        ipcSend({
            action: 'webprot.entity-put',
            entities: [{
                type:  'channel',
                id:    0,
                name:  'Text channel',
                group: viewingGroup
            }]
        })
    }

    const chanNameChange = document.getElementById('channel-name-change')
    chanNameChange.onkeypress = (e) => {
        if(e.keyCode == 13) {
            ipcSend({
                action: 'webprot.entity-put',
                entities: [{
                    type:  'channel',
                    id:    editingChan,
                    name:  chanNameChange.value,
                    group: viewingGroup
                }]
            })
        }
    }

    document.getElementById('channel-remove-button').onclick = (e) => {
        ipcSend({
            action: 'webprot.entity-put',
            entities: [{
                type:  'channel',
                id:    editingChan,
                group: 0
            }]
        })
    }
}

window.addEventListener('load', _rendererFunc)