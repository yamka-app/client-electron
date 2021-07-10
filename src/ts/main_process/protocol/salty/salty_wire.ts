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
import { DHRatchet } from "./ratchet";

// Level 1 protocol

enum Level1Command {
    MESSAGE      = 0,
    INITAL_MSG   = 1,
    IDENTITY_CHG = 2, // only the server should generate this
}

export class Level1Msg {
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
            Level1AliceHelloMsg,
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

export class Level1AliceHelloMsg extends Level1Msg {
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
        const otpData = this.otp.export(pubkeyFormat);
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
        return new Level1AliceHelloMsg(
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
    HELLO     = 0,
    TEXT      = 1,
    TASTY_KEY = 2,
    HELLO_ACK = 3
}

export class Level2Msg {
    op:  Level2Command;
    pub: crypto.KeyObject; // Public key to step the DH ratchet

    constructor(pub?: crypto.KeyObject) {
        this.pub = pub;
    }

    public encode(ratchet: DHRatchet) {
        const includePub = this.pub !== undefined;
        const pubData = this.pub.export(pubkeyFormat);
        return Buffer.concat([
            Buffer.from([this.op | (includePub ? 0x80 : 0)]),
            includePub ? types.encNum(pubData.length, 2) : Buffer.from([]),
            includePub ? pubData : Buffer.from([]),
            ratchet.encrypt(this.encodePayload())
        ]);
    }

    public static extractPubkey(data: Buffer) {
        const hdr = types.decNum(data.slice(0, 1));
        const containsPub = (hdr & 0x80) > 0;
        if(containsPub) {
            const pubLen = types.decNum(data.slice(1, 3));
            const pubData = data.slice(3, 3 + pubLen);
            return crypto.createPublicKey({ key: pubData, format: "der", type: "spki" });
        }
        return undefined;
    }

    public static decode(data: Buffer, ratchet: DHRatchet) {
        const hdr = types.decNum(data.slice(0, 1));
        const containsPub = (hdr & 0x80) > 0;
        const msgCtr: typeof Level2Msg = [
            Level2AliceHelloMsg,
            Level2TextMsg,
            Level2TastyKeyMsg,
            Level2BobHelloMsg
        ][hdr & 0x7f];
        console.log(hdr, containsPub);

        var offs = 1;
        var pub = undefined;
        if(containsPub) {
            const pubLen = types.decNum(data.slice(1, 3));
            const pubData = data.slice(3, 3 + pubLen);
            pub = crypto.createPublicKey({ key: pubData, format: "der", type: "spki" });
            offs += 2 + pubLen;
            console.log(pub);
            ratchet.step(pub);
        }
        const ciphertext = data.slice(offs);
        console.log(ciphertext);
        const plaintext = ratchet.decrypt(ciphertext);
        const msg = msgCtr.decodePayload(plaintext);
        msg.pub = pub;
        return msg;
    }

    protected encodePayload() { return Buffer.from([]); }
    protected static decodePayload(data: Buffer) { return new Level2Msg(); }
}

export class Level2AliceHelloMsg extends Level2Msg {
    op = Level2Command.HELLO;
    check: number;

    constructor(pub?: crypto.KeyObject, check?: number) { super(pub); this.check = check; }
    protected encodePayload() { return Buffer.from([this.check]); }
    protected static decodePayload(data: Buffer) {
        return new Level2AliceHelloMsg(undefined, data[0]);
    }
}

export class Level2BobHelloMsg extends Level2Msg {
    op = Level2Command.HELLO_ACK;
    check: number;

    constructor(pub?: crypto.KeyObject, check?: number) { super(pub); this.check = check; }
    protected encodePayload() { return Buffer.from([this.check]); }
    protected static decodePayload(data: Buffer) {
        return new Level2BobHelloMsg(undefined, data[0]);
    }
}

export class Level2TextMsg extends Level2Msg {
    op = Level2Command.TEXT;
    sections: MessageSection[];

    constructor(pub?: crypto.KeyObject, s?: MessageSection[]) { super(pub); }
    protected encodePayload() { return types.encMsgSections(this.sections); }
    protected static decodePayload(data: Buffer) {
        return new Level2TextMsg(undefined, types.decMsgSections(data));
    }
}

export class Level2TastyKeyMsg extends Level2Msg {
    op = Level2Command.TASTY_KEY;
    key: crypto.KeyObject;

    constructor(pub?: crypto.KeyObject, k?: crypto.KeyObject) { super(pub); this.key = k; }
    protected encodePayload() { return this.key.export(); }
    protected static decodePayload(data: Buffer) {
        return new Level2TastyKeyMsg(undefined, crypto.createSecretKey(data));
    }
}