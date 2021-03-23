// Tasty Plug
// Used to capture audio in the renderer process
// I really, REALLY don't want to do this because transmitting data
//   between Electron processes introduces latency, but OH GOD IS
//   THE NODE.JS AUDIO FRAMEWORK LANDSCAPE BAD

async function _tasty_plug_func() {
    const _modules = window["_modules"];
    const { ipcRenderer } = _modules.electron;

    function ipcSend(data: any) {
        ipcRenderer.send("asynchronous-message", data);
    }

    // @ts-expect-error
    await window.WebVoiceProcessor.WebVoiceProcessor.init({ engines: [{
        postMessage: function(e) {
            if (e.command !== "process") return;
            const data: Int16Array = e.inputFrame;
            ipcSend({ action: "tasty.mic-data", data: new Uint8Array(data.buffer) });
        }
    }] });
}

window.addEventListener("load", _tasty_plug_func);