import DataTypes, { MessageSection, Permissions } from "./dataTypes.js";
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
            DataTypes.encNum(this.binaryId, 1) :
            Buffer.alloc(0),
        this.encodingFunc(val)]);

    decode = (buf: Buffer) => this.decodingFunc(buf);

    hasBinaryId = () => this.binaryId !== undefined;
    
    constructor(p: string, bid?: number) { this.prop = p; this.binaryId = bid; }
}

export class NumField extends SimpleField {
    bytes: number;

    constructor(p: string, b: number, bid?: number) { super(p, bid); this.bytes = b; }

    encodingFunc  = (val: number) => DataTypes.encNum(val, this.bytes);
    decodingFunc  = (buf: Buffer) => DataTypes.decNum(buf.slice(0, this.bytes));
    lengthingFunc = (buf: Buffer) => this.bytes;
}

export class BoolField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: boolean) => DataTypes.encNum(val ? 1 : 0, 1);
    decodingFunc  = (buf: Buffer)  => DataTypes.decNum(buf.slice(0, 1)) > 0;
    lengthingFunc = (buf: Buffer)  => 1;
}

export class ColorField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: string) => DataTypes.encNum(parseInt(val.slice(1)), 3);
    decodingFunc  = (buf: Buffer) => "#" + ("00000" + DataTypes.decNum(buf).toString(16)).slice(-6);
    lengthingFunc = (buf: Buffer) => 3;
}

export class StrField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: string) => DataTypes.encStr(val);
    decodingFunc  = (buf: Buffer) => DataTypes.decStr(buf);
    lengthingFunc = (buf: Buffer) => DataTypes.decNum(buf.slice(0, 2)) + 2;
}

export class NumListField extends SimpleField {
    bytes: number;

    constructor(p: string, b: number, bid?: number) { super(p, bid); this.bytes = b; }

    encodingFunc  = (val: number[]) => DataTypes.encNumList(val, this.bytes);
    decodingFunc  = (buf: Buffer)   => DataTypes.decNumList(buf, this.bytes);
    lengthingFunc = (buf: Buffer)   => 2 + (DataTypes.decNum(buf.slice(0, 2)) * this.bytes);
}

export class StrListField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: string[]) => DataTypes.encStrList(val);
    decodingFunc  = (buf: Buffer)   => DataTypes.decStrList(buf);
    lengthingFunc = (buf: Buffer)   => DataTypes.strListLen(buf);
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

export class MsgSectionsField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: MessageSection[]) => Buffer.concat([
        DataTypes.encNum(val.length, 1),
        ...val.map(x => Buffer.concat([
            DataTypes.encNum(x.type, 1),
            DataTypes.encNum(x.blob, 8),
            DataTypes.encStr(x.text)
        ]))
    ]);

    decodingFunc = (buf: Buffer) => {
        const cnt = DataTypes.decNum(buf.slice(0, 1));
        var s = []; var pos = 1;
        for(var i = 0; i < cnt; i++) {
            const slice = buf.slice(pos);
            s.push(new MessageSection(
                DataTypes.decNum(slice.slice(0, 1)),
                DataTypes.decNum(slice.slice(1, 9)),
                DataTypes.decStr(slice.slice(9))
            ));
            pos += 9 + DataTypes.decNum(slice.slice(9, 11));
        }
        return s;
    };

    lengthingFunc = (buf: Buffer) => {
        const cnt = DataTypes.decNum(buf.slice(0, 1));
        var pos = 1;
        for(var i = 0; i < cnt; i++)
            pos += 11 + DataTypes.decNum(buf.slice(pos + 9, pos + 11))
        return pos;
    };
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
                DataTypes.encNum(remaining.length, 1) :
                Buffer.alloc(0),
            ...remaining.map(f => f.encode(t[f.prop]))
        ])
    }
}

export function simpleFieldDecoder(t: any, fields: SimpleField[], inclCnt: boolean = false): (buf: Buffer, limit?: number, pos?: number) => void|number|any {
    const allHaveId = checkBinaryIdExistence(fields);

    if(allHaveId) {
        // "limit" defines how many fields we're allowed to decode max
        return (buf: Buffer, limit?: number, pos: number = 0) => {
            var decoded = 0;
            if(inclCnt) { limit = DataTypes.decNum(buf.slice(pos, pos + 1)); pos++; }
            if(limit === undefined) limit = -1;

            while(pos < buf.length && (decoded < limit && limit !== -1)) {
                const id = DataTypes.decNum(buf.slice(pos, pos + 1));
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