import { COPYFILE_FICLONE_FORCE } from "constants";
import DataTypes, { MessageSection }   from "./dataTypes.js";
import * as fields from "./simpleFields.js";

// ============================================== ENTITIES
// Entities represent objects in Yamka. There are multiple
//  entitiy types: users, groups, channels, etc.
// Entities have fields, most notably, IDs.
export class EntityDecodeResult {
    entity:   Entity;
    posAfter: number;
}
export class Entity {
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
            DataTypes.encNum(this.typeNum, 1),
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
            new MessageState()
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
}
export enum UserBadge {
    VERIFIED = 1,
    STAFF    = 2,
    BOT      = 3
}
export class User extends Entity {
    __type_name = "User";
    typeNum = 1;

    email?:          string;
    name?:           string;
    tag?:            number;
    status?:         UserStatus;
    statusText?:     string;
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
    wall?:           number;
    emailConfirmed?: boolean;

    constructor() {
        super([
            new fields.NumField    ("id", 8,          0),
            new fields.StrField    ("email",          1),
            new fields.StrField    ("name",           2),
            new fields.NumField    ("tag", 3,         3),
            new fields.NumField    ("status", 1,      4),
            new fields.StrField    ("statusText",     5),
            new fields.NumField    ("avaFile", 8,     7),
            new fields.NumField    ("mfaEnabled", 1,  8),
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
            new fields.NumField    ("wall", 8,        20),
            new fields.BoolField   ("emailConfirmed", 21)
        ]);
    }
}

export enum ChannelType {
    NORMAL = 0,
    WALL   = 1
}
export enum ChannelVoiceStatus {
    SPEAKING = 1,
    MUTED    = 2,
    DEAFENED = 4
}
export class Channel extends Entity {
    __type_name = "Channel";
    typeNum = 2;

    id?:          number;
    name?:        string;
    members?:     number[];
    group?:       number;
    messages?:    number[];
    typing?:      number[];
    type?:        ChannelType;
    unread?:      number;
    firstUnread?: number;
    voice?:       boolean;
    voiceUsers?:  number[];
    voiceStatus?: ChannelVoiceStatus[];

    constructor() {
        super([
            new fields.NumField    ("id", 8,          0),
            new fields.StrField    ("name",           1),
            new fields.NumListField("members", 8,     2),
            new fields.NumField    ("group", 8,       3),
            new fields.NumListField("messages", 8,    4),
            new fields.NumListField("typing", 8,      5),
            new fields.NumField    ("type", 1,        6),
            new fields.NumField    ("unread", 4,      7),
            new fields.NumField    ("firstUnread", 8, 8),
            new fields.BoolField   ("voice",          9),
            new fields.NumListField("voiceUsers", 8,  10),
            new fields.NumListField("voiceStatus", 1, 11),
        ]);
    }
}

export class Group extends Entity {
    __type_name = "Group";
    typeNum = 3;

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
    typeNum = 4;

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
    typeNum = 5;

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
    typeNum = 6;

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
    typeNum = 7;

    id:       number;
    msg_id:   number;
    sections: MessageSection[];

    constructor() {
        super([
            new fields.NumField        ("id", 8,     0),
            new fields.NumField        ("msg_id", 8, 1),
            new fields.MsgSectionsField("sections",  2)
        ]);
    }
}