import DataTypes from "./dataTypes";

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

    decode = (buf: Buffer) => this.decodingFunc(buf.slice(this.hasBinaryId() ? 1 : 0));

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

export class ColorField extends SimpleField {
    constructor(p: string, bid?: number) { super(p, bid); }

    encodingFunc  = (val: string) => DataTypes.encNum(parseInt(val.slice(1)), 16);
    decodingFunc  = (buf: Buffer) => "#" + ("00000" + DataTypes.decNum(buf).toString(16)).slice(-6);
    lengthingFunc = (buf: Buffer) => 4;
}

export class StrField extends SimpleField {
    encodingFunc  = (val: string) => DataTypes.encStr(val);
    decodingFunc  = (buf: Buffer) => DataTypes.decStr(buf);
    lengthingFunc = (buf: Buffer) => DataTypes.decNum(buf.slice(0, 2));
}

export class NumListField extends SimpleField {
    bytes: number;

    constructor(p: string, b: number, bid?: number) { super(p, bid); this.bytes = b; }

    encodingFunc  = (val: number[]) => DataTypes.encNumList(val, this.bytes);
    decodingFunc  = (buf: Buffer)   => DataTypes.decNumList(buf, this.bytes);
    lengthingFunc = (buf: Buffer)   => DataTypes.decNum(buf.slice(0, 2)) * this.bytes;
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
        const remaining = fields.map(f => 
            (t[f.prop] === undefined) ?
                Buffer.alloc(0) :
                f.encode(t[f.prop]));

        return Buffer.concat([
            inclCnt ?
                DataTypes.encNum(remaining.length, 1) :
                Buffer.alloc(0),
            ...remaining
        ])
    }
}

export function simpleFieldDecoder(t: any, fields: SimpleField[], inclCnt: boolean = false): (buf: Buffer, limit?: number, pos?: number) => void|number {
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
                const slice = buf.slice(pos);

                t[field.prop] = field.decode(slice);

                pos += 2 + field.lengthingFunc(slice);
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

            var pos = 0;
            for(const field of fields) {
                const slice = buf.slice(pos);
                t[field.prop] = field.decode(slice);

                pos += field.lengthingFunc(slice);
            }
        }
    }
}