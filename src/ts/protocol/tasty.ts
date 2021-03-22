// Tasty (voice/video) protocol client

import dgram from "dgram";
import crypto, { KeyObject } from "crypto";

import * as dataTypes from "./dataTypes";

import { OpusEncoder } from "@discordjs/opus";
import Speaker         from "speaker";
import Microphone      from "node-microphone";

export const TASTY_PORT = 1747;

export default class TastyClient {
    private sock:    dgram.Socket;
    private key:     KeyObject;
    private iv:      Buffer;
    private session: Buffer;

    constructor(keyCreated: (key: Buffer) => void) {
        const kb = crypto.randomBytes(128 / 8);
        this.iv  = crypto.randomBytes(128 / 8);
        this.key = crypto.createSecretKey(kb);

        keyCreated(Buffer.concat([kb, this.iv]));
    }

    finish(addr: string, session: Buffer, finished: () => void) {
        this.session = session;

        // create socket
        this.sock = dgram.createSocket("udp4");
        this.sock.on("message", (d, r) => this.onRecv(d, r));

        this.sock.on("connect", () => {
            console.log("TASTY: connected");
            // authenticate to the remote server
            this.send(Buffer.concat([
                Buffer.from([0]),
                this.session
            ]));

            // we're done
            finished();
        })

        this.sock.on("listening", () => {
            console.log("TASTY: listening");
            this.sock.connect(TASTY_PORT, addr);
        });
        this.sock.bind();
    }

    encrypt(data: Buffer) {
        // we create a new cipher each time because some packets may be lost because of UDP
        const cipher = crypto.createCipheriv("aes-128-cfb", this.key, this.iv);
        return cipher.update(data);
    }

    decrypt(data: Buffer) {
        const decipher = crypto.createDecipheriv("aes-128-cfb", this.key, this.iv);
        return decipher.update(data);
    }

    onRecv(data: Buffer, remote: dgram.RemoteInfo) {
        const payload = this.decrypt(data);
        console.log("TASTY recv", data, payload);
    }

    send(data: Buffer) {
        console.log("TASTY send", data);
        this.sock.send(data);
    }
}