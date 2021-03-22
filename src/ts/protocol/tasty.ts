// Tasty (voice/video) protocol client

import dgram from "dgram";
import crypto, { KeyObject } from "crypto";

import * as opus   from "@discordjs/opus";
import stream      from "stream";
import DataTypes   from "./dataTypes";
import Speaker     from "speaker";

export const TASTY_PORT         = 1747;
export const TASTY_BITRATE      = 24000;
export const TASTY_SAMPLE_RATE  = 16000;
export const TASTY_CHANNELS     = 1;
export const TASTY_FRAME_LENGTH = 0.02;

export default class TastyClient {
    private sock:    dgram.Socket;
    private key:     KeyObject;
    private iv:      Buffer;
    private session: Buffer;

    private micStream:        MemoryStream;        
    private encoder:          opus.OpusEncoder;
    private micFrameInterval: NodeJS.Timeout;
    private speaker:          Speaker;

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

    private encrypt(data: Buffer) {
        // we create a new cipher each time because some packets may be lost because of UDP
        const cipher = crypto.createCipheriv("aes-128-cfb", this.key, this.iv);
        return cipher.update(data);
    }

    private decrypt(data: Buffer) {
        const decipher = crypto.createDecipheriv("aes-128-cfb", this.key, this.iv);
        return decipher.update(data);
    }

    private onRecv(data: Buffer, remote: dgram.RemoteInfo) {
        const payload = this.decrypt(data);

        const op = payload[0];
        switch(op) {
            case 0:
                this.startVoice();
                break;
            case 1:
                this.voiceData(payload.slice(1));
                break;
        }
    }

    private send(data: Buffer) {
        this.sock.send(data);
    }

    private sendEnc(data: Buffer) {
        this.send(Buffer.concat([
            Buffer.from([1]),
            this.encrypt(data)
        ]));
    }



    private startVoice() {
        this.speaker = new Speaker({
            sampleRate: TASTY_SAMPLE_RATE,
            channels: TASTY_CHANNELS,
            // @ts-ignore
            samplesPerFrame: TASTY_SAMPLE_RATE * TASTY_FRAME_LENGTH,
            bitDepth: 16,
            signed: true
        });

        // create opus encoder
        this.encoder = new opus.OpusEncoder(TASTY_SAMPLE_RATE, TASTY_CHANNELS);
        this.encoder.setBitrate(TASTY_BITRATE);

        this.micStream = new MemoryStream();
        this.micFrameInterval = setInterval(() => this.voiceEncFrame(), TASTY_FRAME_LENGTH * 1000);
    }

    micData(data: Buffer) {
        if(this.micStream instanceof MemoryStream)
            this.micStream.write(data);
    }

    stop() {
        clearInterval(this.micFrameInterval);
    }

    private voiceEncFrame() {
        const targetLen = 2 * TASTY_SAMPLE_RATE * TASTY_FRAME_LENGTH * TASTY_CHANNELS;
        const pcm = this.micStream.grab(targetLen);
        if(pcm.length !== targetLen)
            return;

        const opus = this.encoder.encode(pcm);

        this.sendEnc(Buffer.concat([
            Buffer.from([0]), // voice data
            opus
        ]));
    }

    private voiceData(payload: Buffer) {
        const user = DataTypes.decNum(payload.slice(0, 8));
        const opus = payload.slice(8);
        const pcm = this.encoder.decode(opus);
        
        //this.outCb(pcm, user);
        this.speaker.write(pcm);
    }
}

class MemoryStream extends stream.Writable {
    private data = Buffer.alloc(0);

    _write(chunk, enc, next) {
        this.data = Buffer.concat([this.data, Buffer.from(chunk)]);
        next();
    }

    grab(cnt: number) {
        const pcm = Buffer.from(this.data.slice(0, cnt));
        this.data = this.data.slice(cnt);
        return pcm;
    }
}