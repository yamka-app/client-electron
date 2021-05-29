import { MessageSection, Permissions } from "./dataTypes.s.js";

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
    __type_name = "User";
    static typeNum = 1;

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
}

export enum ChannelVoiceStatus {
    SPEAKING = 1,
    MUTED    = 2,
    DEAFENED = 4
}
export class Channel extends Entity {
    __type_name = "Channel";
    static typeNum = 2;

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
}

export class Group extends Entity {
    __type_name = "Group";
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
    __type_name = "Message";
    static typeNum = 4;

    states?:   number[];
    channel?:  number;
    sender?:   number;
    latest?:   MessageState;
}

export class Role extends Entity {
    __type_name = "Role";
    static typeNum = 5;

    name?:     string;
    color?:    string;
    group?:    number;
    priority?: number;
    perms?:    Permissions;
    members?:  number[];
}

export class File extends Entity {
    __type_name = "File";
    static typeNum = 6;

    name?:    string;
    size?:    string;
    preview?: string;
    length?:  number;

    // only used in main-to-renderer communication
    path?:    string;
    __scale?: boolean;
}

export class MessageState extends Entity {
    __type_name = "MessageState";
    static typeNum = 7;

    id:       number;
    msg_id:   number;
    sections: MessageSection[];
}

export class Poll extends Entity {
    __type_name = "Poll";
    static typeNum = 8;

    id:          number;
    options:     string[];
    optionVotes: number[];
    selfVote:    number;
    totalVoted:  number;
}

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
    static typeNum = 9;

    id:     number;
    owner:  number;
    type:   AgentDevice;
    name:   string;
    online: boolean;
}