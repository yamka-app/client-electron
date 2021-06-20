// This is a stipped down (.s) version that just contains definitions the renderer process uses.
// The main one uses regular files

export enum MessageSectionType {
    TEXT    = 0,
    FILE    = 1,
    CODE    = 2,
    QUOTE   = 3,
    INVITE  = 4,
    USER    = 5,
    BOT_UI  = 6,
    POLL    = 7,
    E2EEDBG = 255
}
export class MessageSection {
    type: MessageSectionType;
    blob?: number;
    text?: string;

    constructor(t?: MessageSectionType, b?: number, s?: string) {
        this.type = t;
        this.blob = b;
        this.text = s;
    }
}

export enum PermissionStatus {
    UNSET = 0,
    YES   = 1,
    NO    = 2
}
export class Permissions {
    static len = 8;

    binary: Buffer;

    constructor(b: Buffer) { this.binary = b; }
}
