// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const _modules = {};

_modules["remote"]   = require("@electron/remote");
_modules["electron"] = require("electron");

_modules["escapeHtml"]      = require("escape-html");
_modules["marked"]          = require("marked");
_modules["path"]            = require("path");
_modules["nodeEmoji"]       = require("node-emoji");
_modules["twemoji"]         = require("twemoji");
_modules["fs"]              = require("fs");
_modules["qrcode"]          = require("qrcode");
_modules["blurhash"]        = require("blurhash");
_modules["tinycolor"]       = require("tinycolor2");
_modules["os"]              = require("os");
_modules["prism"]           = require("prismjs");
_modules["prismLoadLangs"]  = require("prismjs/components/index");

window["_modules"] = _modules;
window["__dirname"] = _modules["path"].join(__dirname, "../../../");