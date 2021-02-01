import { MessageSection } from "./dataTypes.s.js";

// This is a stipped down (.s) version that just contains definitions the renderer process uses.
// The main one uses regular files

export class EntityDecodeResult {
    entity:   Entity;
    posAfter: number;
}
export class Entity {
    id: number;
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
    static typeNum = 1;

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
    channels?:       number[];
    groups?:         number[];
    roles?:          number[];
    color?:          string;
    badges?:         UserBadge[];
    botOwner?:       number;
    ownedBots?:      number[];
    wall?:           number;
    emailConfirmed?: boolean;
}

export enum ChannelType {
    NORMAL = 0,
    WALL   = 1
}
export class Channel extends Entity {
    static typeNum = 2;

    name?:        string;
    members?:     number[];
    group?:       number;
    messages?:    number[];
    typing?:      number[];
    type?:        ChannelType;
    unread?:      number;
    firstUnread?: number;
}

export class Group extends Entity {
    static typeNum = 3;

    name?:         string;
    channels?:     number[];
    owner?:        number;
    roles?:        number[];
    icon?:         number;
    invites?:      string[];
    everyoneRole?: number;
}

export class Message extends Entity {
    static typeNum = 4;

    states?:   number[];
    channel?:  number;
    sender?:   number;
}

export class Role extends Entity {
    static typeNum = 5;

    name?:     string;
    color?:    string;
    group?:    number;
    priority?: number;
    perms?:    Buffer;
    members?:  number[];
}

export class File extends Entity {
    static typeNum = 6;

    path?: string; // only used in main-to-renderer communication

    name?:    string;
    size?:    string;
    preview?: string;
    length?:  number;
}

export class MessageState extends Entity {
    typeNum = 7;

    id:       number;
    msg_id:   number;
    sections: MessageSection[];
}