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

    email:      string;
    name:       string;
    tag:        number;
    status:     UserStatus;
    statusText: string;
    avaFile:    number;
    mfaEnabled: boolean;
    friends:    number[];
    blocked:    number[];
    pendingIn:  number[];
    pendingOut: number[];
    channels:   number[];
    groups:     number[];
    roles:      number[];
    color:      string;
    badges:     UserBadge[];
    botOwner:   number;
    ownedBots:  number[];
}

export class Channel extends Entity {
    static typeNum = 2;
}

export class Group extends Entity {
    static typeNum = 3;
}

export class Message extends Entity {
    static typeNum = 4;

    id:       number;
    sections: MessageSection[];
    channel:  number;
    edited:   boolean;
    sender:   number;
}

export class Role extends Entity {
    static typeNum = 5;
}

export class File extends Entity {
    static typeNum = 6;
}