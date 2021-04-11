// Tasty Plug
// Used to capture audio in the renderer process
// I really, REALLY don't want to do this because transmitting data
//   between Electron processes introduces latency, but OH GOD IS
//   THE NODE.JS AUDIO FRAMEWORK LANDSCAPE BAD

import { configGet, configSet } from "./settings.js";

async function _tasty_plug_func() {
    const _modules = window["_modules"];
    const { ipcRenderer } = _modules.electron;

    const elementById = (id: string) => document.getElementById(id);
    function ipcSend(data: any) {
        ipcRenderer.send("asynchronous-message", data);
    }

    const micGainSlider = elementById("mic-gain")  as HTMLInputElement;
    const micThrSlider  = elementById("mic-thres") as HTMLInputElement;

    var gain = configGet("micGain");
    var thr = configGet("micThres");

    micGainSlider.value = gain;
    micThrSlider.value = thr;

    micGainSlider.onchange = (e) =>
        { const val = micGainSlider.value; gain = val; configSet("micGain",  val); };
    micThrSlider.onchange = (e) =>
        { const val = micThrSlider.value; thr = val; configSet("micThres", val); };

    function processBuffer(input: Int16Array) {
        // apply gain and calculate loudness
        var loudness = 0;
        for(var i = 0; i < input.length; i++) {
            input[i] = input[i] * gain;
            const normabs = Math.abs(input[i] / 32768);
            loudness += normabs * normabs;
        }
        loudness = Math.sqrt(loudness / input.length);

        return { data: input, loudness, send: loudness >= thr };
    }

    // @ts-ignore
    // It's a plain window.* JS module TS doesn't know about
    await window.WebVoiceProcessor.WebVoiceProcessor.init({ engines: [{
        postMessage: function(e) {
            if (e.command !== "process") return;
            const buf: Int16Array = e.inputFrame;
            // separate buffer into multiple separate ones
            const cSize = buf.length / 4;
            const cTime = cSize / 16000;
            for(var i = 0; i < 4; i++) {
                const chunk = buf.slice(i * cSize, (i + 1) * cSize);
                const result = processBuffer(chunk);

                // delay progress bar update
                setTimeout(() =>{
                    (elementById("mic-vol-val") as HTMLProgressElement).value = result.loudness;
                }, cTime * 1000);

                if(result.send)
                    ipcSend({ action: "tasty.mic-data", data: new Uint8Array(result.data.buffer) });
            }
        }
    }] });
}

window.addEventListener("load", _tasty_plug_func);