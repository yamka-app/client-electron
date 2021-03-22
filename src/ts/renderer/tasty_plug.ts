// Tasty Plug
// Used to capture audio using Recorder.js on the renderer process
// I really, REALLY don't want to do this because transmitting data
//   between Electron processes introduces latency, but OH GOD IS
//   THE NODE.JS AUDIO FRAMEWORK LANDSCAPE BAD

function _tasty_plug_func() {
    const _modules = window["_modules"];

    const remote           = _modules.remote;
    const MicrophoneStream = _modules.micstream;
    const { ipcRenderer }  = _modules.electron;



    function ipcSend(data: any) {
        ipcRenderer.send("asynchronous-message", data);
    }

    const micStream = new MicrophoneStream();
    navigator.getUserMedia({ audio: true }, (stream) => {
        console.log("Starting mic stream");
        micStream.setStream(stream);
    }, (error) => {
        console.error("mic error", error);
    });

    micStream.on("format", (format: any) => {
        const rate = format.sampleRate;
        const coeff = rate / 16000;

        micStream.on("data", (chunk: Uint8Array) => {
            const data: Float32Array = MicrophoneStream.toRaw(chunk);
    
            // convert the array to a raw signed 16-bit 16kHz PCM Buffer
            const buf = new Int16Array(data.length / coeff);
            for(var i = 0; i < buf.length; i++) {
                const sampleFloat = data[Math.floor(i * coeff)];
                const sample16 = sampleFloat * 32768;
                buf[i] = sample16;
            }
    
            ipcSend({ action: "tasty.mic-data", data: new Uint8Array(buf.buffer) });
        });
    });
}

window.addEventListener("load", _tasty_plug_func);