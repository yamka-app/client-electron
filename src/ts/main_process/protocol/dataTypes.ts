// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// ============================================== DATA TYPES
// Primitive data types for the Yamka protocol are defined here

export default class DataTypes {
    static encBool(val: boolean): Buffer {
        return this.encNum(val ? 1 : 0, 1);
    }
    static decBool(buf: Buffer): boolean {
        return this.decNum(buf) > 0;
    }


    static encNum(val: number, bytes: number): Buffer {
        if(val === undefined)
            return Buffer.alloc(0);

        var byteArray = Array.apply(null, Array(bytes)).map((x, i) => { return 0 });
    
        for (var i = byteArray.length - 1; i >= 0; i--) {
            var byte = val & 0xff;
            byteArray[i] = val;
            val = (val - byte) / 256;
        }
    
        return Buffer.from(byteArray);
    }
    static decNum(bytes: Buffer): number {
        var val = 0;
    
        for (var i = 0; i < bytes.length; i++)
            val = (val * 256) + bytes[i];
    
        return val;
    }

    
    static encNumList(val: number[], bytes: number): Buffer {
        if(val === undefined)
            return Buffer.alloc(0);

        var concatArr = [ this.encNum(val.length, 2) ];
        for(const num of val)
            concatArr.push(this.encNum(num, bytes));

        return Buffer.concat(concatArr);
    }
    static decNumList(bytes: Buffer, bytesPerNum: number): number[] {
        const cnt = this.decNum(bytes.slice(0, 2));
        var arr = [];
    
        for(var i = 0; i < cnt * bytesPerNum; i += bytesPerNum)
            arr.push(this.decNum(bytes.slice(2 + i, 2 + i + bytesPerNum)));
    
        return arr;
    }
    
    
    static encStr(str: string): Buffer {
        if(str === undefined)
            return Buffer.alloc(2);

        // A string consists of the actual UTF-8 encoded string and a 16-bit length (in bytes) preceding it
        var utf8 = Buffer.from(str, "utf8");
        return Buffer.concat([this.encNum(utf8.length, 2), utf8]);
    }
    static decStr(bytes: Buffer): string {
        const len   = this.decNum(bytes.slice(0, 2));
        const slice = bytes.slice(2, 2 + len);
        return slice.toString("utf8");
    }

    
    static encStrList(val: string[]): Buffer {
        if(val === undefined)
            return Buffer.alloc(0);

        return Buffer.concat([
            this.encNum(val.length, 2),
            ...val.map(s => this.encStr(s))
        ]);
    }
    static decStrList(bytes: Buffer): string[] {
        const cnt = this.decNum(bytes.slice(0, 2));
        var arr = [], pos = 2;
    
        for(var i = 0; i < cnt; i++) {
            arr.push(this.decStr(bytes.slice(pos)));
            pos += 2 + this.decNum(bytes.slice(pos, pos + 2));
        }
    
        return arr;
    }
    static strListLen(bytes: Buffer): number {
        const cnt = this.decNum(bytes.slice(0, 2));
        var len = 2;
    
        for(var i = 0; i < cnt; i++)
            len += 2 + this.decNum(bytes.slice(len, len + 2));
    
        return len;
    }


    static encMsgSections(val: MessageSection[]) {
        return Buffer.concat([
            DataTypes.encNum(val.length, 1),
            ...val.map(x => Buffer.concat([
                DataTypes.encNum(x.type, 1),
                DataTypes.encNum(x.blob, 8),
                DataTypes.encStr(x.text)
            ]))
        ]);
    }
    static decMsgSections(buf: Buffer) {
        const cnt = DataTypes.decNum(buf.slice(0, 1));
        var s: MessageSection[] = []; var pos = 1;
        for(var i = 0; i < cnt; i++) {
            const slice = buf.slice(pos);
            s.push(new MessageSection(
                DataTypes.decNum(slice.slice(0, 1)),
                DataTypes.decNum(slice.slice(1, 9)),
                DataTypes.decStr(slice.slice(9))
            ));
            pos += 11 + DataTypes.decNum(slice.slice(9, 11));
        }
        return s;
    }
    static lenMsgSections(buf: Buffer) {
        const cnt = DataTypes.decNum(buf.slice(0, 1));
        var pos = 1;
        for(var i = 0; i < cnt; i++)
            pos += 11 + DataTypes.decNum(buf.slice(pos + 9, pos + 11))
        return pos;
    }
}

export class Permissions {
    static len = 8;

    binary: Buffer;

    constructor(b: Buffer) { this.binary = b; }
}

export enum MessageSectionType {
    TEXT    = 0,
    FILE    = 1,
    CODE    = 2,
    QUOTE   = 3,
    INVITE  = 4,
    USER    = 5,
    BOT_UI  = 6,
    POLL    = 7,
    E2EEERR = 254,
    E2EEDBG = 255
}
export class MessageSection {
    type: MessageSectionType;
    blob: number;
    text: string;

    constructor(t?: MessageSectionType, b?: number, s?: string) {
        this.type = t;
        this.blob = b;
        this.text = s;
    }
}