// Custom ratcheting implementation
// Largely based on https://www.signal.org/docs/specifications/doubleratchet

import * as ser    from "../../serUtil";
import * as crypto from "crypto";
import hkdf        from "futoin-hkdf";
import { KeyPair } from "./salty";
import types       from "../dataTypes";
import * as fs     from "fs";
import * as path   from "path";

export class KDFRatchet {
    @ser.member chainKey: crypto.KeyObject;
    @ser.member iter:     number; // we don't actually need this
    @ser.member ad:       Buffer;

    constructor(ad: Buffer) {
        this.ad = ad;
    }

    @ser.member
    public reset(newKey: crypto.KeyObject) {
        this.iter = 0;
        this.chainKey = newKey;
    }

    @ser.member
    public step() {
        this.iter++;
        // Generate the keys using different inputs as suggested by the spec
        const ckHmac = crypto.createHmac("sha256", this.chainKey);
        const mkHmac = crypto.createHmac("sha256", this.chainKey);
        ckHmac.update(Buffer.from([1]));
        mkHmac.update(Buffer.from([2]));
        this.chainKey = crypto.createSecretKey(ckHmac.digest());
        return          crypto.createSecretKey(mkHmac.digest());
    }

    @ser.member
    public encrypt(plaintext: Buffer): [crypto.KeyObject, Buffer] {
        const key = this.step();
        console.log("enc_key", key.export());
        const nonce = Buffer.from(Array(12).fill(0));
        const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
        cipher.setAAD(this.ad, { plaintextLength: plaintext.length });

        const ciphertext = cipher.update(plaintext);
        cipher.final();
        const auth = cipher.getAuthTag();
        return [key, Buffer.concat([
            types.encNum(ciphertext.length, 2),
            ciphertext,
            auth
        ])];
    }

    @ser.member
    public decrypt(data: Buffer, givenKey?: crypto.KeyObject): [crypto.KeyObject, Buffer] {
        console.log("dec", data, givenKey.export());
        const ctLen = types.decNum(data.slice(0, 2));
        const ciphertext = data.slice(2, 2 + ctLen);
        const auth = data.slice(2 + ctLen);

        const key = givenKey ?? this.step();
        const nonce = Buffer.from(Array(12).fill(0));
        const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
        decipher.setAuthTag(auth);
        decipher.setAAD(this.ad, { plaintextLength: ciphertext.length });
        const plaintext = decipher.update(ciphertext);
        console.log(plaintext);
        decipher.final();
        return [key, plaintext];
    }
}

export class DHRatchet {
    @ser.member keyPair:  KeyPair;
    @ser.member pubKey:   crypto.KeyObject;
    @ser.member rootKey:  crypto.KeyObject;
    @ser.member send:     KDFRatchet;
    @ser.member recv:     KDFRatchet;
    @ser.member iter:     number;
    @ser.member lastR:    boolean;
    @ser.member basePath: string; // for storing per-message keys
    @ser.member seq:      number = 0;

    constructor(basePath: string, rk: crypto.KeyObject, ad: Buffer, kp?: KeyPair) {
        this.basePath = basePath;
        if(basePath !== undefined &&  !fs.existsSync(basePath))
            fs.mkdirSync(basePath);
        this.rootKey = rk;
        this.keyPair = kp;
        this.send = new KDFRatchet(ad);
        this.recv = new KDFRatchet(ad);
    }

    @ser.member
    private rootStep(dh: Buffer) {
        const salt = Buffer.from(Array(64).fill(0));
        const hkdfOut = hkdf(dh, 64, { salt: salt, info: "RootRatchet", hash: "sha512" });
        this.rootKey = crypto.createSecretKey(hkdfOut.slice(0, 32));
        return crypto.createSecretKey(hkdfOut.slice(32, 64));
    }

    @ser.member
    public step(pk: crypto.KeyObject) {
        this.pubKey = pk;
        this.iter++;

        if(this.keyPair === undefined) {
            // First ever step: only reset the sending ratchet
            this.keyPair = KeyPair.generate();
            const dh = crypto.diffieHellman({
                privateKey: this.keyPair.priv,
                publicKey:  this.pubKey
            });
            this.send.reset(this.rootStep(dh));
            
            return this.keyPair.pub;
        } else {
            // All other steps: reset both rachets
            const dh1 = crypto.diffieHellman({
                privateKey: this.keyPair.priv,
                publicKey:  this.pubKey
            });
            this.recv.reset(this.rootStep(dh1));

            this.keyPair = KeyPair.generate();
            const dh2 = crypto.diffieHellman({
                privateKey: this.keyPair.priv,
                publicKey:  this.pubKey
            });
            this.send.reset(this.rootStep(dh2));

            return this.keyPair.pub;
        }
    }

    private readKeyRange(seq: number) {
        const rangeFile = path.join(this.basePath, `${Math.floor(seq / 100)}00`);
        try {
            return fs.readFileSync(rangeFile, "utf8").split("\n");
        } catch(ex) {
            return [];
        }
    }

    private loadKey(seq: number) {
        const keys = this.readKeyRange(seq);
        return crypto.createSecretKey(Buffer.from(keys[seq % 100], "base64"));
    }

    private writeKeyRange(seq: number, keys: string[]) {
        const rangeFile = path.join(this.basePath, `${Math.floor(seq / 100)}00`);
        fs.writeFileSync(rangeFile, keys.join("\n"));
    }

    private saveKey(seq: number, key: crypto.KeyObject) {
        const keys = this.readKeyRange(seq);
        keys[seq % 100] = key.export().toString("base64");
        this.writeKeyRange(seq, keys);
    }

    @ser.member
    public encrypt(plaintext: Buffer) {
        this.lastR = false;
        const [key, ciphertext] = this.send.encrypt(plaintext);
        this.saveKey(this.seq, key);
        return Buffer.concat([
            types.encNum(this.seq++, 4),
            ciphertext
        ]);
    }
    
    @ser.member
    public decrypt(ciphertext: Buffer) {
        this.lastR = true;
        const seq = types.decNum(ciphertext.slice(0, 4));
        ciphertext = ciphertext.slice(4);
        if(seq === this.seq + 1) {
            const [key, plaintext] = this.recv.decrypt(ciphertext);
            this.saveKey(this.seq++, key);
            return plaintext;
        } else if(seq < this.seq + 1) {
            const key = this.loadKey(seq);
            const [_, plaintext] = this.recv.decrypt(ciphertext, key);
            return plaintext;
        }
    }
}