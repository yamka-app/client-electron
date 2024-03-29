// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { Entity, Agent } from "./entities.s.js";

// This is a stipped down (.s) version that just contains definitions the renderer process uses.
// The main one uses regular files

export class Packet {
    typeNum?:    number;
    seq?:        number;
    replyTo?:    number;
    captcha?:    string;
    spontaneous: boolean;
}

export class SimpleFieldPacket extends Packet { }

export enum AccessTokenPermission {
    SEE_PROFILE         = 0,
    SEE_RELATIONSHIPS   = 1,
    SEE_GROUPS          = 2,
    SEE_DIRECT_MESSAGES = 3,
    EDIT_PROFILE        = 4,
    EDIT_RELATIONSHIPS  = 5,

    SEND_GROUP_MESSAGES         = 6,
    SEND_DIRECT_MESSAGES        = 7,
    RECEIVE_GROUP_MESSAGES      = 8,
    READ_GROUP_MESSAGE_HISTORY  = 9,
    RECEIVE_DIRECT_MESSAGES     = 10,
    READ_DIRECT_MESSAGE_HISTORY = 11,
    DELETE_GROUP_MESSAGES       = 12,
    DELETE_DIRECT_MESSAGES      = 13,

    CREATE_GROUPS          = 14,
    EDIT_GROUPS            = 15,
    DELETE_GROUPS          = 16,
    JOIN_GROUPS            = 17,
    LEAVE_GROUPS           = 18,
    BAN_MEMBER             = 19,
    KICK_MEMBERS           = 20,
    MANAGE_ROLES           = 21,
    DELETE_OTHERS_MESSAGES = 22,

    CREATE_POLLS  = 23,
    VOTE_IN_POLLS = 24,

    BOT = 26
}
export class LoginPacket extends SimpleFieldPacket {
    typeNum = 1;

    login:       string;
    password:    string;
    permissions: AccessTokenPermission[];
    agent:       Agent;

    constructor(l?: string, p?: string, perms?: AccessTokenPermission[], a?: Agent) {
        super();
        this.login       = l;
        this.password    = p;
        this.permissions = perms;
        this.agent       = a;
    }
}

export class PingPacket extends SimpleFieldPacket {
    typeNum = 2;

    echo: number;

    constructor(echo?: number) { super(); this.echo = echo; }
}

export class PongPacket extends SimpleFieldPacket {
    typeNum = 3;

    echo: number;

    constructor(echo?: number) { super(); this.echo = echo; }
}

export enum StatusCode {
    OUTDATED                      = 1,
    INVALID_CONNECTION_STATE      = 2,
    LOGIN_ERROR                   = 3,
    MFA_REQUIRED                  = 4,
    SIGNUP_SUCCESS                = 5,
    SIGNUP_ERROR                  = 6,
    RATE_LIMITING                 = 7,
    INVALID_ID                    = 8,
    FILE_TOO_LARGE                = 9,
    PERMISSION_DENIED             = 10,
    INVALID_ACCESS_TOKEN          = 11,
    USER_NOT_PENDING              = 12,
    CONTACT_ACTION_NOT_APPLICABLE = 13,
    INVALID_USERNAME              = 14,
    INVALID_ENTITY                = 15,
    ENTITY_NOT_PAGINABLE          = 16,
    INVALID_INVITE                = 17,
    INTERNAL_ERROR                = 18,
    UNKNOWN_PACKET                = 19,
    FRIEND_REQUEST_SENT           = 20,
    PACKET_PARSING_ERROR          = 21,
    START_UPLOADING               = 22,
    STREAM_END                    = 23,
    ONE_UPLOAD_ONLY               = 24,
    INVALID_CONFIRMATION_CODE     = 25,
    POLL_ERROR                    = 26,
    KEY_ERROR                     = 27,
    INVALID_REQUEST               = 28,
    EXCESSIVE_DATA                = 29,
    INVALID_CREDENTIAL            = 30,
    PASSWORD_CHANGED              = 31,
    MFA_TOGGLED                   = 32
}
export class StatusPacket extends SimpleFieldPacket {
    typeNum = 4;

    code:    number;
    message: string;
    status:  StatusCode;
}

export class SignupPacket extends SimpleFieldPacket {
    static typeNum = 5;

    email:    string;
    name:     string;
    password: string;
    agent:    Agent;

    constructor(e?: string, l?: string, p?: string, a?: Agent) {
        super();
        this.name     = l;
        this.password = p;
        this.email    = e;
        this.agent    = a;
    }
}

export enum EntityPaginationDirection {
    UP   = 1,
    DOWN = 0
}
export class EntityPagination {
    field: number;
    dir:   EntityPaginationDirection;
    from:  number;
    cnt:   number;

    constructor(f: number, dir: EntityPaginationDirection, from: number, cnt: number) {
        this.field = f;
        this.dir = dir;
        this.from = from;
        this.cnt = cnt;
    }
}
export class EntityContext {
    type: number;
    id:   number;

    constructor(t: number, id: number) {
        this.type = t;
        this.id = id;
    }
}
export class EntityGetRequest {
    type: number;
    id:   number;
    p?:   EntityPagination;
    c?:   EntityContext;

    constructor(t: number, id: number, p?: EntityPagination, c?: EntityContext) {
        this.type = t;
        this.id = id;
        this.p = p;
        this.c = c;
    }
}
export class EntityGetPacket extends Packet {
    static typeNum = 6;

    entities?: EntityGetRequest[];

    constructor(e?: EntityGetRequest[]) { super(); this.entities = e; }
}

export class EntitiesPacket extends Packet {
    static typeNum = 7;

    entities?: Entity[];

    constructor(e?: Entity[]) { super(); this.entities = e; }
}

export class FileDownloadRequestPacket extends SimpleFieldPacket {
    typeNum = 8;

    id: number;
    __decrypt?: string;

    constructor(id?: number, d?: string) { super(); this.id = id; this.__decrypt = d; }
}

export class MFASecretPacket extends SimpleFieldPacket {
    typeNum = 10;

    secret: string;

    constructor(secret?: string) { super(); this.secret = secret; }
}

export class SearchResultPacket extends SimpleFieldPacket {
    typeNum = 11;

    list: number[];
}

export class AccessTokenPacket extends SimpleFieldPacket {
    typeNum = 12;

    token: string;

    constructor(token?: string) { super(); this.token = token; }
}

export enum ContactType {
    FRIEND      = 0,
    BLOCKED     = 1,
    PENDING_IN  = 2,
    PENDING_OUT = 3,
    GROUP       = 4
}
export enum ContactAction {
    ADD    = 0,
    REMOVE = 1
}
export class ContactsManagePacket extends SimpleFieldPacket {
    typeNum = 13;

    type:   ContactType;
    action: ContactAction;
    id:     number;

    constructor(t?: ContactType, a?: ContactAction, id?: number) {
        super();
        this.type   = t;
        this.action = a;
        this.id     = id;
    }
}

export enum SearchTarget {
    USER         = 0,
    GROUP        = 1,
    GROUP_MEMBER = 2,
    GROUP_EMOJI  = 3
}
export class SearchPacket extends SimpleFieldPacket {
    typeNum = 14;

    type: SearchTarget;
    ref:  number;
    name: string;

    constructor(type?: SearchTarget, ref?: number, name?: string) {
        super();
        this.type = type;
        this.ref  = ref;
        this.name = name;
    }
}

export class InviteResolvePacket extends SimpleFieldPacket {
    typeNum = 15;

    code: string;
    add:  boolean;

    constructor(c?: string, a?: boolean) { super(); this.code = c; this.add = a; }
}

export class BotCreatePacket extends SimpleFieldPacket {
    typeNum = 16;

    id:        number = 0; // C->S: ignored
                           // S->C: ID
    nameToken: string;     // C->S: name
                           // S->C: token

    constructor(n?: string) { super(); this.nameToken = n; }
}

export class BotInvitePacket extends SimpleFieldPacket {
    typeNum = 17;

    bot:   number;
    group: number;

    constructor(b?: number, g?: number) { super(); this.bot = b; this.group = g; }
}

export class ClientIdentityPacket extends SimpleFieldPacket {
    typeNum = 19;

    userId:  number;
    agentId: number;
}

export class EmailConfirmationPacket extends SimpleFieldPacket {
    typeNum = 21;

    code: string;

    constructor(code?: string) { super(); this.code = code; }
}

export class PasswordChangePacket extends SimpleFieldPacket {
    typeNum = 22;

    oldPass: string;
    mfaCode: string;
    newPass: string;

    constructor(op?: string, mc?: string, np?: string) {
        super();
        this.oldPass = op;
        this.mfaCode = mc;
        this.newPass = np;
    }
}

export class MfaTogglePacket extends SimpleFieldPacket {
    typeNum = 23;

    enable?: boolean;
    pass?:   string;

    constructor(en?: boolean, p?: string) {
        super();
        this.enable = en;
        this.pass = p;
    }
}