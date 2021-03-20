// Tasty (voice/video) protocol client

import dgram  from "dgram";
import crypto, { KeyObject } from "crypto";

import * as dataTypes from "./dataTypes";

export const TASTY_PORT = 1746;

export default class TastyClient {
    private sock:    dgram.Socket;
    private key:     KeyObject;
    private iv:      Buffer;
    private session: Buffer;

    constructor(keyCreated: (key: Buffer) => void) {
        const keyBytes = crypto.randomBytes(128 / 8);
        this.iv        = crypto.randomBytes(128 / 8);
        this.key = crypto.createSecretKey(keyBytes);

        keyCreated(Buffer.concat([keyBytes, this.iv]));
    }

    finish(addr: string, session: Buffer) {
        this.session = session;

        // create socket
        this.sock = dgram.createSocket("udp4");
        this.sock.connect(TASTY_PORT, addr);
        this.sock.on("message", this.recv);

        // print info
        const local = this.sock.address();
        const remote = this.sock.remoteAddress();
        console.log(`Tasty client ${local.address}:${local.port} is communicating with ${remote.address}:${remote.port}`);
    }

    private enc(data: Buffer) {
        // we create a new cipher each time because some packets may be lost because of UDP
        const cipher = crypto.createCipheriv("aes-128-gcm", this.key, this.iv);
        return cipher.update(data);
    }

    private dec(data: Buffer) {
        const decipher = crypto.createDecipheriv("aes-128-ccm", this.key, this.iv);
        return decipher.update(data);
    }

    private recv(data: Buffer, remote: dgram.RemoteInfo) {
        console.log(`TASTY recv ${data}`);
    }

    private send(data: Buffer) {
        console.log(`TASTY send ${data}`)
        this.sock.send(data);
    }
}