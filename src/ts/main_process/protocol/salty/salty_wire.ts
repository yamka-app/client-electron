// Salty wire protocol
//
// salty.ts actually sends the data (supposedly over the standard
// Yamka protocol), this file just implements the encoding/decoding
// functionality.
// In essence, salty.ts is to this file is exactly what main.ts is to
// files under protocol/

import types, { MessageSection } from "../dataTypes";
import * as crypto               from "crypto";
import { pubkeyFormat }          from "./salty"

// Level 1 protocol

enum Level1Command {
    MESSAGE      = 0,
    INITAL_MSG   = 1,
    IDENTITY_CHG = 2, // only the server should generate this
}

class Level1Msg {
    op: Level1Command;

    public encode() {
        return Buffer.concat([
            Buffer.from([this.op]),
            this.encodePayload()
        ]);
    }

    public static decode(data: Buffer) {
        const op = types.decNum(data.slice(0, 1));
        const msg: typeof Level1Msg = [
            Level1NormalMsg,
            Level1InitMsg,
            Level1IdentityChgMsg,
        ][op];
        return msg.decodePayload(data.slice(1));
    }

    protected encodePayload() { return Buffer.from([]); }
    protected static decodePayload(data: Buffer) { return new Level1Msg(); }
}

export class Level1NormalMsg extends Level1Msg {
    op = Level1Command.MESSAGE;
    data: Buffer;

    constructor(data?: Buffer) { super(); this.data = data; }
    protected encodePayload() { return this.data; }
    protected static decodePayload(data: Buffer) { return new Level1NormalMsg(data); }
}

export class Level1InitMsg extends Level1Msg {
    op = Level1Command.INITAL_MSG;
    eph: crypto.KeyObject;
    otp: crypto.KeyObject;
    l2d: Buffer;

    constructor(eph?: crypto.KeyObject, otp?: crypto.KeyObject, l2d?: Buffer) {
        super();
        this.eph = eph;
        this.otp = otp;
        this.l2d = l2d;
    }

    protected encodePayload() {
        const ephData = this.eph.export(pubkeyFormat);
        const otpData = this.eph.export(pubkeyFormat);
        return Buffer.concat([
            types.encNum(ephData.length, 2),
            ephData,
            types.encNum(otpData.length, 2),
            otpData,
            this.l2d
        ]);
    }

    protected static decodePayload(data: Buffer) {
        const ephDataLen = types.decNum(data.slice(0, 2));
        const ephData = data.slice(2, 2 + ephDataLen);
        const otpDataLen = types.decNum(data.slice(2 + ephDataLen, 4 + ephDataLen));
        const otpData = data.slice(4 + ephDataLen, 4 + ephDataLen + otpDataLen);
        const l2d = data.slice(4 + ephDataLen + otpDataLen);
        return new Level1InitMsg(
                crypto.createPublicKey({ key: ephData, type: "spki", format: "der" }),
                crypto.createPublicKey({ key: otpData, type: "spki", format: "der" }),
                l2d);
    }
}

export class Level1IdentityChgMsg extends Level1Msg {
    op = Level1Command.IDENTITY_CHG;
    id: number;

    constructor(id?: number) { super(); this.id = id; }
    protected encodePayload() { return types.encNum(this.id, 8); }
    protected static decodePayload(data: Buffer) { return new Level1IdentityChgMsg(types.decNum(data)); }
}





// Level 2 protocol

export enum Level2Command {
    HELLO        = 0,
    CONVERSATION = 1,
    TASTY_KEY    = 2
}

export class Level2Msg {
    op:  Level2Command;
    pub: crypto.KeyObject; // Public key to step the DH ratchet

    public encode() {
        const includePub = this.pub !== undefined;
        const pubData = this.pub.export(pubkeyFormat);
        return Buffer.concat([
            Buffer.from([this.op | (includePub ? 0x80 : 0)]),
            includePub ? types.encNum(pubData.length, 2) : Buffer.from([]),
            includePub ? pubData : Buffer.from([]),
            this.encodePayload()
        ]);
    }

    public static decode(data: Buffer) {
        const hdr = types.decNum(data.slice(0, 1));
        const containsPub = (hdr >> 7) === 1;
        const msgConstr: typeof Level2Msg = [
            Level2HelloMsg,
            Level2ConvMsg,
            Level2TastyMsg,
        ][hdr & 0x7f];

        var offs = 0;
        var pub = undefined;
        if(containsPub) {
            const pubLen = types.decNum(data.slice(1, 3));
            const pubData = data.slice(3, 3 + pubLen);
            pub = crypto.createPublicKey({ key: pubData, format: "der", type: "spki" });
            offs = 3 + pubLen;
        }
        const msg = msgConstr.decodePayload(data.slice(offs));
        msg.pub = pub;
        return msg;
    }

    protected encodePayload() { return Buffer.from([]); }
    protected static decodePayload(data: Buffer) { return new Level2Msg(); }
}

export class Level2HelloMsg extends Level2Msg {
    op = Level2Command.HELLO;

    constructor() { super(); }
    protected encodePayload() { return Buffer.from([]); }
    protected static decodePayload(data: Buffer) { return new Level2HelloMsg(); }
}

export class Level2ConvMsg extends Level2Msg {
    op = Level2Command.CONVERSATION;
    sections: MessageSection[];

    constructor(s?: MessageSection[]) { super(); }
    protected encodePayload() { return types.encMsgSections(this.sections); }
    protected static decodePayload(data: Buffer) {
        return new Level2ConvMsg(types.decMsgSections(data));
    }
}

export class Level2TastyMsg extends Level2Msg {
    op = Level2Command.TASTY_KEY;
    key: crypto.KeyObject;

    constructor(k?: crypto.KeyObject) { super(); this.key = k; }
    protected encodePayload() { return this.key.export(); }
    protected static decodePayload(data: Buffer) {
        return new Level2TastyMsg(crypto.createSecretKey(data));
    }
}