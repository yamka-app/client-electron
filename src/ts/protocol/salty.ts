// Salty (E2EE protocol)
// Shamelessly ripped off of the Signal protocol
// ...so please go read their docs, they pretty much apply here:
// https://www.signal.org/docs/

import * as fs                    from "fs";
import * as path                  from "path";
import { app }                    from "electron";
import * as crypto                from "crypto";
import { EntityGetRequest }       from "./packets";
import { Entity, PKey, PkeyType } from "./entities";
import EventEmitter               from "events";

export const PREKEY_EXPIRATION = 12 * 3600 * 1000; // 12 hours
export const OTPREKEY_STOCK = 16;

export class KeyPair {
    pub:   crypto.KeyObject;
    priv:  crypto.KeyObject;
    date:  Date;
    stale: boolean = false;

    static generate() {
        const keys = crypto.generateKeyPairSync("ed25519");
        const pair = new KeyPair();
        pair.priv = keys.privateKey;
        pair.pub  = keys.publicKey;
        pair.date = new Date();
        return pair;
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
        const bundle = new KeyPair();
        bundle.priv  = crypto.createPrivateKey(obj.priv);
        bundle.pub   = crypto.createPublicKey (obj.priv);
        bundle.date  = obj.date;
        bundle.stale = obj.stale;
        return bundle; 
    }
}

class KeyStore extends EventEmitter {
    device:    number;
    identity:  KeyPair;
    prekeys:   KeyPair[];
    otprekeys: KeyPair[];

    private tdiff(from: Date, to?: Date) {
        return ((to ?? new Date()).getTime() - from.getTime()) / 1000;
    }

    public updPrekeys() {
        if(this.prekeys === [] || this.prekeys === undefined)
            this.prekeys = [KeyPair.generate()];
        // re-generate the main prekey every PREKEY_EXPIRATION ms
        // (keep the old one for 2*PREKEY_EXPIRATION ms to allow for delayed handshakes)
        for(const key of this.prekeys) {
            if(this.tdiff(key.date) >= PREKEY_EXPIRATION) {
                const idx = this.prekeys.push(KeyPair.generate()) - 1;
                key.stale = true;
                console.log("[salty] master prekey generated");
                this.emit("new_mp", this.prekeys[idx]);
            }
        }
        this.prekeys = this.prekeys.filter(x => this.tdiff(x.date) < 2 * PREKEY_EXPIRATION);

        // stock up on one-time prekeys
        if(this.otprekeys === [] || this.otprekeys === undefined)
            this.otprekeys = [];
        const old_keys = [...this.otprekeys];
        const new_otp = OTPREKEY_STOCK - this.otprekeys.length;
        for(var i = 0; i < new_otp; i++)
            this.otprekeys.push(KeyPair.generate());
        if(new_otp > 0) {
            console.log(`[salty] ${new_otp} one-time prekeys generated`);
            const new_keys = this.otprekeys.filter(x => !old_keys.includes(x)).map(x => x.pub);
            this.emit("new_otp", new_keys);
        }
    }

    static generate() {
        const store = new KeyStore();
        store.identity = KeyPair.generate();
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
        store.identity  = KeyPair.dejsonify(obj.identity);
        store.prekeys   = obj.prekeys  .map(x => KeyPair.dejsonify(x));
        store.otprekeys = obj.otprekeys.map(x => KeyPair.dejsonify(x));
        return store;
    }
}

export class SaltyCallbacks {
    public entityGet: (req: EntityGetRequest[], cb: (e: Entity[]) => any) => void;
    public entityPut: (ent: Entity[]) => void;
}
export default class SaltyClient {
    private keys: KeyStore;
    private storePath: string;
    private uid: number;
    private aid: number;
    private cb: SaltyCallbacks;

    public load() {
        // TODO (temporary): abort if there is an identity key
        //                   associated with this account
        //                   that doesn't match the one in current key store
        // TODO (long-term): sync with the key-holding agent in that case
        try {
            this.keys = KeyStore.dejsonify(fs.readFileSync(this.storePath, "utf8"));
        } catch(ex) {
            this.keys = KeyStore.generate();
            this.dump();
            // Sign and upload keys
            this.cb.entityPut([
                PKey.fromKeyObj(PkeyType.IDENTITY, this.keys.identity.pub),
                PKey.fromKeyObj(PkeyType.PREKEY, this.keys.prekeys[0].pub, this.keys.identity.priv),
                ...this.keys.otprekeys.map(x => PKey.fromKeyObj(PkeyType.OTPREKEY,
                    x.pub, this.keys.identity.priv))
            ]);
        }
        // Sign and upload new one-time and master prekeys as they're generated
        this.keys.on("new_mp", (key: crypto.KeyObject) =>
            this.cb.entityPut([PKey.fromKeyObj(PkeyType.PREKEY,
            key, this.keys.identity.priv)]));
        this.keys.on("new_otp", (keys: crypto.KeyObject[]) =>
            this.cb.entityPut(keys.map(x => PKey.fromKeyObj(PkeyType.OTPREKEY,
            x, this.keys.identity.priv))));
    }

    public dump() {
        fs.writeFileSync(this.storePath, this.keys.jsonify());
    }

    public end() {
        this.dump();
    }

    constructor(uid: number, aid: number, cb: SaltyCallbacks) {
        this.uid = uid;
        this.aid = aid;
        this.cb  = cb;
        this.storePath = path.join(app.getPath("appData"), "yamka", `key_store_${uid}.json`);
        this.load();
    }
}