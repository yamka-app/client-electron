const _modules = {};

_modules["remote"]   = require("@electron/remote");
_modules["electron"] = require("electron");

_modules["escapeHtml"]      = require("escape-html");
_modules["marked"]          = require("marked");
_modules["path"]            = require("path");
_modules["remark"]          = require("remark");
_modules["gemojiToEmoji"]   = require("remark-gemoji-to-emoji");
_modules["twemoji"]         = require("twemoji");
_modules["fs"]              = require("fs");
_modules["qrcode"]          = require("qrcode");
_modules["highlightBlock"]  = require("highlight.js").highlightBlock;
_modules["blurhash"]        = require("blurhash");
_modules["compareVersions"] = require('compare-versions');
_modules["tinycolor"]       = require('tinycolor2');

window["_modules"] = _modules;
window["__dirname"] = _modules["path"].join(__dirname, "../../../");
