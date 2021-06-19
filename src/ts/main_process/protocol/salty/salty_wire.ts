// Salty wire protocol
//
// salty.ts actually sends the data (supposedly over the standard
// Yamka protocol), this file just implements the encoding/decoding
// functionality.
// In essence, salty.ts is to this file is exactly what main.ts is to
// files under protocol/

import types            from "../dataTypes";
import * as crypto      from "crypto";
import { pubkeyFormat } from "./salty"

// Network serialization stuff
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
    protected encodePayload() { return types.encNum(this.id, 8) }
    protected static decodePayload(data: Buffer) { return new Level1IdentityChgMsg(types.decNum(data)); }
}