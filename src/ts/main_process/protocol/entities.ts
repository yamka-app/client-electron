import crypto, { KeyObject } from "crypto";
import DataTypes, { MessageSection } from "./dataTypes.js";
import { pubkeyFormat } from "./salty/salty.js";
import * as fields from "./simpleFields.js";

// ============================================== ENTITIES
// Entities represent objects in Yamka. There are multiple
//  entitiy types: users, groups, channels, etc.
// Entities have fields, most notably, IDs.
export enum EntityType {
    USER      = 1,
    CHANNEL   = 2,
    GROUP     = 3,
    MESSAGE   = 4,
    ROLE      = 5,
    FILE      = 6,
    MSG_STATE = 7,
    POLL      = 8,
    AGENT     = 9,
    PKEY      = 10
}
export class EntityDecodeResult {
    entity:   Entity;
    posAfter: number;
}
export class Entity {
    typeNum: EntityType;
    simpleFieldList?: fields.SimpleField[];

    encodeFields?: ()                                        => Buffer;
    decodeFields?: (b: Buffer, limit?: number, pos?: number) => void|number;

    constructor(sfl?: fields.SimpleField[]) {
        this.simpleFieldList = sfl;
        if(!fields.checkBinaryIdExistence(this.simpleFieldList))
            throw new Error("Entity fields should be id-prefixed");

        this.encodeFields = fields.simpleFieldEncoder(this, this.simpleFieldList, true);
        this.decodeFields = fields.simpleFieldDecoder(this, this.simpleFieldList, true);
    }

    encode: () => Buffer = function() {
        if(this.encodeFields === undefined)
            throw new Error("Can't encode a generic entity");

        return Buffer.concat([
            DataTypes.encNum(this.typeNum as number, 1),
            this.encodeFields()
        ]);
    }

    static decode(buf: Buffer, pos: number): EntityDecodeResult {
        const type = DataTypes.decNum(buf.slice(pos, pos + 1));
        var entity: Entity = [
            undefined,
            new User(),
            new Channel(),
            new Group(),
            new Message(),
            new Role(),
            new File(),
            new MessageState(),
            new Poll(),
            new Agent(),
            new PKey()
        ][type];
        var posAfter = entity.decodeFields(buf, undefined, pos + 1) as number;
        return { entity: entity, posAfter: posAfter };
    }
}

export enum UserStatus {
    OFFLINE = 0,
    ONLINE  = 1,
    IDLE    = 2,
    DND     = 3,
    FOCUS   = 4,
}
export enum UserBadge {
    VERIFIED = 1,
    STAFF    = 2,
    BOT      = 3
}
export class User extends Entity {
    __type_name = "User";
    typeNum = EntityType.USER;

    id?:             number;
    email?:          string;
    name?:           string;
    tag?:            number;
    status?:         UserStatus;
    statusText?:     string;
    perms?:          Permissions;
    avaFile?:        number;
    mfaEnabled?:     boolean;
    friends?:        number[];
    blocked?:        number[];
    pendingIn?:      number[];
    pendingOut?:     number[];
    dmChannel?:      number;
    groups?:         number[];
    roles?:          number[];
    color?:          string;
    badges?:         UserBadge[];
    botOwner?:       number;
    ownedBots?:      number[];
    agents?:         number[];
    emailConfirmed?: boolean;
    identityKey?:    PKey;
    prekey?:         PKey;
    otprekey?:       PKey;
    idsignKey?:      PKey;

    constructor() {
        super([
            new fields.NumField    ("id", 8,          0),
            new fields.StrField    ("email",          1),
            new fields.StrField    ("name",           2),
            new fields.NumField    ("tag", 3,         3),
            new fields.NumField    ("status", 1,      4),
            new fields.StrField    ("statusText",     5),
            new fields.NumField    ("avaFile", 8,     7),
            new fields.BoolField   ("mfaEnabled",     8),
            new fields.NumListField("friends", 8,     9),
            new fields.NumListField("blocked", 8,     10),
            new fields.NumListField("pendingIn", 8,   11),
            new fields.NumListField("pendingOut", 8,  12),
            new fields.NumField    ("dmChannel", 8,   13),
            new fields.NumListField("groups", 8,      14),
            new fields.NumListField("roles", 8,       15),
            new fields.ColorField  ("color",          16),
            new fields.NumListField("badges", 1,      17),
            new fields.NumField    ("botOwner", 8,    18),
            new fields.NumListField("ownedBots", 8,   19),
            new fields.NumListField("agents", 8,      20),
            new fields.BoolField   ("emailConfirmed", 21),
            new fields.EntityField ("identityKey",    22),
            new fields.EntityField ("prekey",         23),
            new fields.EntityField ("otprekey",       24),
            new fields.EntityField ("idsignKey",      25)
        ]);
    }
}

export enum ChannelVoiceStatus {
    SPEAKING = 1,
    MUTED    = 2,
    DEAFENED = 4
}
export class Channel extends Entity {
    __type_name = "Channel";
    typeNum = EntityType.CHANNEL;

    id?:          number;
    name?:        string;
    members?:     number[];
    group?:       number;
    messages?:    number[];
    typing?:      number[];
    unread?:      number;
    firstUnread?: number;
    voice?:       boolean;
    voiceUsers?:  number[];
    voiceStatus?: ChannelVoiceStatus[];
    mentions?:    number[];
    lcid:         number;

    constructor() {
        super([
            new fields.NumField    ("id", 8,          0),
            new fields.StrField    ("name",           1),
            new fields.NumListField("members", 8,     2),
            new fields.NumField    ("group", 8,       3),
            new fields.NumListField("messages", 8,    4),
            new fields.NumListField("typing", 8,      5),
            new fields.NumField    ("unread", 4,      7),
            new fields.NumField    ("firstUnread", 8, 8),
            new fields.BoolField   ("voice",          9),
            new fields.NumListField("voiceUsers", 8,  10),
            new fields.NumListField("voiceStatus", 1, 11),
            new fields.NumListField("mentions", 8,    12),
            new fields.NumField    ("lcid", 4,        13),
        ]);
    }
}

export class Group extends Entity {
    __type_name = "Group";
    typeNum = EntityType.GROUP;

    id?:           number;
    name?:         string;
    channels?:     number[];
    owner?:        number;
    roles?:        number[];
    icon?:         number;
    invites?:      string[];
    everyoneRole?: number;

    constructor() {
        super([
            new fields.NumField    ("id", 8,           0),
            new fields.StrField    ("name",            1),
            new fields.NumListField("channels", 8,     2),
            new fields.NumField    ("owner", 8,        3),
            new fields.NumListField("roles", 8,        4),
            new fields.NumField    ("icon", 8,         5),
            new fields.StrListField("invites",         6),
            new fields.NumField    ("everyoneRole", 8, 7),
        ]);
    }
}

export class Message extends Entity {
    __type_name = "Message";
    typeNum = EntityType.MESSAGE;

    id:       number;
    states:   number[];
    channel:  number;
    sender:   number;
    latest:   MessageState;

    constructor() {
        super([
            new fields.NumField    ("id", 8,      0),
            new fields.NumListField("states", 8,  1),
            new fields.NumField    ("channel", 8, 2),
            new fields.NumField    ("sender", 8,  3),
            new fields.EntityField ("latest",     4),
        ]);
    }
}

export class Role extends Entity {
    __type_name = "Role";
    typeNum = EntityType.ROLE;

    id?:       number;
    name?:     string;
    color?:    string;
    group?:    number;
    priority?: number;
    perms?:    Permissions;
    members?:  number[];

    constructor() {
        super([
            new fields.NumField    ("id", 8,       0),
            new fields.StrField    ("name",        1),
            new fields.ColorField  ("color",       2),
            new fields.NumField    ("group", 8,    3),
            new fields.NumField    ("priority", 2, 4),
            new fields.PermsField  ("perms",       5),
            new fields.NumListField("members", 8,  6),
        ]);
    }
}

export class File extends Entity {
    __type_name = "File";
    typeNum = EntityType.FILE;

    path?: string; // only used in main-to-renderer communication

    name?:    string;
    size?:    string;
    preview?: string;
    length?:  number;

    __scale?: boolean;

    constructor() {
        super([
            new fields.NumField("id", 8,     0),
            new fields.StrField("name",      1),
            new fields.StrField("size",      2),
            new fields.StrField("preview",   3),
            new fields.NumField("length", 4, 4),
        ]);
    }
}

export class MessageState extends Entity {
    __type_name = "MessageState";
    typeNum = EntityType.MSG_STATE;

    id:        number;
    msg_id:    number;
    sections:  MessageSection[];
    encrypted: Buffer;

    constructor() {
        super([
            new fields.NumField        ("id", 8,     0),
            new fields.NumField        ("msg_id", 8, 1),
            new fields.MsgSectionsField("sections",  2),
            new fields.PrefixedBinField("encrypted", 3)
        ]);
    }
}

export class Poll extends Entity {
    __type_name = "Poll";
    typeNum = EntityType.POLL;

    id:          number;
    options:     string[];
    optionVotes: number[];
    selfVote:    number;
    totalVoted:  number;

    constructor() {
        super([
            new fields.NumField    ("id", 8,          0),
            new fields.StrListField("options",        1),
            new fields.NumListField("optionVotes", 3, 2),
            new fields.NumField    ("selfVote", 1,    3),
            new fields.NumField    ("totalVoted", 3,  4)
        ]);
    }
}

// A "device" of sorts
// Except for the fact that one physical device may be
// the owner of multiple agents if multiple user accounts are
// used on it
export enum AgentDevice {
    LINUX   = 0,
    WINDOWS = 1,
    MACOS   = 2,
    DESKTOP = 3,
    ANDROID = 4,
    IOS     = 5,
    MOBILE  = 6,
    MCU     = 7,
    APP     = 8
}
export class Agent extends Entity {
    __type_name = "Agent";
    typeNum = EntityType.AGENT;

    id:     number;
    owner:  number;
    type:   AgentDevice;
    name:   string;
    online: boolean;

    constructor() {
        super([
            new fields.NumField ("id", 8,    0),
            new fields.NumField ("owner", 8, 1),
            new fields.NumField ("type", 1,  2),
            new fields.StrField ("name",     3),
            new fields.BoolField("online",   4)
        ]);
    }
}

export enum PkeyType {
    IDENTITY = 0,
    PREKEY   = 1,
    OTPREKEY = 2,
    IDSIGN   = 3
}
export class PKey extends Entity {
    __type_name = "PKey";
    typeNum = EntityType.PKEY;

    id:   number;
    key:  Buffer;
    sign: Buffer;
    type: PkeyType;
    user: number;

    constructor(key?: Buffer, type?: PkeyType, owner?: number, sign?: Buffer) {
        super([
            new fields.NumField        ("id", 8,   0),
            new fields.PrefixedBinField("key",     1),
            new fields.PrefixedBinField("sign",    2),
            new fields.NumField        ("type", 1, 3),
            new fields.NumField        ("user", 8, 4),
        ]);

        this.key  = key;
        this.sign = sign;
        this.type = type;
        this.user = owner;
        this.id = 0;
    }

    static fromKeyObj(owner: number, type: PkeyType, ko: KeyObject, signWith?: KeyObject) {
        const data = ko.export(pubkeyFormat);
        // null infers the algorithm from the key type
        const sign = (signWith === undefined) ? undefined : crypto.sign(null, data, signWith);
        return new PKey(data, type, owner, sign);
    }

    toKeyObj(verifyWith?: KeyObject) {
        const key = crypto.createPublicKey({ key: this.key, format: "der", type: "spki" });
        if(verifyWith !== undefined)
            if(!crypto.verify(null, this.key, verifyWith, this.sign))
                throw new Error("Key signature verification failed");
        return key;
    }
}