import DataTypes        from "./dataTypes.js";
import * as fields      from "./simpleFields.js";
import { Entity, File } from "./entities.js";

// ============================================== PACKETS
// Packets are individual units of data sent to/from the server in
//  full-duplex mode, meaning both the client and the server can send
//  a packet at any time. For example, the client may request
//  a bunch of entities, and get a response from the server.
//  Some other client may send a message to a channel, in which case
//  the server will send us the message entity "spontaneously", not triggered
//  by our client request.

export class Packet {
    static nextSeq: number = 1;

    protected typeNum?: number;
    seq?:     number;
    replyTo?: number;
    captcha?: string;

    constructor() { }

    encodePayload?: ()          => Buffer;
    decodePayload?: (b: Buffer) => Packet;

    encode: () => Buffer = function() {
        if(this.typeNum === undefined || this.encodePayload === undefined)
            throw new Error("Can't encode a generic packet");

        return Buffer.concat([
            DataTypes.encNum(this.typeNum, 1),
            DataTypes.encNum(Packet.nextSeq++, 4),
            DataTypes.encNum(this.replyTo ?? 0, 4),
            DataTypes.encStr(this.captcha),
            this.encodePayload()
        ]);
    }

    static decode(buf: Buffer): Packet {
        const type  = DataTypes.decNum(buf.slice(0, 1));
        const seq   = DataTypes.decNum(buf.slice(1, 5));
        const reply = DataTypes.decNum(buf.slice(5, 9));
        var packet: Packet = [
            undefined,
            new LoginPacket(),
            new PingPacket(),
            new PongPacket(),
            new StatusPacket(),
            new SignupPacket(),
            new EntityGetPacket(),
            new EntitiesPacket(),
            new FileTokenRequestPacket(),
            new FileTokenPacket(),
            new MFASecretPacket(),
            new FileUploadTokenRequestPacket(),
            new ContTokenPacket(),
            new ContactsManagePacket(),
            new UserSearchPacket(),
            new InviteResolvePacket(),
            new BotCreatePacket(),
            new BotInvitePacket(),
            new IdentificationPacket(),
            new ClientIdentityPacket()
        ][type];
        if(packet === undefined) throw new Error(`Invalid packet type ${type}`);
        packet.replyTo = reply;
        packet.seq     = seq;
        packet = packet.decodePayload(buf.slice(9));
        return packet;
    }
}

export class SimpleFieldPacket extends Packet {
    protected simpleFieldList: fields.SimpleField[] = [];

    constructor(fl: fields.SimpleField[]) {
        super();

        this.simpleFieldList = fl;
        if(fields.checkBinaryIdExistence(this.simpleFieldList))
            throw new Error("Packet fields should not be id-prefixed");

        this.encodePayload = fields.simpleFieldEncoder(this, this.simpleFieldList);
        this.decodePayload = fields.simpleFieldDecoder(this, this.simpleFieldList);
    }
}

export class LoginPacket extends SimpleFieldPacket {
    protected typeNum = 1;
    login:    string;
    password: string;

    constructor(l?: string, p?: string) {
        super([
            new fields.StrField("login"),
            new fields.StrField("password")
        ]);
        this.login    = l;
        this.password = p;
    }
}

export class PingPacket extends SimpleFieldPacket {
    typeNum = 2;
    echo: number;

    constructor(echo?: number) {
        super([new fields.NumField("echo", 4)]);
        this.echo = echo;
    }
}

export class PongPacket extends SimpleFieldPacket {
    typeNum = 3;
    echo: number;

    constructor(echo?: number) {
        super([new fields.NumField("echo", 4)]);
        this.echo = echo;
    }
}

export enum StatusCode {
    OUTDATED                      = 1,
    INVALID_CONNECTION_STATE      = 2,
    LOGIN_ERROR                   = 3,
    MFA_REQUIRED                  = 4,
    LOGIN_SUCCESS                 = 5,
    SIGNUP_ERROR                  = 6,
    RATE_LIMITING                 = 7,
    INVALID_ID                    = 8,
    FILE_TOO_LARGE                = 9,
    PERMISSION_DENIED             = 10,
    INVALID_CONT_TOKEN            = 11,
    USER_NOT_PENDING              = 12,
    CONTACT_ACTION_NOT_APPLICABLE = 13,
    INVALID_USERNAME              = 14,
    INVALID_ENTITY                = 15,
    ENTITY_NOT_PAGINABLE          = 16,
    INVALID_INVITE                = 17,
    INTERNAL_ERROR                = 18,
    UNKNOWN_PACKET                = 19,
    FRIEND_REQUEST_SENT           = 20
}
export class StatusPacket extends SimpleFieldPacket {
    typeNum = 4;
    message: string;
    status:  StatusCode;

    constructor(status?: StatusCode, message?: string) {
        super([new fields.NumField("status", 2), new fields.StrField("message")]);
        this.status  = status;
        this.message = message;
    }
}

export class SignupPacket extends SimpleFieldPacket {
    typeNum = 5;
    email:    string;
    name:     string;
    password: string;

    constructor(e?: string, l?: string, p?: string) {
        super([
            new fields.StrField("email"),
            new fields.StrField("name"),
            new fields.StrField("password")
        ]);
        this.name            = l;
        this.password        = p;
    }
}

export enum EntityPaginationDirection {
    UP   = 1,
    DOWN = 0
}
export class EntityPagination {
    field: fields.SimpleField;
    dir:   EntityPaginationDirection;
    from:  number;
    cnt:   number;

    encode = () => {
        return Buffer.concat([
            DataTypes.encNum(this.field.binaryId, 2),
            DataTypes.encNum(this.dir,            1),
            DataTypes.encNum(this.from,           8),
            DataTypes.encNum(this.cnt,            1)
        ])
    }
}
export class EntityContext {
    type: number;
    id:   number;

    encode = () => {
        return Buffer.concat([
            DataTypes.encNum(this.type, 2),
            DataTypes.encNum(this.id,   8),
        ])
    }
}
export class EntityGetRequest {
    type: number;
    id:   number;
    p?:   EntityPagination;
    c?:   EntityContext;

    encode = () => {
        var pc_bits = 0;
        if(this.p !== undefined) pc_bits |= 1;
        if(this.c !== undefined) pc_bits |= 2;

        return Buffer.concat([
            DataTypes.encNum(this.type, 2),
            DataTypes.encNum(this.id,   8),
            DataTypes.encNum(pc_bits,   1),
            (this.p !== undefined) ? this.p.encode() : Buffer.alloc(0),
            (this.c !== undefined) ? this.c.encode() : Buffer.alloc(0)
        ])
    }
}
export class EntityGetPacket extends Packet {
    typeNum = 6;

    entities?: EntityGetRequest[];

    constructor(e?: EntityGetRequest[]) { super(); this.entities = e; }

    encodePayload = () => Buffer.concat([
        DataTypes.encNum(this.entities.length, 2),
        ...this.entities.map(e => e.encode())
    ]);

    decodePayload = (_: Buffer) => { throw new Error("EntityGet packets can't be decoded"); };
}

export class EntitiesPacket extends Packet {
    typeNum = 7;

    entities?: Entity[];

    constructor(e?: Entity[]) { super(); this.entities = e; }

    encodePayload = () => Buffer.concat([
        DataTypes.encNum(this.entities.length, 2),
        ...this.entities.map(e => e.encode())
    ]);

    decodePayload = (b: Buffer) => {
        this.entities = [];
        var pos = 0;
        var cnt = DataTypes.decNum(b.slice(0, 2));
        for(var i = 0; i < cnt; i++) {
            var result = Entity.decode(b, pos);
            pos = result.posAfter;
            this.entities.push(result.entity);
        }
        return this;
    }
}

export class FileTokenRequestPacket extends SimpleFieldPacket {
    typeNum = 8;
    id: number;

    constructor(id?: number) { super([new fields.NumField("id", 8)]); this.id = id; }
}

export class FileTokenPacket extends SimpleFieldPacket {
    typeNum = 9;
    token: string;

    constructor(token?: string) { super([new fields.StrField("token")]); this.token = token; }
}

export class MFASecretPacket extends SimpleFieldPacket {
    typeNum = 10;
    secret: string;

    constructor(secret?: string) { super([new fields.StrField("secret")]); this.secret = secret; }
}

export class FileUploadTokenRequestPacket extends SimpleFieldPacket {
    typeNum = 11;
    file: File;

    constructor(f?: File) { super([new fields.EntityField("file")]); this.file = f; }
}

export class ContTokenPacket extends SimpleFieldPacket {
    typeNum = 12;
    token: string;

    constructor(token?: string) { super([new fields.StrField("token")]); this.token = token; }
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
        super([
            new fields.NumField("type",   1),
            new fields.NumField("action", 1),
            new fields.NumField("id",     8)
        ]);
        this.type   = t;
        this.action = a;
        this.id     = id;
    }
}

export class UserSearchPacket extends SimpleFieldPacket {
    typeNum = 14;
    name: string;

    constructor(name?: string) { super([new fields.StrField("name")]); this.name = name; }
}

export class InviteResolvePacket extends SimpleFieldPacket {
    typeNum = 15;
    code: string;
    add:  boolean;

    constructor(c?: string, a?: boolean) { super([
            new fields.NumField("add", 1),
            new fields.StrField("invite")
        ]);
        this.code = c;
        this.add = a;
    }
}

export class BotCreatePacket extends SimpleFieldPacket {
    typeNum = 16;
    id:        number = 0; // C->S: ignored
                           // S->C: ID

    nameToken: string;     // C->S: name
                           // S->C: token

    constructor(n?: string) {
        super([
            new fields.NumField("id", 8),
            new fields.StrField("nameToken")
        ]);
        this.nameToken = n;
    }
}

export class BotInvitePacket extends SimpleFieldPacket {
    typeNum = 17;
    bot:   number;
    group: number;

    constructor(b?: number, g?: number) {
        super([
            new fields.NumField("bot",   8),
            new fields.NumField("group", 8)
        ]);
        this.bot = b; this.group = g;
    }
}

export class IdentificationPacket extends SimpleFieldPacket {
    typeNum = 18;
    protocol:            number;
    supportsCompression: boolean;

    constructor(p?: number, sc?: boolean) {
        super([
            new fields.NumField("protocol", 4),
            new fields.BoolField("supportsCompression")
        ]);
        this.protocol = p; this.supportsCompression = sc;
    }
}

export class ClientIdentityPacket extends SimpleFieldPacket {
    typeNum = 19;
    userId: number;

    constructor(id?: number) {
        super([new fields.NumField("userId", 8)]);
        this.userId = id;
    }
}