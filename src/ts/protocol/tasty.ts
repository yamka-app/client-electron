// Tasty (voice/video) protocol client

import dgram from "dgram";
import crypto, { KeyObject } from "crypto";

import OpusScript from "opusscript";
import stream     from "stream";
import DataTypes  from "./dataTypes";
import Speaker    from "speaker";

export const OPUS_SET_BITRATE_REQUEST = 4002;

export const TASTY_PORT         = 1747;
export const TASTY_BITRATE      = 32000;
export const TASTY_SAMPLE_RATE  = 16000;
export const TASTY_CHANNELS     = 1;
export const TASTY_FRAME_LENGTH = 160;

export class TastyEncoderStats {
    frameRate:        number;
    bitRate:          number;
    sampleRate:       number;
    channels:         number;
    keySize:          number;
    compressionRatio: number;
}

export default class TastyClient {
    private sock:    dgram.Socket;
    private key:     KeyObject;
    private iv:      Buffer;
    private session: Buffer;

    private micStream:         MemoryStream;        
    private encoder:           OpusScript;
    private micFrameInterval:  NodeJS.Timeout;
    private heartbeatInterval: NodeJS.Timeout;
    private speakers:          any = {};

    private statCb: (stats: TastyEncoderStats) => void;

    constructor(keyCreated: (key: Buffer) => void) {
        const kb = crypto.randomBytes(128 / 8);
        this.iv  = crypto.randomBytes(128 / 8);
        this.key = crypto.createSecretKey(kb);

        keyCreated(Buffer.concat([kb, this.iv]));
    }

    finish(addr: string, session: Buffer, finished: () => void, statCb: (stats: TastyEncoderStats) => void) {
        this.statCb = statCb;
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
        });

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
        // create opus encoder
        this.encoder = new OpusScript(TASTY_SAMPLE_RATE, TASTY_CHANNELS, OpusScript.Application.VOIP);
        this.encoder.encoderCTL(OPUS_SET_BITRATE_REQUEST, TASTY_BITRATE);

        this.micStream = new MemoryStream();
        this.micFrameInterval = setInterval(() => this.voiceEncFrames(),
            TASTY_FRAME_LENGTH / TASTY_SAMPLE_RATE * 1000);
        this.heartbeatInterval = setInterval(() => this.sendEnc(Buffer.from([2])), 10000);
    }

    micData(data: Buffer) {
        if(this.micStream instanceof MemoryStream)
            this.micStream.write(data);
    }

    stop() {
        clearInterval(this.micFrameInterval);
        clearInterval(this.heartbeatInterval);
        this.micStream = null;

        this.sendEnc(Buffer.from([1]));
        this.sock.close();
    }

    private voiceEncFrames() {
        const targetLen = 2 * TASTY_FRAME_LENGTH * TASTY_CHANNELS;
        do {
            const pcm = this.micStream.grab(targetLen);
            if(pcm === null)
                break;
    
            const opus = this.encoder.encode(pcm, TASTY_FRAME_LENGTH);
            this.sendEnc(Buffer.concat([
                Buffer.from([0]), // voice data
                opus
            ]));

            const ratio = pcm.length / opus.length;
            const frameRate = TASTY_SAMPLE_RATE / TASTY_FRAME_LENGTH;
            this.statCb({
                compressionRatio: ratio,
                frameRate:        frameRate,
                sampleRate:       TASTY_SAMPLE_RATE,
                keySize:          this.key.symmetricKeySize * 8,
                bitRate:          TASTY_BITRATE,
                channels:         TASTY_CHANNELS
            });
        } while(true);
    }

    private voiceData(payload: Buffer) {
        const user = DataTypes.decNum(payload.slice(0, 8));
        const opus = payload.slice(8);
        const pcm = this.encoder.decode(opus);
        
        // each user has a separate output
        var speaker = this.speakers[user];
        if(speaker === undefined) {
            speaker = new Speaker({
                sampleRate: TASTY_SAMPLE_RATE,
                channels: TASTY_CHANNELS,
                bitDepth: 16,
                // @ts-ignore
                signed: true
            });
            this.speakers[user] = speaker;
        }

        speaker.write(pcm);
    }
}

class MemoryStream extends stream.Writable {
    private data = Buffer.alloc(0);

    _write(chunk, enc, next) {
        this.data = Buffer.concat([this.data, Buffer.from(chunk)]);
        next();
    }

    grab(cnt: number) {
        if(this.data.length < cnt) return null;
        const pcm = Buffer.from(this.data.slice(0, cnt));
        this.data = this.data.slice(cnt);
        return pcm;
    }
}