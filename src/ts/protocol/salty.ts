// Salty (E2EE protocol)
// Shamelessly ripped off of the Signal protocol
// ...so please go read their docs, they pretty much apply here:
// https://www.signal.org/docs/

import * as fs     from "fs";
import * as path   from "path";
import { app }     from "electron";
import * as crypto from "crypto";

export const PREKEY_EXPIRATION = 12 * 3600 * 1000; // 12 hours
export const OTPREKEY_STOCK = 16;

export class KeyBundle {
    pub:   crypto.KeyObject;
    priv:  crypto.KeyObject;
    date:  Date;
    stale: boolean = false;

    static generate() {
        const keys = crypto.generateKeyPairSync("x25519");
        const bundle = new KeyBundle();
        bundle.priv = keys.privateKey;
        bundle.pub  = keys.publicKey;
        bundle.date = new Date();
        return bundle;
    }

    public fingerprint() {
        return crypto.createHash("sha256")
            .update(this.pub.export({ type: "spki", format: "der" }))
            .digest("base64");
    }

    public jsonify() {
        return JSON.stringify({
            pub:   this.pub.export ({ type: "spki",  format: "pem" }),
            priv:  this.priv.export({ type: "pkcs8", format: "pem" }),
            date:  this.date,
            stale: this.stale
        });
    }

    static dejsonify(json: string) {
        const obj = JSON.parse(json);
        const bundle = new KeyBundle();
        bundle.priv  = crypto.createPrivateKey(obj.priv);
        bundle.pub   = crypto.createPublicKey (obj.priv);
        bundle.date  = obj.date;
        bundle.stale = obj.stale;
        return bundle; 
    }
}

class KeyStore {
    device:    number;
    identity:  KeyBundle;
    prekeys:   KeyBundle[];
    otprekeys: KeyBundle[];

    private tdiff(from: Date, to?: Date) {
        return ((to ?? new Date()).getTime() - from.getTime()) / 1000;
    }

    public updPrekeys() {
        if(this.prekeys === [] || this.prekeys === undefined)
            this.prekeys = [KeyBundle.generate()];
        // re-generate the main prekey every PREKEY_EXPIRATION ms
        // (keep the old one for 2*PREKEY_EXPIRATION ms to allow for delayed handshakes)
        for(const key of this.prekeys) {
            if(this.tdiff(key.date) >= PREKEY_EXPIRATION) {
                this.prekeys.push(KeyBundle.generate());
                key.stale = true;
                console.log("[salty] master prekey generated");
            }
        }
        this.prekeys = this.prekeys.filter(x => this.tdiff(x.date) < 2 * PREKEY_EXPIRATION);

        // stock up on one-time prekeys
        if(this.otprekeys === [] || this.otprekeys === undefined)
            this.otprekeys = [];
        const new_otp = OTPREKEY_STOCK - this.otprekeys.length;
        for(var i = 0; i < new_otp; i++)
            this.otprekeys.push(KeyBundle.generate());
        if(new_otp > 0)
            console.log(`[salty] ${new_otp} one-time prekeys generated`);
    }

    static generate() {
        const store = new KeyStore();
        store.identity = KeyBundle.generate();
        console.log(`[salty] identity key generated (fingerprint ${store.identity.fingerprint()})`);
        store.updPrekeys();
        return store;
    }

    public jsonify() {
        return JSON.stringify({
            device:    this.device,
            identity:  this.identity.jsonify(),
            prekeys:   this.prekeys.map(x => x.jsonify()),
            otprekeys: this.otprekeys.map(x => x.jsonify())
        });
    }

    static dejsonify(data: string) {
        const obj   = JSON.parse(data);
        const store = new KeyStore();
        store.device    = obj.device;
        store.identity  = KeyBundle.dejsonify(obj.identity);
        store.prekeys   = obj.prekeys  .map(x => KeyBundle.dejsonify(x));
        store.otprekeys = obj.otprekeys.map(x => KeyBundle.dejsonify(x));
        return store;
    }
}

export class KeyMgr {
    private keys: KeyStore;
    private storePath: string;

    public load() {
        try {
            this.keys = KeyStore.dejsonify(fs.readFileSync(this.storePath, "utf8"));
        } catch(ex) {
            this.keys = KeyStore.generate();
            this.dump();
        }
    }

    public dump() {
        fs.writeFileSync(this.storePath, this.keys.jsonify());
    }

    constructor(uid: number) {
        this.storePath = path.join(app.getPath("appData"), "yamka", `key_store_${uid}.json`);
        this.load();
    }
}

export default class SaltyClient {
    private keys: KeyMgr;

    constructor(uid: number) {
        this.keys = new KeyMgr(uid);
    }

    public end() {
        this.keys.dump();
    }
}