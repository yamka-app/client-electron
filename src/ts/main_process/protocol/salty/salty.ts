// Salty (E2EE protocol)
// Shamelessly ripped off of the Signal protocol
// ...so please go read their docs, they pretty much apply here:
// https://www.signal.org/docs/
//
// There are some changes though.
// I.  Clients have two identity keypairs: a "main" X25519 one
//     and a "signature" Ed25519 one. The main identity key
//     is used in DH operations. The sigature identity key
//     is used to sign the master and one-time prekeys,
//     along with the main identity key.
//     The algorithm that generates material for off-band
//     identity verification (e.g. a QR code) needs to
//     digest the signature identity key and not the main one
//     because proving that it's genuine authenticates every other
//     key as they're signed by that one.
//     Why not use the XEdDSA/VXEdDSA algorithm Signal have come up
//     with? I haven't happened to come across a JS implementation.
// II. nothing!! (I put the first 'I' just because I thought
//     there will be some more changes)

import * as ser      from "../../serUtil";
import { DHRatchet } from "./ratchet"
import * as fs       from "fs";
import * as path     from "path";
import { app }       from "electron";
import * as crypto   from "crypto";
import { KeyObject } from "crypto";
import hkdf          from "futoin-hkdf";
import EventEmitter  from "events";

import { EntityGetRequest, EntityKeyType } from "../packets";
import {
    Level1Msg,
    Level1AliceHelloMsg,
    Level2Msg,
    Level2AliceHelloMsg,
    Level2BobHelloMsg,
    Level1NormalMsg,
    Level2TextMsg,
    Level2TastyKeyMsg
} from "./salty_wire";
import {
    PKey, User, PkeyType,
    Entity, Message, MessageState,
    EntityType
} from "../entities";
import { MessageSection, MessageSectionType } from "../dataTypes";

const PREKEY_EXPIRATION = 12 * 3600 * 1000; // 12 hours
const OTPREKEY_STOCK = 32;
export const pubkeyFormat: crypto.KeyExportOptions<"der"> = { type: "spki", format: "der" };

export function fingerprint(key: KeyObject) {
    if(key === undefined)
        return "none";
    if(key.type === "public")
        return crypto.createHash("sha256")
                .update(key.export(pubkeyFormat))
                .digest("base64");
    else if(key.type === "secret")
        return crypto.createHash("sha256")
                .update(key.export())
                .digest("base64");
    else throw new Error();
}

export class KeyPair {
    @ser.member pub:   KeyObject;
    @ser.member priv:  KeyObject;
    @ser.member date:  Date;
    @ser.member stale: boolean = false;

    @ser.member
    static generate(ed: boolean = false) {
        const keys = ed ? crypto.generateKeyPairSync("ed25519")
                        : crypto.generateKeyPairSync("x25519");
        const pair = new KeyPair();
        pair.priv = keys.privateKey;
        pair.pub  = keys.publicKey;
        pair.date = new Date();
        return pair;
    }

    @ser.member
    public fingerprint() {
        return fingerprint(this.pub);
    }

    @ser.member
    public serialize() {
        return {
            pub:   this.pub.export (pubkeyFormat),
            priv:  this.priv.export({ type: "pkcs8", format: "pem" }),
            date:  this.date,
            stale: this.stale
        };
    }

    @ser.member
    static deserialize(obj: any) {
        const pair = new KeyPair();
        pair.priv  = crypto.createPrivateKey(obj.priv);
        pair.pub   = crypto.createPublicKey (obj.pub);
        pair.date  = obj.date;
        pair.stale = obj.stale;
        return pair; 
    }

    @ser.member
    static publicOnly(pub: KeyObject) {
        const pair = new KeyPair();
        pair.pub   = pub;
        pair.date  = new Date();
        pair.stale = false;
        return pair;
    }
}

// Conversation State
export class CState {
    @ser.member alice:    boolean;
    @ser.member identity: KeyObject;
    @ser.member idSign:   KeyObject;
    @ser.member eph:      KeyPair;
    @ser.member sk:       KeyObject;
    @ser.member stale:    boolean;
    @ser.member ratchet:  DHRatchet;

    @ser.member
    public fingerprint() {
        return crypto.createHash("sha256")
            .update(this.identity.export(pubkeyFormat))
            .update(this.idSign  .export(pubkeyFormat))
            .digest("base64");
    }
}

function tdiff(from: Date, to?: Date) {
    return ((to ?? new Date()).getTime() - from.getTime()) / 1000;
}

class KeyStore extends EventEmitter {
    @ser.member identity:  KeyPair;
    @ser.member idSign:    KeyPair;
    @ser.member prekeys:   KeyPair[];
    @ser.member otprekeys: KeyPair[];

    @ser.member
    public updPrekeys() {
        if(this.prekeys === [] || this.prekeys === undefined)
            this.prekeys = [KeyPair.generate()];
        // re-generate the main prekey every PREKEY_EXPIRATION ms
        // (keep the old one for 2*PREKEY_EXPIRATION ms to allow for delayed handshakes)
        for(const key of this.prekeys) {
            if(tdiff(key.date) >= PREKEY_EXPIRATION) {
                const idx = this.prekeys.push(KeyPair.generate()) - 1;
                key.stale = true;
                console.log("[salty] master prekey generated");
                this.emit("new_mp", this.prekeys[idx]);
            }
        }
        this.prekeys = this.prekeys.filter(x => tdiff(x.date) < 2 * PREKEY_EXPIRATION);

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

    @ser.member
    static generate() {
        const store = new KeyStore();
        store.identity = KeyPair.generate();
        store.idSign   = KeyPair.generate(true); // ed25519 keypair to sign other keys
        console.log(`[salty] identity key generated (fingerprint ${store.identity.fingerprint()})`);
        console.log(`[salty] id_sign  key generated (fingerprint ${store.idSign.fingerprint()})`);
        store.updPrekeys();
        return store;
    }
}

export class SaltyCallbacks {
    public entityGet: (req: EntityGetRequest[], cb: (e: Entity[]) => any) => void;
    public entityPut: (ent: Entity[]) => void;
}
export default class SaltyClient {
    private storePath: string;
    private keys: KeyStore;
    private conv: { [uid: string]: CState } = {};
    private uid:  number;
    private aid:  number;
    private cb:   SaltyCallbacks;

    public load() {
        // TODO (temporary): abort if there is an identity key
        //                   associated with this account that doesn't
        //                   match the one in the current key store
        // TODO (long-term): sync with the key-holding agent in that case
        //                   or proceed with the new identity key if the
        //                   previous keystore is lost
        try {
            this.keys = ser.dejsonify(KeyStore, fs.readFileSync(this.storePath, "utf8"));
        } catch(ex) {
            this.keys = KeyStore.generate();
            this.dump();
            // Sign and upload keys
            // (the API actually ignores the "owner" field)
            this.cb.entityPut([
                PKey.fromKeyObj(this.uid, PkeyType.IDSIGN, this.keys.idSign.pub),
                PKey.fromKeyObj(this.uid, PkeyType.IDENTITY, this.keys.identity.pub, this.keys.idSign.priv),
                PKey.fromKeyObj(this.uid, PkeyType.PREKEY, this.keys.prekeys[0].pub, this.keys.idSign.priv),
                ...this.keys.otprekeys.map(x => PKey.fromKeyObj(this.uid, PkeyType.OTPREKEY,
                    x.pub, this.keys.idSign.priv))
            ]);
        }
        // Sign and upload new one-time and master prekeys as they're generated
        this.keys.on("new_mp", (key: KeyObject) =>
            this.cb.entityPut([PKey.fromKeyObj(this.uid, PkeyType.PREKEY,
            key, this.keys.idSign.priv)]));
        this.keys.on("new_otp", (keys: KeyObject[]) =>
            this.cb.entityPut(keys.map(x => PKey.fromKeyObj(this.uid, PkeyType.OTPREKEY,
            x, this.keys.idSign.priv))));
    }

    public dump() {
        fs.writeFileSync(this.storePath, ser.jsonify(this.keys));
        for(const key of Object.keys(this.conv))
            this.dumpConv(Number(key));
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

    public otprekeyUsed(pkey: PKey) {
        // TODO
    }

    private static x3dhKdf(keyMaterial: Buffer) {
        const f    = Buffer.from(Array(32).fill(255));
        const salt = Buffer.from(Array(64).fill(0));
        return crypto.createSecretKey(hkdf(Buffer.concat([f, keyMaterial]), 32,
            { salt: salt, info: "YamkaX3DHKDF", hash: "sha512" }));
    }

    public handshakeInit(uid: number, cid: number, done: () => void) {
        // Fetch the user's X3DH key bundle
        const state = new CState();
        state.alice = true;
        this.cb.entityGet([
            new EntityGetRequest(EntityType.USER, uid, EntityKeyType.IDSIGN),
            new EntityGetRequest(EntityType.USER, uid, EntityKeyType.IDENTITY),
            new EntityGetRequest(EntityType.USER, uid, EntityKeyType.PREKEY),
            new EntityGetRequest(EntityType.USER, uid, EntityKeyType.OTPREKEY)
        ], ([idsp, idkp, pkp, otkp]) => {
            // Save the keys (verify them with the signature identity key)
            state.idSign   = (idsp as User).idsignKey  .toKeyObj();
            state.identity = (idkp as User).identityKey.toKeyObj(state.idSign);
            const prek   = (pkp  as User).prekey   .toKeyObj(state.idSign);
            const otprek = (otkp as User).otprekey?.toKeyObj(state.idSign); // may be undefined

            // Generate an ephemeral key pair and perform 3-4 Diffie-Hellmans
            state.eph = KeyPair.generate();
            const dh1 = crypto.diffieHellman({ // IK_A - SPK_B
                privateKey: this.keys.identity.priv,
                publicKey:  prek
            });
            const dh2 = crypto.diffieHellman({ // EK_A - IK_B
                privateKey: state.eph.priv,
                publicKey:  state.identity
            });
            const dh3 = crypto.diffieHellman({ // EK_A - SPK_B
                privateKey: state.eph.priv,
                publicKey:  prek
            });
            var dh4 = Buffer.from([]);
            if(otprek !== undefined)
                dh4 = crypto.diffieHellman({ // EK_A - OPK_B
                    privateKey: state.eph.priv,
                    publicKey:  otprek
                });

            // Calculate the shared secret key and store all keys
            state.sk = SaltyClient.x3dhKdf(Buffer.concat([dh1, dh2, dh3, dh4]));
            const ad = Buffer.concat([
                state.identity.export(pubkeyFormat),
                this.keys.identity.pub.export(pubkeyFormat)
            ]);
            const keyBase = path.join(app.getPath("appData"), "yamka", `msg_keys_${this.uid}_${cid}`);
            state.ratchet = new DHRatchet(keyBase, state.sk, ad);
            state.ratchet.step(prek);
            this.conv[`${cid}`] = state;
            this.dumpConv(cid);

            // Send an initial message
            const msg = new Message();
            msg.channel = cid;
            msg.latest = new MessageState();
            msg.latest.encrypted = new Level1AliceHelloMsg(state.eph.pub, otprek,
                    new Level2AliceHelloMsg(state.ratchet.keyPair.pub, 123).encode(state.ratchet)).encode();
            this.cb.entityPut([msg]);

            done();
        });
    }

    private findOtp(pub: KeyObject) {
        if(pub === undefined)
            return undefined;
        const pair = this.keys.otprekeys.find(x => x.fingerprint() === fingerprint(pub));
        if(pair === undefined)
            throw new Error("Received one-time prekey is not in the local list");
        return pair.priv;
    }

    private handshakeAck(cid: number, uid: number, l1: Level1AliceHelloMsg) {
        return new Promise<Level2Msg>((success) => {
            this.cb.entityGet([
                new EntityGetRequest(EntityType.USER, uid, EntityKeyType.IDSIGN),
                new EntityGetRequest(EntityType.USER, uid, EntityKeyType.IDENTITY)
            ], ([idsp, idkp]) => {
                const state = new CState();
                state.alice = false;
                // Save the keys (verify them with the signature identity key)
                state.idSign   = (idsp as User).idsignKey  .toKeyObj();
                state.identity = (idkp as User).identityKey.toKeyObj(state.idSign);
                state.eph = KeyPair.publicOnly(l1.eph);
                // Perform 3-4 Diffie-Hellmans
                const dh1 = crypto.diffieHellman({ // IK_A - SPK_B
                    publicKey:  state.identity,
                    privateKey: this.keys.prekeys[0].priv
                });
                const dh2 = crypto.diffieHellman({ // EK_A - IK_B
                    publicKey:  state.eph.pub,
                    privateKey: this.keys.identity.priv
                });
                const dh3 = crypto.diffieHellman({ // EK_A - SPK_B
                    publicKey:  state.eph.pub,
                    privateKey: this.keys.prekeys[0].priv
                });
                var dh4 = Buffer.from([]);
                if(l1.otp !== undefined)
                    dh4 = crypto.diffieHellman({ // EK_A - OPK_B
                        publicKey:  state.eph.pub,
                        privateKey: this.findOtp(l1.otp)
                    });
    
                // Calculate the shared secret key and store all keys
                state.sk = SaltyClient.x3dhKdf(Buffer.concat([dh1, dh2, dh3, dh4]));
                const ad = Buffer.concat([
                    this.keys.identity.pub.export(pubkeyFormat),
                    state.identity.export(pubkeyFormat)
                ]);
                const keyBase = path.join(app.getPath("appData"), "yamka", `msg_keys_${this.uid}_${cid}`);
                state.ratchet = new DHRatchet(keyBase, state.sk, ad, this.keys.prekeys[0]);
                this.conv[`${cid}`] = state;
                this.dumpConv(cid);
    
                // Reply to the initial message
                const aliceHello = Level2Msg.decode(l1.l2d, state.ratchet);
                const msg = new Message();
                msg.channel = cid;
                msg.latest = new MessageState();
                msg.latest.encrypted = new Level1NormalMsg(new Level2BobHelloMsg(
                    state.ratchet.keyPair.pub, 231).encode(state.ratchet)).encode();
                this.cb.entityPut([msg]);

                success(aliceHello);
            });
        });
    }

    private e2eeDbgSection(info: any, error: boolean = false) {
        return new MessageSection(error
                ? MessageSectionType.E2EEERR
                : MessageSectionType.E2EEDBG, 0, JSON.stringify(info));
    }
    public async processMsg(cid: number, uid: number, mid: number, data: Buffer): Promise<MessageSection[]> {
        try {
            if(!(`${cid}` in this.conv))
                this.loadConv(cid);
        } catch(ex) { }
        // Decode L1
        const l1 = Level1Msg.decode(data);
        if(l1 instanceof Level1AliceHelloMsg) {
            const bob = uid < this.uid;
            var l2 = (bob && !(`${cid}` in this.conv))
                    ? await this.handshakeAck(cid, uid, l1)
                    : Level2Msg.decode(l1.l2d, this.conv[`${cid}`].ratchet);
            const state = this.conv[`${cid}`];

            if(!(l2 instanceof Level2AliceHelloMsg))
                throw new Error("L1 Alice Hello should enclose L2 Alice Hello");
            if(l2.check !== 123)
                console.error(`[salty] L2 Alice Hello check is ${l2.check}, expected 123`);
            return [this.e2eeDbgSection({
                "Type": "Alice Hello",
                "We're Alice": `${state.alice}`,
                "Ephemeral key": fingerprint(l1.eph),
                "One-time prekey": fingerprint(l1.otp),
                "Channel ID": `${cid}`,
                "Other party ID": `${uid}`,
                "Other party identity key": fingerprint(state.identity),
                "Other party signature key": fingerprint(state.idSign),
                "Own identity key": this.keys.identity.fingerprint(),
                "Own signature key": this.keys.idSign.fingerprint(),
                "Elliptic curve": "curve25519",
                "Signature algorithm": "Ed25519",
                "Key agreement": "X25519",
                "Cipher": "AES-256-GCM",
                "HKDF (X3DH + DH-ratchet) hash": "SHA-512",
                "HMAC (KDF-ratchet) hash": "SHA-256",
                "Auth tag length": "16",
                "X3DH secret": fingerprint(state.sk),
                "Check string": this.checkString(cid),
                "Check (must be 123 if everythting adds up)": l2.check
            })];
        } else if(l1 instanceof Level1NormalMsg) {
            const state = this.conv[`${cid}`];
            try {
                const l2 = Level2Msg.decode(l1.data, state.ratchet);
                if(l2 instanceof Level2BobHelloMsg) {
                    return [this.e2eeDbgSection({
                        "Type": "Bob Hello",
                        "Check (must be 231)": l2.check
                    })];
                } else if(l2 instanceof Level2TextMsg) {
                    return l2.sections;
                } else if(l2 instanceof Level2TastyKeyMsg) {
                    return [this.e2eeDbgSection({
                        "Type": "Voice encryption key",
                        "Key": fingerprint(l2.key)
                    })];
                }
            } catch(ex) {
                return [this.e2eeDbgSection({
                    "Info": "Something went wrong and this message can't be decrypted. Please contact support",
                    "Message ID": `${mid}`,
                    "Channel ID": `${cid}`,
                    "Other party ID": `${uid}`,
                    "Other party identity key": fingerprint(state.identity),
                    "Other party signature key": fingerprint(state.idSign),
                    "Own identity key": this.keys.identity.fingerprint(),
                    "Own signature key": this.keys.idSign.fingerprint(),
                    "X3DH secret": fingerprint(state.sk),
                    "Current DH-ratchet root key": fingerprint(state.ratchet.rootKey),
                    "Current DH-ratchet public key": fingerprint(state.ratchet.pubKey),
                    "Current DH-ratchet key pair": state.ratchet.keyPair.fingerprint(),
                    "Current receiving KDF-ratchet chain key": fingerprint(state.ratchet.recv.chainKey),
                    "Current sending KDF-ratchet chain key": fingerprint(state.ratchet.send.chainKey),
                    "Check string": this.checkString(cid)
                }, true)];
            }
        }
    }

    // Encrypts a TextMessage or a TastyKey
    public encryptMsg(cid: number, data: MessageSection[] | KeyObject) {
        if(!(`${cid}` in this.conv))
            this.loadConv(cid);
        const state = this.conv[`${cid}`];
        const includePub = state.ratchet.lastR;
        const pub = includePub ? state.ratchet.keyPair.pub : undefined;
        return new Level1NormalMsg(
                (data instanceof KeyObject
                ? new Level2TastyKeyMsg(pub, data)
                : new Level2TextMsg(pub, data))
            .encode(state.ratchet)).encode();
    }

    // Calculates a check string
    public checkString(cid: number) {
        if(!(`${cid}` in this.conv))
            this.loadConv(cid);
        const state = this.conv[`${cid}`];
        // Order is important: Alice's key first and Bob's key second
        if(state.alice) {
            return crypto.createHash("sha256")
                    .update(this.keys.idSign.pub.export(pubkeyFormat))
                    .update(state.idSign.export(pubkeyFormat))
                    .digest("base64"); 
        } else {
            return crypto.createHash("sha256")
                    .update(state.idSign.export(pubkeyFormat))
                    .update(this.keys.idSign.pub.export(pubkeyFormat))
                    .digest("base64"); 
        }
    }

    private convPath(id: number) {
        return path.join(app.getPath("appData"), "yamka", `conv_${this.uid}_${id}.json`);
    }
    public loadConv(id: number) {
        this.conv[`${id}`] = ser.dejsonify(CState, fs.readFileSync(this.convPath(id), "utf8"));
    }
    public dumpConv(id: number) {
        fs.writeFileSync(this.convPath(id), ser.jsonify(this.conv[`${id}`]), "utf8");
    }
}