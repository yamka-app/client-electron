// Tasty Plug
// Used to capture audio in the renderer process
// I really, REALLY don't want to do this because transmitting data
//   between Electron processes introduces latency, but OH GOD IS
//   THE NODE.JS AUDIO FRAMEWORK LANDSCAPE BAD

import { configGet, configSet } from "./settings.js";

async function _tasty_plug_func() {
    const _modules = window["_modules"];
    const { ipcRenderer } = _modules.electron;

    function ipcSend(data: any) {
        ipcRenderer.send("asynchronous-message", data);
    }

    var gain = configGet("micGain");
    var thr = configGet("micThres");

    function processBuffer(input: Int16Array) {
        // apply gain and calculate loudness
        var loudness = 0;
        for(var i = 0; i < input.length; i++) {
            input[i] = input[i] * gain;
            loudness += Math.abs(input[i]);
        }
        loudness /= input.length * 32768;

        return { data: input, send: loudness >= thr };
    }

    // @ts-ignore
    // It's a plain window.* JS module TS doesn't know about
    await window.WebVoiceProcessor.WebVoiceProcessor.init({ engines: [{
        postMessage: function(e) {
            if (e.command !== "process") return;
            const result = processBuffer(e.inputFrame);

            if(result.send)
                ipcSend({ action: "tasty.mic-data", data: new Uint8Array(result.data.buffer) });
        }
    }] });
}

window.addEventListener("load", _tasty_plug_func);