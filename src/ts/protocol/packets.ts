import DataTypes        from "./dataTypes.js";
import * as fields      from "./simpleFields.js";
import * as entities    from "./entities.js";
import * as crypto      from "crypto";

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

    typeNum?:    number;
    seq?:        number;
    replyTo?:    number;
    captcha?:    string;
    spontaneous: boolean;

    constructor() { }

    encodePayload?: ()          => Buffer;
    decodePayload?: (b: Buffer) => Packet;

    encode: () => Buffer = function() {
        if(this.typeNum === undefined || this.encodePayload === undefined)
            throw new Error("Can't encode a generic packet");

        this.seq = Packet.nextSeq++;
        return Buffer.concat([
            DataTypes.encNum(this.typeNum, 1),
            DataTypes.encNum(this.seq, 4),
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
            new FileDownloadRequestPacket(),
            new FileDataChunkPacket(),
            new MFASecretPacket(),
            new SearchResultPacket(),
            new AccessTokenPacket(),
            new ContactsManagePacket(),
            new SearchPacket(),
            new InviteResolvePacket(),
            new BotCreatePacket(),
            new BotInvitePacket(),
            new IdentificationPacket(),
            new ClientIdentityPacket(),
            new VoiceJoinPacket()
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
    agent:       entities.Agent;

    constructor(l?: string, p?: string, perms?: AccessTokenPermission[]) {
        super([
            new fields.StrField    ("login"),
            new fields.StrField    ("password"),
            new fields.NumListField("permissions", 1),
            new fields.EntityField ("agent")
        ]);
        this.login       = l;
        this.password    = p;
        this.permissions = perms;
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
    POLL_ERROR                    = 26
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
    agent:    entities.Agent;

    constructor(e?: string, l?: string, p?: string) {
        super([
            new fields.StrField   ("email"),
            new fields.StrField   ("name"),
            new fields.StrField   ("password"),
            new fields.EntityField("agent")
        ]);
        this.name     = l;
        this.password = p;
        this.email    = e;
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

    encode = () => {
        return Buffer.concat([
            DataTypes.encNum(this.field, 1),
            DataTypes.encNum(this.dir,   1),
            DataTypes.encNum(this.from,  8),
            DataTypes.encNum(this.cnt,   1)
        ]);
    }
}
export class EntityContext {
    type: number;
    id:   number;

    encode = () => {
        return Buffer.concat([
            DataTypes.encNum(this.type, 1),
            DataTypes.encNum(this.id,   8),
        ]);
    }
}
export enum EntityKeyType {
    IDENTITY    = 0,
    PREKEY      = 1,
    OTPREKEY    = 2,
    X3DH_BUNDLE = 4
}
export class EntityGetRequest {
    type: number;
    id:   number;
    p?:   EntityPagination;
    c?:   EntityContext;
    k?:   EntityKeyType;

    encode = () => {
        var pc_bits = 0;
        if(this.p !== undefined) pc_bits |= 1;
        if(this.c !== undefined) pc_bits |= 2;
        if(this.k !== undefined) pc_bits |= 4;

        return Buffer.concat([
            DataTypes.encNum(this.type, 1),
            DataTypes.encNum(this.id,   8),
            DataTypes.encNum(pc_bits,   1),
            (this.p !== undefined) ? this.p.encode() : Buffer.alloc(0),
            (this.c !== undefined) ? this.c.encode() : Buffer.alloc(0),
            (this.c !== undefined) ? DataTypes.encNum(this.k, 1) : Buffer.alloc(0)
        ]);
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

    entities?: entities.Entity[];

    constructor(e?: entities.Entity[]) { super(); this.entities = e; }

    encodePayload = () => Buffer.concat([
        DataTypes.encNum(this.entities.length, 2),
        ...this.entities.map(e => e.encode())
    ]);

    decodePayload = (b: Buffer) => {
        this.entities = [];
        const cnt = DataTypes.decNum(b.slice(0, 2));
        var pos = 2;
        for(var i = 0; i < cnt; i++) {
            const result = entities.Entity.decode(b, pos);
            pos = result.posAfter;
            this.entities.push(result.entity);
        }
        return this;
    }
}

export class FileDownloadRequestPacket extends SimpleFieldPacket {
    typeNum = 8;
    
    id: number;

    constructor(id?: number) { super([new fields.NumField("id", 8)]); this.id = id; }
}

export class FileDataChunkPacket extends SimpleFieldPacket {
    typeNum = 9;

    position: number;
    data:     Buffer;

    constructor(p?: number, d?: Buffer) {
        super([
            new fields.NumField("position", 4),
            new fields.BinField("data"),
        ]);
        this.position = p;
        this.data     = d;
    }
}

export class MFASecretPacket extends SimpleFieldPacket {
    typeNum = 10;

    secret: string;

    constructor(secret?: string) { super([new fields.StrField("secret")]); this.secret = secret; }
}

export class SearchResultPacket extends SimpleFieldPacket {
    typeNum = 11;

    list: number[];

    constructor(list?: number[]) {
        super([new fields.NumListField("list", 8)]);
        this.list = list;
    }
}

export class AccessTokenPacket extends SimpleFieldPacket {
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

export enum SearchTarget {
    USER         = 0,
    GROUP        = 1,
    GROUP_MEMBER = 2
}
export class SearchPacket extends SimpleFieldPacket {
    typeNum = 14;

    type: SearchTarget;
    ref:  number;
    name: string;

    constructor(type?: SearchTarget, ref?: number, name?: string) {
        super([
            new fields.NumField("type", 1),
            new fields.NumField("ref", 8),
            new fields.StrField("name")
        ]);
        this.type = type;
        this.ref  = ref;
        this.name = name;
    }
}

export class InviteResolvePacket extends SimpleFieldPacket {
    typeNum = 15;

    code: string;
    add:  boolean;

    constructor(c?: string, a?: boolean) { super([
            new fields.NumField("add", 1),
            new fields.StrField("code")
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

    userId:  number;
    agentId: number;

    constructor(id?: number) {
        super([
            new fields.NumField("userId",  8),
            new fields.NumField("agentId", 8),
        ]);
        this.userId = id;
    }
}

export class VoiceJoinPacket extends SimpleFieldPacket {
    typeNum = 20;

    chanId: number;
    addr:   string;
    crypto: Buffer;

    constructor(cid?: number, a?: string, c?: Buffer) {
        super([
            new fields.NumField("chanId", 8),
            new fields.StrField("addr"),
            new fields.BinField("crypto")
        ]);
        this.chanId = cid; this.addr = a; this.crypto = c;
    }
}

export class EmailConfirmationPacket extends SimpleFieldPacket {
    typeNum = 21;

    code: string;

    constructor(code?: string) {
        super([new fields.StrField("code")]);
        this.code = code;
    }
}