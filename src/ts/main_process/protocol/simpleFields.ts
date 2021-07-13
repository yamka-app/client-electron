// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import types, { MessageSection, Permissions } from "./dataTypes.js";
import { Entity, Message } from "./entities.js";

// ============================================== SIMPLE FIELDS
// The idea behind "simple fields" is to provide a convenient way for various
//  packets and entities to define encoding and decoding functions by simply
//  having the list of field types and names
// Each simple field provides:
//  an encoding  function (encodes a value into its binary representation)
//  a  decoding  function (decodes a value from its binary representation)
//  a  lengthing function (determines how many bytes a value takes up in the buffer)
// Fields sit next to each other in packets. But each of them is preceded by a "binary ID"
//  in entities. The "encode" and "decode" (defferent from "encodingFunc" and "decodingFunc") functions
//  take all that into account to produce the final result

export class SimpleField {
    prop:      string;
    binaryId?: number;

    encodingFunc?:  (val: any)    => Buffer;
    decodingFunc?:  (buf: Buffer) => any;
    lengthingFunc?: (buf: Buffer) => number;

    encode = (val: any)    => Buffer.concat([
        this.hasBinaryId() ?
            types.encNum(this.binaryId, 1) :
            Buffer.alloc(0),
        this.encodingFunc(val)]);

    decode = (buf: Buffer) => this.decodingFunc(buf);

    hasBinaryId = () => this.binaryId !== undefined;
    
    constructor(p: string, bid?: number) { this.prop = p; this.binaryId = bid; }
}

export class NumField extends SimpleField {
    bytes: number;

    constructor(p: string, b: number, bid?: number) { super(p, bid); this.bytes = b; }

    encodingFunc  = (val: number) => types.encNum(val, this.bytes);
    decodingFunc  = (buf: Buffer) => types.decNum(buf.slice(0, this.bytes));
    lengthingFunc = (buf: Buffer) => this.bytes;
}

export class BoolField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: boolean) => types.encNum(val ? 1 : 0, 1);
    decodingFunc  = (buf: Buffer)  => types.decNum(buf.slice(0, 1)) > 0;
    lengthingFunc = (buf: Buffer)  => 1;
}

export class ColorField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: string) => types.encNum(parseInt(val.slice(1)), 4);
    decodingFunc  = (buf: Buffer) => "#" + ("0000000" + types.decNum(buf).toString(16)).slice(-8);
    lengthingFunc = (buf: Buffer) => 4;
}

export class StrField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: string) => types.encStr(val);
    decodingFunc  = (buf: Buffer) => types.decStr(buf);
    lengthingFunc = (buf: Buffer) => types.decNum(buf.slice(0, 2)) + 2;
}

export class NumListField extends SimpleField {
    bytes: number;

    constructor(p: string, b: number, bid?: number) { super(p, bid); this.bytes = b; }

    encodingFunc  = (val: number[]) => types.encNumList(val, this.bytes);
    decodingFunc  = (buf: Buffer)   => types.decNumList(buf, this.bytes);
    lengthingFunc = (buf: Buffer)   => 2 + (types.decNum(buf.slice(0, 2)) * this.bytes);
}

export class StrListField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: string[]) => types.encStrList(val);
    decodingFunc  = (buf: Buffer)   => types.decStrList(buf);
    lengthingFunc = (buf: Buffer)   => types.strListLen(buf);
}

export class PermsField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: Permissions) => val.binary;
    decodingFunc  = (buf: Buffer)      => new Permissions(buf);
    lengthingFunc = (buf: Buffer)      => Permissions.len;
}

export class BinField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: Buffer) => val;
    decodingFunc  = (buf: Buffer) => buf;
    lengthingFunc = (buf: Buffer) => buf.length;
}

export class PrefixedBinField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: Buffer) => Buffer.concat([types.encNum(val.length, 2), val]);
    decodingFunc  = (buf: Buffer) => buf.slice(2);
    lengthingFunc = (buf: Buffer) => types.decNum(buf.slice(0, 2)) + 2;
}

export class MsgSectionsField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: MessageSection[]) => types.encMsgSections(val);
    decodingFunc  = (buf: Buffer)           => types.decMsgSections(buf);
    lengthingFunc = (buf: Buffer)           => types.lenMsgSections(buf);
}

export class EntityField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: Entity) => val.encode();
    decodingFunc  = (buf: Buffer) => Entity.decode(buf, 0).entity;
    lengthingFunc = (buf: Buffer) => Entity.decode(buf, 0).posAfter;
}



export function checkBinaryIdExistence(fields: SimpleField[]): boolean {
    const allHaveId     = fields.every(f =>  f.hasBinaryId());
    const allDontHaveId = fields.every(f => !f.hasBinaryId());
    if(!allDontHaveId && !allHaveId)
        throw new Error("Binary ID existence must be the same across all fields");

    return allHaveId;
}

export function simpleFieldEncoder(t: any, fields: SimpleField[], inclCnt: boolean = false): () => Buffer {
    checkBinaryIdExistence(fields);

    return () => {
        const remaining = fields.filter(f => t[f.prop] !== undefined);

        return Buffer.concat([
            inclCnt ?
                types.encNum(remaining.length, 1) :
                Buffer.alloc(0),
            ...remaining.map(f => f.encode(t[f.prop]))
        ])
    }
}

export function simpleFieldDecoder(t: any, fields: SimpleField[], inclCnt: boolean = false):
        (buf: Buffer, limit?: number, pos?: number) => void|number|any {
    const allHaveId = checkBinaryIdExistence(fields);

    if(allHaveId) {
        // "limit" defines how many fields we're allowed to decode max
        return (buf: Buffer, limit?: number, pos: number = 0) => {
            var decoded = 0;
            if(inclCnt) { limit = types.decNum(buf.slice(pos, pos + 1)); pos++; }
            if(limit === undefined) limit = -1;

            while(pos < buf.length && (decoded < limit && limit !== -1)) {
                const id = types.decNum(buf.slice(pos, pos + 1));
                const field = fields.find(x => x.binaryId == id);
                const slice = buf.slice(pos + 1);

                const len = field.lengthingFunc(slice);
                t[field.prop] = field.decode(slice.slice(0, len));

                pos += len + 1;
                decoded++;
            }

            return pos;
        }
    } else {
        return (buf: Buffer, limit?: number, pos: number = 0) => {
            if(limit !== undefined)
                throw new Error("\"limit\" is not supported on non-id-prefixed fields");
            if(pos !== 0)
                throw new Error("\"pos\" is not supported on non-id-prefixed fields");

            const n = t;

            for(const field of fields) {
                const len = field.lengthingFunc(buf);
                n[field.prop] = field.decode(buf.slice(0, len));
                buf = buf.slice(len);
            }

            return n;
        }
    }
}