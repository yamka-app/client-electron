// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const _modules = {};

_modules["remote"]   = require("@electron/remote");
_modules["electron"] = require("electron");

_modules["escapeHtml"]      = require("escape-html");
_modules["marked"]          = require("marked");
_modules["path"]            = require("path");
_modules["remark"]          = require("remark");
_modules["remarkEmoji"]     = require("remark-emoji");
_modules["twemoji"]         = require("twemoji");
_modules["fs"]              = require("fs");
_modules["qrcode"]          = require("qrcode");
_modules["highlightBlock"]  = require("highlight.js").highlightBlock;
_modules["blurhash"]        = require("blurhash");
_modules["compareVersions"] = require("compare-versions");
_modules["tinycolor"]       = require("tinycolor2");
_modules["os"]              = require("os");

window["_modules"] = _modules;
window["__dirname"] = _modules["path"].join(__dirname, "../../../");