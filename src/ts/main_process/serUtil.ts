// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Okay, real talk.
// This is quite possibly the worst code I ever wrote.
// Please don't look at it. I hate it. You're going to hate it.
// You're going to hate me.
//
// Please. Look away. Read all the other files, but not this one.
// Or, if you do read it, please quietly submit a PR if you know
// a way to improve it. I don't.

import "reflect-metadata";
import {
    KeyExportOptions,
    createSecretKey, createPublicKey, createPrivateKey
} from "crypto";
import { KeyPair } from "./protocol/salty/salty";

// Key formats
const symmFormat = undefined;
const publFormat: KeyExportOptions<"pem"> = { type: "spki",  format: "pem" };
const privFormat: KeyExportOptions<"pem"> = { type: "pkcs8", format: "pem" };

// Sets all type descriptors because there is no reflection in TS :)
export function member(target: Object, key: string|symbol) {
    const t = Reflect.getMetadata("design:type", target, key);
    const fields = Reflect.getMetadata('meta:fields', target) ?? {};
    if (!(key in target))
        fields[key] = t;
    Reflect.defineMetadata('meta:fields', fields, target);
}

function mush(obj: any) {
    if(obj instanceof Array && obj.every(x => x instanceof KeyPair))
        return { type: "keyarr", data: obj.map(x => mush(x)) };
    if(obj instanceof Array)
        return { type: "unkarr", data: obj.map(x => mush(x)) };
    if(typeof obj === "string" || typeof obj === "boolean" || obj instanceof Date || typeof obj === "number")
        return obj;
    if(obj === null || obj === undefined)
        return obj;
    if(obj instanceof Buffer)
        return [...obj];

    try {
        if (!Reflect.hasMetadata("meta:fields", obj))
            return {};
    } catch {
        return {};
    }

    const otherObj: any = {};
    for(const kv of Object.entries(Reflect.getMetadata("meta:fields", obj))) {
        const [key, ftype]: [string, any] = kv;
        const mushed = mush(obj[key]);
        otherObj[key] = mushed;
        // Export keys
        // (ikr, TS """reflection""" is just a huge hack anyway)
        if(ftype?.name === "KeyObject" && obj[key] !== undefined) {
            const type = obj[key].type;
            const encoding = {
                secret:  symmFormat,
                public:  publFormat,
                private: privFormat
            }[type];
            otherObj[key] = {
                type: type,
                data: obj[key].export(encoding)
            };
        }
    }

    return otherObj;
}

export function jsonify(obj: any) {
    return JSON.stringify(Object.assign({...obj}, mush(obj)));
}

// Recursively goes through all fields and unmushes them too if possible
// TS is weird, ay?
// I love it!!!!
function unmush<T>(c: { new(...a: any[]): T }, data: any): T {
    if(c === undefined || data === undefined) return undefined;

    if(c?.name === "Array") {
        if(data.type === "unkarr")
            return data.data;
        else if(data.type === "keyarr")
            return data.data.map(x => unmush(KeyPair, x));
    }

    if(c?.name === "Buffer") {
        // @ts-ignore
        // ^ it's okay since we know it's a buffer
        return Buffer.from(data);
    }

    if(c?.name === "KeyObject") {
        const type = data.type;
        const encoding = {
            secret:  symmFormat,
            public:  publFormat,
            private: privFormat
        }[type];
        const importFunc = {
            secret:  createSecretKey,
            public:  createPublicKey,
            private: createPrivateKey
        }[type];
        return importFunc(type === "secret"
                ? Buffer.from(data.data.data)
                : data.data, encoding);
    }

    if(["Boolean", "Date", "String"].includes(c?.name))
        return data;
    if(c?.name === "Number")
        return data;

    const otherObj: any = {};
    const inst = new c();
    if (Reflect.hasMetadata("meta:fields", inst)) {
        for(const kv of Object.entries(Reflect.getMetadata("meta:fields", inst))) {
            var [key, ftype]: [string, any] = kv;
            // Look away.
            if(c?.name === "DHRatchet" && key === "keyPair")
                ftype = KeyPair;
            otherObj[key] = unmush(ftype as any, data[key]);
        }
    }

    return Object.assign(inst, data, otherObj);
}

// Usage: dejsonify(ClassName, json)
export function dejsonify<T>(c: { new(...a: any[]): T }, data: string): T {
    const deser = JSON.parse(data);
    return unmush(c, deser);
}