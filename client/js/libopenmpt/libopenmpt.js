// .-----------------------------------------------------------------
// | Code originally from chiptune2.js
// | https://github.com/deskjet/chiptune2.js
// |
// | Inserted here to guarantee it gets loaded before libopenmpt
// '-----------------------------------------------------------------

// constants
const OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT = 2
const OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH = 3

// audio context
var ChiptuneAudioContext = window['AudioContext'] || window['webkitAudioContext'];

// config
var ChiptuneJsConfig = function (repeatCount, stereoSeparation, interpolationFilter, context)
{
  this.repeatCount = repeatCount;
  this.stereoSeparation = stereoSeparation;
  this.interpolationFilter = interpolationFilter;
  this.context = context;
}

ChiptuneJsConfig.prototype.constructor = ChiptuneJsConfig;

// player
var ChiptuneJsPlayer = function (config) {
  this.config = config;
  this.context = config.context || new ChiptuneAudioContext();
  this.currentPlayingNode = null;
  this.handlers = [];
  this.touchLocked = true;
}

ChiptuneJsPlayer.prototype.constructor = ChiptuneJsPlayer;

// event handlers section
ChiptuneJsPlayer.prototype.fireEvent = function (eventName, response) {
  var  handlers = this.handlers;
  if (handlers.length) {
    handlers.forEach(function (handler) {
      if (handler.eventName === eventName) {
        handler.handler(response);
      }
    })
  }
}

ChiptuneJsPlayer.prototype.addHandler = function (eventName, handler) {
  this.handlers.push({eventName: eventName, handler: handler});
}

ChiptuneJsPlayer.prototype.onEnded = function (handler) {
  this.addHandler('onEnded', handler);
}

ChiptuneJsPlayer.prototype.onError = function (handler) {
  this.addHandler('onError', handler);
}

// metadata
ChiptuneJsPlayer.prototype.duration = function() {
  return libopenmpt._openmpt_module_get_duration_seconds(this.currentPlayingNode.modulePtr);
}

ChiptuneJsPlayer.prototype.getCurrentRow = function() {
  return libopenmpt._openmpt_module_get_current_row(this.currentPlayingNode.modulePtr);  
}

ChiptuneJsPlayer.prototype.getCurrentPattern = function() {
  return libopenmpt._openmpt_module_get_current_pattern(this.currentPlayingNode.modulePtr);  
}

ChiptuneJsPlayer.prototype.getCurrentOrder = function() {
  return libopenmpt._openmpt_module_get_current_order(this.currentPlayingNode.modulePtr);  
}

ChiptuneJsPlayer.prototype.getCurrentTime = function () {
  return libopenmpt._openmpt_module_get_position_seconds(this.currentPlayingNode.modulePtr);
};

ChiptuneJsPlayer.prototype.getTotalOrder = function () {
  return libopenmpt._openmpt_module_get_num_orders(this.currentPlayingNode.modulePtr);
};

ChiptuneJsPlayer.prototype.getTotalPatterns = function () {
  return libopenmpt._openmpt_module_get_num_patterns(this.currentPlayingNode.modulePtr);
};

ChiptuneJsPlayer.prototype.metadata = function() {
  var data = {};
  var keys = UTF8ToString(libopenmpt._openmpt_module_get_metadata_keys(this.currentPlayingNode.modulePtr)).split(';');
  var keyNameBuffer = 0;
  for (var i = 0; i < keys.length; i++) {
    keyNameBuffer = libopenmpt._malloc(keys[i].length + 1);
    writeAsciiToMemory(keys[i], keyNameBuffer);
    data[keys[i]] = UTF8ToString(libopenmpt._openmpt_module_get_metadata(this.currentPlayingNode.modulePtr, keyNameBuffer));
    libopenmpt._free(keyNameBuffer);
  }
  return data;
}

ChiptuneJsPlayer.prototype.module_ctl_set = function(ctl, value) {
  return libopenmpt.ccall('openmpt_module_ctl_set', 'number', ['number', 'string', 'string'], [this.currentPlayingNode.modulePtr, ctl, value]) === 1;
}

// playing, etc
ChiptuneJsPlayer.prototype.unlock = function() {

  var context = this.context;
  var buffer = context.createBuffer(1, 1, 22050);
  var unlockSource = context.createBufferSource();

  unlockSource.buffer = buffer;
  unlockSource.connect(context.destination);
  unlockSource.start(0);

  this.touchLocked = false;
}

ChiptuneJsPlayer.prototype.load = function(input, callback) {

  if (this.touchLocked) {
    this.unlock();
  }

  var player = this;

  if (input instanceof File) {
    var reader = new FileReader();
    reader.onload = function() {
      return callback(reader.result); // no error
    }.bind(this);
    reader.readAsArrayBuffer(input);
  } else {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', input, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function(e) {
      if (xhr.status === 200) {
        return callback(xhr.response); // no error
      } else {
        player.fireEvent('onError', {type: 'onxhr'});
      }
    }.bind(this);
    xhr.onerror = function() {
      player.fireEvent('onError', {type: 'onxhr'});
    };
    xhr.onabort = function() {
      player.fireEvent('onError', {type: 'onxhr'});
    };
    xhr.send();
  }
}

ChiptuneJsPlayer.prototype.play = function(buffer) {
  this.stop();
  var processNode = this.createLibopenmptNode(buffer, this.config);
  if (processNode == null) {
    return;
  }

  // set config options on module
  libopenmpt._openmpt_module_set_repeat_count(processNode.modulePtr, this.config.repeatCount);
  libopenmpt._openmpt_module_set_render_param(processNode.modulePtr, OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT, this.config.stereoSeparation);
  libopenmpt._openmpt_module_set_render_param(processNode.modulePtr, OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH, this.config.interpolationFilter);

  this.currentPlayingNode = processNode;
  processNode.connect(this.context.destination);
}

ChiptuneJsPlayer.prototype.stop = function() {
  if (this.currentPlayingNode != null) {
    this.currentPlayingNode.disconnect();
    this.currentPlayingNode.cleanup();
    this.currentPlayingNode = null;
  }
}

ChiptuneJsPlayer.prototype.togglePause = function() {
	if (this.currentPlayingNode != null) {
    this.currentPlayingNode.togglePause();
  }
}

ChiptuneJsPlayer.prototype.createLibopenmptNode = function(buffer, config) {
  // TODO error checking in this whole function

  var maxFramesPerChunk = 4096;
  var processNode = this.context.createScriptProcessor(2048, 0, 2);
  processNode.config = config;
  processNode.player = this;
  var byteArray = new Int8Array(buffer);
  var ptrToFile = libopenmpt._malloc(byteArray.byteLength);
  libopenmpt.HEAPU8.set(byteArray, ptrToFile);
  processNode.modulePtr = libopenmpt._openmpt_module_create_from_memory(ptrToFile, byteArray.byteLength, 0, 0, 0);
  processNode.paused = false;
  processNode.leftBufferPtr  = libopenmpt._malloc(4 * maxFramesPerChunk);
  processNode.rightBufferPtr = libopenmpt._malloc(4 * maxFramesPerChunk);
  processNode.cleanup = function() {
    if (this.modulePtr != 0) {
      libopenmpt._openmpt_module_destroy(this.modulePtr);
      this.modulePtr = 0;
    }
    if (this.leftBufferPtr != 0) {
      libopenmpt._free(this.leftBufferPtr);
      this.leftBufferPtr = 0;
    }
    if (this.rightBufferPtr != 0) {
      libopenmpt._free(this.rightBufferPtr);
      this.rightBufferPtr = 0;
    }
  }
  processNode.stop = function() {
    this.disconnect();
    this.cleanup();
  }
  processNode.pause = function() {
    this.paused = true;
  }
  processNode.unpause = function() {
    this.paused = false;
  }
  processNode.togglePause = function() {
    this.paused = !this.paused;
  }
  processNode.onaudioprocess = function(e) {
    var outputL = e.outputBuffer.getChannelData(0);
    var outputR = e.outputBuffer.getChannelData(1);
    var framesToRender = outputL.length;
    if (this.ModulePtr == 0) {
      for (var i = 0; i < framesToRender; ++i) {
        outputL[i] = 0;
        outputR[i] = 0;
      }
      this.disconnect();
      this.cleanup();
      return;
    }
    if (this.paused) {
      for (var i = 0; i < framesToRender; ++i) {
        outputL[i] = 0;
        outputR[i] = 0;
      }
      return;
    }
    var framesRendered = 0;
    var ended = false;
    var error = false;
    while (framesToRender > 0) {
      var framesPerChunk = Math.min(framesToRender, maxFramesPerChunk);
      var actualFramesPerChunk = libopenmpt._openmpt_module_read_float_stereo(this.modulePtr, this.context.sampleRate, framesPerChunk, this.leftBufferPtr, this.rightBufferPtr);
      if (actualFramesPerChunk == 0) {
        ended = true;
        // modulePtr will be 0 on openmpt: error: openmpt_module_read_float_stereo: ERROR: module * not valid or other openmpt error
        error = !this.modulePtr;
      }
      var rawAudioLeft = libopenmpt.HEAPF32.subarray(this.leftBufferPtr / 4, this.leftBufferPtr / 4 + actualFramesPerChunk);
      var rawAudioRight = libopenmpt.HEAPF32.subarray(this.rightBufferPtr / 4, this.rightBufferPtr / 4 + actualFramesPerChunk);
      for (var i = 0; i < actualFramesPerChunk; ++i) {
        outputL[framesRendered + i] = rawAudioLeft[i];
        outputR[framesRendered + i] = rawAudioRight[i];
      }
      for (var i = actualFramesPerChunk; i < framesPerChunk; ++i) {
        outputL[framesRendered + i] = 0;
        outputR[framesRendered + i] = 0;
      }
      framesToRender -= framesPerChunk;
      framesRendered += framesPerChunk;
    }
    if (ended) {
      this.disconnect();
      this.cleanup();
      error ? processNode.player.fireEvent('onError', {type: 'openmpt'}) : processNode.player.fireEvent('onEnded');
    }
  }
  return processNode;
}

// .-----------------------------------------------------------------
// | Everything following this comment is from libopenmpt
// | and is unaltered from version libopenmpt 0.7.10 on
// | https://lib.openmpt.org/libopenmpt/download/
// '-----------------------------------------------------------------

function _toConsumableArray(r) { return _arrayWithoutHoles(r) || _iterableToArray(r) || _unsupportedIterableToArray(r) || _nonIterableSpread(); }
function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }
function _iterableToArray(r) { if ("undefined" != typeof Symbol && null != r[Symbol.iterator] || null != r["@@iterator"]) return Array.from(r); }
function _arrayWithoutHoles(r) { if (Array.isArray(r)) return _arrayLikeToArray(r); }
function _createForOfIteratorHelper(r, e) { var t = "undefined" != typeof Symbol && r[Symbol.iterator] || r["@@iterator"]; if (!t) { if (Array.isArray(r) || (t = _unsupportedIterableToArray(r)) || e && r && "number" == typeof r.length) { t && (r = t); var _n = 0, F = function F() {}; return { s: F, n: function n() { return _n >= r.length ? { done: !0 } : { done: !1, value: r[_n++] }; }, e: function e(r) { throw r; }, f: F }; } throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); } var o, a = !0, u = !1; return { s: function s() { t = t.call(r); }, n: function n() { var r = t.next(); return a = r.done, r; }, e: function e(r) { u = !0, o = r; }, f: function f() { try { a || null == t["return"] || t["return"](); } finally { if (u) throw o; } } }; }
function _unsupportedIterableToArray(r, a) { if (r) { if ("string" == typeof r) return _arrayLikeToArray(r, a); var t = {}.toString.call(r).slice(8, -1); return "Object" === t && r.constructor && (t = r.constructor.name), "Map" === t || "Set" === t ? Array.from(r) : "Arguments" === t || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t) ? _arrayLikeToArray(r, a) : void 0; } }
function _arrayLikeToArray(r, a) { (null == a || a > r.length) && (a = r.length); for (var e = 0, n = Array(a); e < a; e++) n[e] = r[e]; return n; }
function _classCallCheck(a, n) { if (!(a instanceof n)) throw new TypeError("Cannot call a class as a function"); }
function _defineProperties(e, r) { for (var t = 0; t < r.length; t++) { var o = r[t]; o.enumerable = o.enumerable || !1, o.configurable = !0, "value" in o && (o.writable = !0), Object.defineProperty(e, _toPropertyKey(o.key), o); } }
function _createClass(e, r, t) { return r && _defineProperties(e.prototype, r), t && _defineProperties(e, t), Object.defineProperty(e, "prototype", { writable: !1 }), e; }
function _toPropertyKey(t) { var i = _toPrimitive(t, "string"); return "symbol" == _typeof(i) ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != _typeof(t) || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != _typeof(i)) return i; throw new TypeError("@@toPrimitive must return a primitive value."); } return ("string" === r ? String : Number)(t); }
function _typeof(o) { "@babel/helpers - typeof"; return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) { return typeof o; } : function (o) { return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o; }, _typeof(o); }
// include: shell.js
// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(moduleArg) => Promise<Module>
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = typeof libopenmpt != "undefined" ? libopenmpt : {};

// See https://caniuse.com/mdn-javascript_builtins_object_assign
// include: polyfill/objassign.js
// Object.assign polyfill from:
// https://github.com/google/closure-compiler/blob/master/src/com/google/javascript/jscomp/js/es6/util/assign.js
if (typeof Object.assign == "undefined") {
  /**
   * Equivalent to the Object.assign() method, but guaranteed to be available for use in code
   * generated by the compiler.
   *
   * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign
   *
   * Copies values of all enumerable own properties from one or more
   * sources to the given target object, and returns the target.
   *
   * @final
   * @param {!Object} target The target object onto which to copy.
   * @param {...?Object} source The source objects.
   * @return {!Object} The target object is returned.
   * @suppress {visibility, duplicate, checkTypes}
   */
  Object.assign = function (target, source) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      if (!source) continue;
      for (var key in source) {
        if (source.hasOwnProperty(key)) target[key] = source[key];
      }
    }
    return target;
  };
}

// end include: polyfill/objassign.js
// See https://caniuse.com/fetch
// include: polyfill/fetch.js
// Fetch polyfill from https://github.com/developit/unfetch
// License:
//==============================================================================
// Copyright (c) 2017 Jason Miller
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//==============================================================================
if (typeof globalThis.fetch == "undefined") {
  globalThis.fetch = function (url, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      var request = new XMLHttpRequest();
      var _keys = [];
      var headers = {};
      request.responseType = "arraybuffer";
      var _response = function response() {
        return {
          ok: (request.status / 100 | 0) == 2,
          // 200-299
          statusText: request.statusText,
          status: request.status,
          url: request.responseURL,
          text: function text() {
            return Promise.resolve(request.responseText);
          },
          json: function json() {
            return Promise.resolve(request.responseText).then(JSON.parse);
          },
          blob: function blob() {
            return Promise.resolve(new Blob([request.response]));
          },
          arrayBuffer: function arrayBuffer() {
            return Promise.resolve(request.response);
          },
          clone: _response,
          headers: {
            keys: function keys() {
              return _keys;
            },
            entries: function entries() {
              return _keys.map(function (n) {
                return [n, request.getResponseHeader(n)];
              });
            },
            get: function get(n) {
              return request.getResponseHeader(n);
            },
            has: function has(n) {
              return request.getResponseHeader(n) != null;
            }
          }
        };
      };
      request.open(options.method || "get", url, true);
      request.onload = function () {
        request.getAllResponseHeaders().toLowerCase().replace(/^(.+?):/gm, function (m, key) {
          headers[key] || _keys.push(headers[key] = key);
        });
        resolve(_response());
      };
      request.onerror = reject;
      request.withCredentials = options.credentials == "include";
      for (var i in options.headers) {
        request.setRequestHeader(i, options.headers[i]);
      }
      request.send(options.body || null);
    });
  };
}

// end include: polyfill/fetch.js
// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).
// Attempt to auto-detect the environment
var ENVIRONMENT_IS_WEB = (typeof window === "undefined" ? "undefined" : _typeof(window)) == "object";
var ENVIRONMENT_IS_WORKER = typeof importScripts == "function";

// N.b. Electron.js environment is simultaneously a NODE-environment, but
// also a web environment.
var ENVIRONMENT_IS_NODE = (typeof process === "undefined" ? "undefined" : _typeof(process)) == "object" && _typeof(process.versions) == "object" && typeof process.versions.node == "string";
if (ENVIRONMENT_IS_NODE) {}

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)
// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = Object.assign({}, Module);
var arguments_ = [];
var thisProgram = "./this.program";
var quit_ = function quit_(status, toThrow) {
  throw toThrow;
};

// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = "";
function locateFile(path) {
  if (Module["locateFile"]) {
    return Module["locateFile"](path, scriptDirectory);
  }
  return scriptDirectory + path;
}

// Hooks that are implemented differently in different runtime environments.
var readAsync, readBinary;
if (ENVIRONMENT_IS_NODE) {
  // These modules will usually be used on Node.js. Load them eagerly to avoid
  // the complexity of lazy-loading.
  var fs = require("fs");
  var nodePath = require("path");
  scriptDirectory = __dirname + "/";
  // include: node_shell_read.js
  readBinary = function readBinary(filename) {
    // We need to re-wrap `file://` strings to URLs. Normalizing isn't
    // necessary in that case, the path should already be absolute.
    filename = isFileURI(filename) ? new URL(filename) : nodePath.normalize(filename);
    var ret = fs.readFileSync(filename);
    return ret;
  };
  readAsync = function readAsync(filename) {
    var binary = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;
    // See the comment in the `readBinary` function.
    filename = isFileURI(filename) ? new URL(filename) : nodePath.normalize(filename);
    return new Promise(function (resolve, reject) {
      fs.readFile(filename, binary ? undefined : "utf8", function (err, data) {
        if (err) reject(err);else resolve(binary ? data.buffer : data);
      });
    });
  };
  // end include: node_shell_read.js
  if (!Module["thisProgram"] && process.argv.length > 1) {
    thisProgram = process.argv[1].replace(/\\/g, "/");
  }
  arguments_ = process.argv.slice(2);
  if (typeof module != "undefined") {
    module["exports"] = Module;
  }
  // Without this older versions of node (< v15) will log unhandled rejections
  // but return 0, which is not normally the desired behaviour.  This is
  // not be needed with node v15 and about because it is now the default
  // behaviour:
  // See https://nodejs.org/api/cli.html#cli_unhandled_rejections_mode
  var nodeMajor = process.versions.node.split(".")[0];
  if (nodeMajor < 15) {
    process.on("unhandledRejection", function (reason) {
      throw reason;
    });
  }
  quit_ = function quit_(status, toThrow) {
    process.exitCode = status;
    throw toThrow;
  };
  // If target shell does not support Wasm, load the JS version of the code.
  if (typeof WebAssembly == "undefined") {
    eval(fs.readFileSync(locateFile("libopenmpt.wasm.js")) + "");
  }
} else
  // Note that this includes Node.js workers when relevant (pthreads is enabled).
  // Node.js workers are detected as a combination of ENVIRONMENT_IS_WORKER and
  // ENVIRONMENT_IS_NODE.
  if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
    if (ENVIRONMENT_IS_WORKER) {
      // Check worker, not web, since window could be polyfilled
      scriptDirectory = self.location.href;
    } else if (typeof document != "undefined" && document.currentScript) {
      // web
      scriptDirectory = document.currentScript.src;
    }
    // blob urls look like blob:http://site.com/etc/etc and we cannot infer anything from them.
    // otherwise, slice off the final part of the url to find the script directory.
    // if scriptDirectory does not contain a slash, lastIndexOf will return -1,
    // and scriptDirectory will correctly be replaced with an empty string.
    // If scriptDirectory contains a query (starting with ?) or a fragment (starting with #),
    // they are removed because they could contain a slash.
    if (scriptDirectory.startsWith("blob:")) {
      scriptDirectory = "";
    } else {
      scriptDirectory = scriptDirectory.substr(0, scriptDirectory.replace(/[?#].*/, "").lastIndexOf("/") + 1);
    }
    {
      // include: web_or_worker_shell_read.js
      if (ENVIRONMENT_IS_WORKER) {
        readBinary = function readBinary(url) {
          var xhr = new XMLHttpRequest();
          xhr.open("GET", url, false);
          xhr.responseType = "arraybuffer";
          xhr.send(null);
          return new Uint8Array(/** @type{!ArrayBuffer} */xhr.response);
        };
      }
      readAsync = function readAsync(url) {
        // Fetch has some additional restrictions over XHR, like it can't be used on a file:// url.
        // See https://github.com/github/fetch/pull/92#issuecomment-140665932
        // Cordova or Electron apps are typically loaded from a file:// url.
        // So use XHR on webview if URL is a file URL.
        if (isFileURI(url)) {
          return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, true);
            xhr.responseType = "arraybuffer";
            xhr.onload = function () {
              if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
                // file URLs can return 0
                resolve(xhr.response);
                return;
              }
              reject(xhr.status);
            };
            xhr.onerror = reject;
            xhr.send(null);
          });
        }
        return fetch(url, {
          credentials: "same-origin"
        }).then(function (response) {
          if (response.ok) {
            return response.arrayBuffer();
          }
          return Promise.reject(new Error(response.status + " : " + response.url));
        });
      };
    }
  } else
    // end include: web_or_worker_shell_read.js
    {}
var out = Module["print"] || console.log.bind(console);
var err = Module["printErr"] || console.error.bind(console);

// Merge back in the overrides
Object.assign(Module, moduleOverrides);

// Free the object hierarchy contained in the overrides, this lets the GC
// reclaim data used.
moduleOverrides = null;

// Emit code to handle expected values on the Module object. This applies Module.x
// to the proper local x. This has two benefits: first, we only emit it if it is
// expected to arrive, and second, by using a local everywhere else that can be
// minified.
if (Module["arguments"]) arguments_ = Module["arguments"];
if (Module["thisProgram"]) thisProgram = Module["thisProgram"];

// perform assertions in shell.js after we set up out() and err(), as otherwise if an assertion fails it cannot print the message
// end include: shell.js
// include: preamble.js
// === Preamble library stuff ===
// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html
var wasmBinary = Module["wasmBinary"];
if (WebAssembly.isWasm2js) {
  // We don't need to actually download a wasm binary, mark it as present but
  // empty.
  wasmBinary = [];
}

// Wasm globals
var wasmMemory;

//========================================
// Runtime essentials
//========================================
// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS;

// Memory management
var /** @type {!Int8Array} */HEAP8, /** @type {!Uint8Array} */HEAPU8, /** @type {!Int16Array} */HEAP16, /** @type {!Uint16Array} */HEAPU16, /** @type {!Int32Array} */HEAP32, /** @type {!Uint32Array} */HEAPU32, /** @type {!Float32Array} */HEAPF32, /** @type {!Float64Array} */HEAPF64;

// include: runtime_shared.js
function updateMemoryViews() {
  var b = wasmMemory.buffer;
  Module["HEAP8"] = HEAP8 = new Int8Array(b);
  Module["HEAP16"] = HEAP16 = new Int16Array(b);
  Module["HEAPU8"] = HEAPU8 = new Uint8Array(b);
  Module["HEAPU16"] = HEAPU16 = new Uint16Array(b);
  Module["HEAP32"] = HEAP32 = new Int32Array(b);
  Module["HEAPU32"] = HEAPU32 = new Uint32Array(b);
  Module["HEAPF32"] = HEAPF32 = new Float32Array(b);
  Module["HEAPF64"] = HEAPF64 = new Float64Array(b);
}

// end include: runtime_shared.js
// include: runtime_stack_check.js
// end include: runtime_stack_check.js
var __ATPRERUN__ = [];

// functions called before the runtime is initialized
var __ATINIT__ = [];

// functions called during shutdown
var __ATPOSTRUN__ = [];

// functions called after the main() is called
var runtimeInitialized = false;
function preRun() {
  if (Module["preRun"]) {
    if (typeof Module["preRun"] == "function") Module["preRun"] = [Module["preRun"]];
    while (Module["preRun"].length) {
      addOnPreRun(Module["preRun"].shift());
    }
  }
  callRuntimeCallbacks(__ATPRERUN__);
}
function initRuntime() {
  runtimeInitialized = true;
  if (!Module["noFSInit"] && !FS.initialized) FS.init();
  FS.ignorePermissions = false;
  TTY.init();
  callRuntimeCallbacks(__ATINIT__);
}
function postRun() {
  if (Module["postRun"]) {
    if (typeof Module["postRun"] == "function") Module["postRun"] = [Module["postRun"]];
    while (Module["postRun"].length) {
      addOnPostRun(Module["postRun"].shift());
    }
  }
  callRuntimeCallbacks(__ATPOSTRUN__);
}
function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}
function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}
function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}

// include: runtime_math.js
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/imul
// || MIN_NODE_VERSION < 0.12
// check for imul support, and also for correctness ( https://bugs.webkit.org/show_bug.cgi?id=126345 )
if (!Math.imul || Math.imul(4294967295, 5) !== -5) Math.imul = function (a, b) {
  var ah = a >>> 16;
  var al = a & 65535;
  var bh = b >>> 16;
  var bl = b & 65535;
  return al * bl + (ah * bl + al * bh << 16) | 0;
};

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/fround
if (!Math.fround) {
  var froundBuffer = new Float32Array(1);
  Math.fround = function (x) {
    froundBuffer[0] = x;
    return froundBuffer[0];
  };
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/clz32
Math.clz32 || (Math.clz32 = function (x) {
  var n = 32;
  var y = x >> 16;
  if (y) {
    n -= 16;
    x = y;
  }
  y = x >> 8;
  if (y) {
    n -= 8;
    x = y;
  }
  y = x >> 4;
  if (y) {
    n -= 4;
    x = y;
  }
  y = x >> 2;
  if (y) {
    n -= 2;
    x = y;
  }
  y = x >> 1;
  if (y) return n - 2;
  return n - x;
});

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/trunc
Math.trunc || (Math.trunc = function (x) {
  return x < 0 ? Math.ceil(x) : Math.floor(x);
});

// end include: runtime_math.js
// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// Module.preRun (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null;

// overridden to take different actions when all run dependencies are fulfilled
function getUniqueRunDependency(id) {
  return id;
}
function addRunDependency(id) {
  var _Module$monitorRunDep;
  runDependencies++;
  (_Module$monitorRunDep = Module["monitorRunDependencies"]) === null || _Module$monitorRunDep === void 0 || _Module$monitorRunDep.call(Module, runDependencies);
}
function removeRunDependency(id) {
  var _Module$monitorRunDep2;
  runDependencies--;
  (_Module$monitorRunDep2 = Module["monitorRunDependencies"]) === null || _Module$monitorRunDep2 === void 0 || _Module$monitorRunDep2.call(Module, runDependencies);
  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback();
    }
  }
}

/** @param {string|number=} what */
function abort(what) {
  var _Module$onAbort;
  (_Module$onAbort = Module["onAbort"]) === null || _Module$onAbort === void 0 || _Module$onAbort.call(Module, what);
  what = "Aborted(" + what + ")";
  // TODO(sbc): Should we remove printing and leave it up to whoever
  // catches the exception?
  err(what);
  ABORT = true;
  what += ". Build with -sASSERTIONS for more info.";
  // Use a wasm runtime error, because a JS error might be seen as a foreign
  // exception, which means we'd run destructors on it. We need the error to
  // simply make the program stop.
  // FIXME This approach does not work in Wasm EH because it currently does not assume
  // all RuntimeErrors are from traps; it decides whether a RuntimeError is from
  // a trap or not based on a hidden field within the object. So at the moment
  // we don't have a way of throwing a wasm trap from JS. TODO Make a JS API that
  // allows this in the wasm spec.
  // Suppress closure compiler warning here. Closure compiler's builtin extern
  // definition for WebAssembly.RuntimeError claims it takes no arguments even
  // though it can.
  // TODO(https://github.com/google/closure-compiler/pull/3913): Remove if/when upstream closure gets fixed.
  /** @suppress {checkTypes} */
  var e = new WebAssembly.RuntimeError(what);
  // Throw the error whether or not MODULARIZE is set because abort is used
  // in code paths apart from instantiation where an exception is expected
  // to be thrown when abort is called.
  throw e;
}

// include: memoryprofiler.js
// end include: memoryprofiler.js
// include: URIUtils.js
// Prefix of data URIs emitted by SINGLE_FILE and related options.
var dataURIPrefix = "data:application/octet-stream;base64,";

/**
 * Indicates whether filename is a base64 data URI.
 * @noinline
 */
var isDataURI = function isDataURI(filename) {
  return filename.startsWith(dataURIPrefix);
};

/**
 * Indicates whether filename is delivered via file protocol (as opposed to http/https)
 * @noinline
 */
var isFileURI = function isFileURI(filename) {
  return filename.startsWith("file://");
};

// end include: URIUtils.js
// include: runtime_exceptions.js
// end include: runtime_exceptions.js
function findWasmBinary() {
  var f = "libopenmpt.wasm";
  if (!isDataURI(f)) {
    return locateFile(f);
  }
  return f;
}
var wasmBinaryFile;
function getBinarySync(file) {
  if (file == wasmBinaryFile && wasmBinary) {
    return new Uint8Array(wasmBinary);
  }
  if (readBinary) {
    return readBinary(file);
  }
  throw "both async and sync fetching of the wasm failed";
}
function getBinaryPromise(binaryFile) {
  // If we don't have the binary yet, load it asynchronously using readAsync.
  if (!wasmBinary) {
    // Fetch the binary using readAsync
    return readAsync(binaryFile).then(function (response) {
      return new Uint8Array(/** @type{!ArrayBuffer} */response);
    },
    // Fall back to getBinarySync if readAsync fails
    function () {
      return getBinarySync(binaryFile);
    });
  }
  // Otherwise, getBinarySync should be able to get it synchronously
  return Promise.resolve().then(function () {
    return getBinarySync(binaryFile);
  });
}
function instantiateArrayBuffer(binaryFile, imports, receiver) {
  return getBinaryPromise(binaryFile).then(function (binary) {
    return WebAssembly.instantiate(binary, imports);
  }).then(receiver, function (reason) {
    err("failed to asynchronously prepare wasm: ".concat(reason));
    if (typeof location != "undefined") {
      // WebAssembly compilation failed, try running the JS fallback instead.
      var search = location.search;
      if (search.indexOf("_rwasm=0") < 0) {
        location.href += (search ? search + "&" : "?") + "_rwasm=0";
        // Return here to avoid calling abort() below.  The application
        // still has a chance to start successfully do we don't want to
        // trigger onAbort or onExit handlers.
        return;
      }
    }
    abort(reason);
  });
}
function instantiateAsync(binary, binaryFile, imports, callback) {
  if (!binary && typeof WebAssembly.instantiateStreaming == "function" && !isDataURI(binaryFile) &&
  // Don't use streaming for file:// delivered objects in a webview, fetch them synchronously.
  !isFileURI(binaryFile) &&
  // Avoid instantiateStreaming() on Node.js environment for now, as while
  // Node.js v18.1.0 implements it, it does not have a full fetch()
  // implementation yet.
  // Reference:
  //   https://github.com/emscripten-core/emscripten/pull/16917
  !ENVIRONMENT_IS_NODE && typeof fetch == "function") {
    return fetch(binaryFile, {
      credentials: "same-origin"
    }).then(function (response) {
      // Suppress closure warning here since the upstream definition for
      // instantiateStreaming only allows Promise<Repsponse> rather than
      // an actual Response.
      // TODO(https://github.com/google/closure-compiler/pull/3913): Remove if/when upstream closure is fixed.
      /** @suppress {checkTypes} */
      var result = WebAssembly.instantiateStreaming(response, imports);
      return result.then(callback, function (reason) {
        // We expect the most common failure cause to be a bad MIME type for the binary,
        // in which case falling back to ArrayBuffer instantiation should work.
        err("wasm streaming compile failed: ".concat(reason));
        err("falling back to ArrayBuffer instantiation");
        return instantiateArrayBuffer(binaryFile, imports, callback);
      });
    });
  }
  return instantiateArrayBuffer(binaryFile, imports, callback);
}
function getWasmImports() {
  // prepare imports
  return {
    "a": wasmImports
  };
}

// Create the wasm instance.
// Receives the wasm imports, returns the exports.
function createWasm() {
  var info = getWasmImports();
  // Load the wasm module and create an instance of using native support in the JS engine.
  // handle a generated wasm instance, receiving its exports and
  // performing other necessary setup
  /** @param {WebAssembly.Module=} module*/
  function receiveInstance(instance, module) {
    wasmExports = instance.exports;
    wasmMemory = wasmExports["wa"];
    updateMemoryViews();
    wasmTable = wasmExports["$e"];
    addOnInit(wasmExports["xa"]);
    removeRunDependency("wasm-instantiate");
    return wasmExports;
  }
  // wait for the pthread pool (if any)
  addRunDependency("wasm-instantiate");
  // Prefer streaming instantiation if available.
  function receiveInstantiationResult(result) {
    // 'result' is a ResultObject object which has both the module and instance.
    // receiveInstance() will swap in the exports (to Module.asm) so they can be called
    // TODO: Due to Closure regression https://github.com/google/closure-compiler/issues/3193, the above line no longer optimizes out down to the following line.
    // When the regression is fixed, can restore the above PTHREADS-enabled path.
    receiveInstance(result["instance"]);
  }
  // User shell pages can write their own Module.instantiateWasm = function(imports, successCallback) callback
  // to manually instantiate the Wasm module themselves. This allows pages to
  // run the instantiation parallel to any other async startup actions they are
  // performing.
  // Also pthreads and wasm workers initialize the wasm instance through this
  // path.
  if (Module["instantiateWasm"]) {
    try {
      return Module["instantiateWasm"](info, receiveInstance);
    } catch (e) {
      err("Module.instantiateWasm callback failed with error: ".concat(e));
      return false;
    }
  }
  if (!wasmBinaryFile) wasmBinaryFile = findWasmBinary();
  instantiateAsync(wasmBinary, wasmBinaryFile, info, receiveInstantiationResult);
  return {};
}

// Globals used by JS i64 conversions (see makeSetValue)
var tempDouble;
var tempI64;

// include: runtime_debug.js
// end include: runtime_debug.js
// === Body ===
// end include: preamble.js
/** @constructor */
function ExitStatus(status) {
  this.name = "ExitStatus";
  this.message = "Program terminated with exit(".concat(status, ")");
  this.status = status;
}
var callRuntimeCallbacks = function callRuntimeCallbacks(callbacks) {
  while (callbacks.length > 0) {
    // Pass the module as the first argument.
    callbacks.shift()(Module);
  }
};
var noExitRuntime = Module["noExitRuntime"] || true;
var stackRestore = function stackRestore(val) {
  return _emscripten_stack_restore(val);
};
var stackSave = function stackSave() {
  return _emscripten_stack_get_current2();
};
var UTF8Decoder = typeof TextDecoder != "undefined" ? new TextDecoder() : undefined;

/**
     * Given a pointer 'idx' to a null-terminated UTF8-encoded string in the given
     * array that contains uint8 values, returns a copy of that string as a
     * Javascript String object.
     * heapOrArray is either a regular array, or a JavaScript typed array view.
     * @param {number} idx
     * @param {number=} maxBytesToRead
     * @return {string}
     */
var UTF8ArrayToString = function UTF8ArrayToString(heapOrArray, idx, maxBytesToRead) {
  var endIdx = idx + maxBytesToRead;
  var endPtr = idx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on
  // null terminator by itself.  Also, use the length info to avoid running tiny
  // strings through TextDecoder, since .subarray() allocates garbage.
  // (As a tiny code save trick, compare endPtr against endIdx using a negation,
  // so that undefined means Infinity)
  while (heapOrArray[endPtr] && !(endPtr >= endIdx)) ++endPtr;
  if (endPtr - idx > 16 && heapOrArray.buffer && UTF8Decoder) {
    return UTF8Decoder.decode(heapOrArray.subarray(idx, endPtr));
  }
  var str = "";
  // If building with TextDecoder, we have already computed the string length
  // above, so test loop end condition against that
  while (idx < endPtr) {
    // For UTF8 byte structure, see:
    // http://en.wikipedia.org/wiki/UTF-8#Description
    // https://www.ietf.org/rfc/rfc2279.txt
    // https://tools.ietf.org/html/rfc3629
    var u0 = heapOrArray[idx++];
    if (!(u0 & 128)) {
      str += String.fromCharCode(u0);
      continue;
    }
    var u1 = heapOrArray[idx++] & 63;
    if ((u0 & 224) == 192) {
      str += String.fromCharCode((u0 & 31) << 6 | u1);
      continue;
    }
    var u2 = heapOrArray[idx++] & 63;
    if ((u0 & 240) == 224) {
      u0 = (u0 & 15) << 12 | u1 << 6 | u2;
    } else {
      u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | heapOrArray[idx++] & 63;
    }
    if (u0 < 65536) {
      str += String.fromCharCode(u0);
    } else {
      var ch = u0 - 65536;
      str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
    }
  }
  return str;
};

/**
     * Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the
     * emscripten HEAP, returns a copy of that string as a Javascript String object.
     *
     * @param {number} ptr
     * @param {number=} maxBytesToRead - An optional length that specifies the
     *   maximum number of bytes to read. You can omit this parameter to scan the
     *   string until the first 0 byte. If maxBytesToRead is passed, and the string
     *   at [ptr, ptr+maxBytesToReadr[ contains a null byte in the middle, then the
     *   string will cut short at that byte index (i.e. maxBytesToRead will not
     *   produce a string of exact length [ptr, ptr+maxBytesToRead[) N.B. mixing
     *   frequent uses of UTF8ToString() with and without maxBytesToRead may throw
     *   JS JIT optimizations off, so it is worth to consider consistently using one
     * @return {string}
     */
var UTF8ToString = function UTF8ToString(ptr, maxBytesToRead) {
  return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : "";
};
var ___assert_fail = function ___assert_fail(condition, filename, line, func) {
  abort("Assertion failed: ".concat(UTF8ToString(condition), ", at: ") + [filename ? UTF8ToString(filename) : "unknown filename", line, func ? UTF8ToString(func) : "unknown function"]);
};
var exceptionCaught = [];
var uncaughtExceptionCount = 0;
var ___cxa_begin_catch = function ___cxa_begin_catch(ptr) {
  var info = new ExceptionInfo(ptr);
  if (!info.get_caught()) {
    info.set_caught(true);
    uncaughtExceptionCount--;
  }
  info.set_rethrown(false);
  exceptionCaught.push(info);
  _cxa_increment_exception_refcount(ptr);
  return _cxa_get_exception_ptr(ptr);
};
var exceptionLast = 0;
var ___cxa_end_catch = function ___cxa_end_catch() {
  // Clear state flag.
  _setThrew2(0, 0);
  // Call destructor if one is registered then clear it.
  var info = exceptionCaught.pop();
  _cxa_decrement_exception_refcount(info.excPtr);
  exceptionLast = 0;
};

// XXX in decRef?
var ExceptionInfo = /*#__PURE__*/function () {
  "use strict";

  // excPtr - Thrown object pointer to wrap. Metadata pointer is calculated from it.
  function ExceptionInfo(excPtr) {
    _classCallCheck(this, ExceptionInfo);
    this.excPtr = excPtr;
    this.ptr = excPtr - 24;
  }
  return _createClass(ExceptionInfo, [{
    key: "set_type",
    value: function set_type(type) {
      HEAPU32[this.ptr + 4 >> 2] = type;
    }
  }, {
    key: "get_type",
    value: function get_type() {
      return HEAPU32[this.ptr + 4 >> 2];
    }
  }, {
    key: "set_destructor",
    value: function set_destructor(destructor) {
      HEAPU32[this.ptr + 8 >> 2] = destructor;
    }
  }, {
    key: "get_destructor",
    value: function get_destructor() {
      return HEAPU32[this.ptr + 8 >> 2];
    }
  }, {
    key: "set_caught",
    value: function set_caught(caught) {
      caught = caught ? 1 : 0;
      HEAP8[this.ptr + 12] = caught;
    }
  }, {
    key: "get_caught",
    value: function get_caught() {
      return HEAP8[this.ptr + 12] != 0;
    }
  }, {
    key: "set_rethrown",
    value: function set_rethrown(rethrown) {
      rethrown = rethrown ? 1 : 0;
      HEAP8[this.ptr + 13] = rethrown;
    }
  }, {
    key: "get_rethrown",
    value: function get_rethrown() {
      return HEAP8[this.ptr + 13] != 0;
    }
    // Initialize native structure fields. Should be called once after allocated.
  }, {
    key: "init",
    value: function init(type, destructor) {
      this.set_adjusted_ptr(0);
      this.set_type(type);
      this.set_destructor(destructor);
    }
  }, {
    key: "set_adjusted_ptr",
    value: function set_adjusted_ptr(adjustedPtr) {
      HEAPU32[this.ptr + 16 >> 2] = adjustedPtr;
    }
  }, {
    key: "get_adjusted_ptr",
    value: function get_adjusted_ptr() {
      return HEAPU32[this.ptr + 16 >> 2];
    }
  }]);
}();
var ___resumeException = function ___resumeException(ptr) {
  if (!exceptionLast) {
    exceptionLast = ptr;
  }
  throw exceptionLast;
};
var setTempRet0 = function setTempRet0(val) {
  return _emscripten_tempret_set(val);
};
var findMatchingCatch = function findMatchingCatch(args) {
  var thrown = exceptionLast;
  if (!thrown) {
    // just pass through the null ptr
    setTempRet0(0);
    return 0;
  }
  var info = new ExceptionInfo(thrown);
  info.set_adjusted_ptr(thrown);
  var thrownType = info.get_type();
  if (!thrownType) {
    // just pass through the thrown ptr
    setTempRet0(0);
    return thrown;
  }
  // can_catch receives a **, add indirection
  // The different catch blocks are denoted by different types.
  // Due to inheritance, those types may not precisely match the
  // type of the thrown object. Find one which matches, and
  // return the type of the catch block which should be called.
  var _iterator = _createForOfIteratorHelper(args),
    _step;
  try {
    for (_iterator.s(); !(_step = _iterator.n()).done;) {
      var caughtType = _step.value;
      if (caughtType === 0 || caughtType === thrownType) {
        // Catch all clause matched or exactly the same type is caught
        break;
      }
      var adjusted_ptr_addr = info.ptr + 16;
      if (_cxa_can_catch(caughtType, thrownType, adjusted_ptr_addr)) {
        setTempRet0(caughtType);
        return thrown;
      }
    }
  } catch (err) {
    _iterator.e(err);
  } finally {
    _iterator.f();
  }
  setTempRet0(thrownType);
  return thrown;
};
var ___cxa_find_matching_catch_17 = function ___cxa_find_matching_catch_17(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10, arg11, arg12, arg13, arg14) {
  return findMatchingCatch([arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9, arg10, arg11, arg12, arg13, arg14]);
};
var ___cxa_find_matching_catch_2 = function ___cxa_find_matching_catch_2() {
  return findMatchingCatch([]);
};
var ___cxa_find_matching_catch_3 = function ___cxa_find_matching_catch_3(arg0) {
  return findMatchingCatch([arg0]);
};
var ___cxa_find_matching_catch_4 = function ___cxa_find_matching_catch_4(arg0, arg1) {
  return findMatchingCatch([arg0, arg1]);
};
var ___cxa_find_matching_catch_6 = function ___cxa_find_matching_catch_6(arg0, arg1, arg2, arg3) {
  return findMatchingCatch([arg0, arg1, arg2, arg3]);
};
var ___cxa_rethrow = function ___cxa_rethrow() {
  var info = exceptionCaught.pop();
  if (!info) {
    abort("no exception to throw");
  }
  var ptr = info.excPtr;
  if (!info.get_rethrown()) {
    // Only pop if the corresponding push was through rethrow_primary_exception
    exceptionCaught.push(info);
    info.set_rethrown(true);
    info.set_caught(false);
    uncaughtExceptionCount++;
  }
  exceptionLast = ptr;
  throw exceptionLast;
};
var ___cxa_throw = function ___cxa_throw(ptr, type, destructor) {
  var info = new ExceptionInfo(ptr);
  // Initialize ExceptionInfo content after it was allocated in __cxa_allocate_exception.
  info.init(type, destructor);
  exceptionLast = ptr;
  uncaughtExceptionCount++;
  throw exceptionLast;
};
var ___cxa_uncaught_exceptions = function ___cxa_uncaught_exceptions() {
  return uncaughtExceptionCount;
};
var __abort_js = function __abort_js() {
  abort("");
};
var nowIsMonotonic = (typeof performance === "undefined" ? "undefined" : _typeof(performance)) == "object" && performance && typeof performance["now"] == "function" || ENVIRONMENT_IS_NODE;
var __emscripten_get_now_is_monotonic = function __emscripten_get_now_is_monotonic() {
  return nowIsMonotonic;
};
var __emscripten_runtime_keepalive_clear = function __emscripten_runtime_keepalive_clear() {
  noExitRuntime = false;
  runtimeKeepaliveCounter = 0;
};
var timers = {};
var handleException = function handleException(e) {
  // Certain exception types we do not treat as errors since they are used for
  // internal control flow.
  // 1. ExitStatus, which is thrown by exit()
  // 2. "unwind", which is thrown by emscripten_unwind_to_js_event_loop() and others
  //    that wish to return to JS event loop.
  if (e instanceof ExitStatus || e == "unwind") {
    return EXITSTATUS;
  }
  quit_(1, e);
};
var runtimeKeepaliveCounter = 0;
var keepRuntimeAlive = function keepRuntimeAlive() {
  return noExitRuntime || runtimeKeepaliveCounter > 0;
};
var _proc_exit = function _proc_exit(code) {
  EXITSTATUS = code;
  if (!keepRuntimeAlive()) {
    var _Module$onExit;
    (_Module$onExit = Module["onExit"]) === null || _Module$onExit === void 0 || _Module$onExit.call(Module, code);
    ABORT = true;
  }
  quit_(code, new ExitStatus(code));
};

/** @suppress {duplicate } */ /** @param {boolean|number=} implicit */
var exitJS = function exitJS(status, implicit) {
  EXITSTATUS = status;
  _proc_exit(status);
};
var _exit = exitJS;
var maybeExit = function maybeExit() {
  if (!keepRuntimeAlive()) {
    try {
      _exit(EXITSTATUS);
    } catch (e) {
      handleException(e);
    }
  }
};
var callUserCallback = function callUserCallback(func) {
  if (ABORT) {
    return;
  }
  try {
    func();
    maybeExit();
  } catch (e) {
    handleException(e);
  }
};
var _emscripten_get_now;

// The performance global was added to node in v16.0.0:
// https://nodejs.org/api/globals.html#performance
if (ENVIRONMENT_IS_NODE) {
  global.performance = require("perf_hooks").performance;
}

// AudioWorkletGlobalScope does not have performance.now()
// (https://github.com/WebAudio/web-audio-api/issues/2527), so if building
// with
// Audio Worklets enabled, do a dynamic check for its presence.
if (typeof performance != "undefined" && performance.now) {
  _emscripten_get_now = function _emscripten_get_now() {
    return performance.now();
  };
} else {
  _emscripten_get_now = Date.now;
}
var __setitimer_js = function __setitimer_js(which, timeout_ms) {
  // First, clear any existing timer.
  if (timers[which]) {
    clearTimeout(timers[which].id);
    delete timers[which];
  }
  // A timeout of zero simply cancels the current timeout so we have nothing
  // more to do.
  if (!timeout_ms) return 0;
  var id = setTimeout(function () {
    delete timers[which];
    callUserCallback(function () {
      return _emscripten_timeout(which, _emscripten_get_now());
    });
  }, timeout_ms);
  timers[which] = {
    id: id,
    timeout_ms: timeout_ms
  };
  return 0;
};
var stringToUTF8Array = function stringToUTF8Array(str, heap, outIdx, maxBytesToWrite) {
  // Parameter maxBytesToWrite is not optional. Negative values, 0, null,
  // undefined and false each don't write out any bytes.
  if (!(maxBytesToWrite > 0)) return 0;
  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1;
  // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code
    // unit, not a Unicode code point of the character! So decode
    // UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description
    // and https://www.ietf.org/rfc/rfc2279.txt
    // and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i);
    // possibly a lead surrogate
    if (u >= 55296 && u <= 57343) {
      var u1 = str.charCodeAt(++i);
      u = 65536 + ((u & 1023) << 10) | u1 & 1023;
    }
    if (u <= 127) {
      if (outIdx >= endIdx) break;
      heap[outIdx++] = u;
    } else if (u <= 2047) {
      if (outIdx + 1 >= endIdx) break;
      heap[outIdx++] = 192 | u >> 6;
      heap[outIdx++] = 128 | u & 63;
    } else if (u <= 65535) {
      if (outIdx + 2 >= endIdx) break;
      heap[outIdx++] = 224 | u >> 12;
      heap[outIdx++] = 128 | u >> 6 & 63;
      heap[outIdx++] = 128 | u & 63;
    } else {
      if (outIdx + 3 >= endIdx) break;
      heap[outIdx++] = 240 | u >> 18;
      heap[outIdx++] = 128 | u >> 12 & 63;
      heap[outIdx++] = 128 | u >> 6 & 63;
      heap[outIdx++] = 128 | u & 63;
    }
  }
  // Null-terminate the pointer to the buffer.
  heap[outIdx] = 0;
  return outIdx - startIdx;
};
var stringToUTF8 = function stringToUTF8(str, outPtr, maxBytesToWrite) {
  return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
};
var __tzset_js = function __tzset_js(timezone, daylight, std_name, dst_name) {
  // TODO: Use (malleable) environment variables instead of system settings.
  var currentYear = new Date().getFullYear();
  var winter = new Date(currentYear, 0, 1);
  var summer = new Date(currentYear, 6, 1);
  var winterOffset = winter.getTimezoneOffset();
  var summerOffset = summer.getTimezoneOffset();
  // Local standard timezone offset. Local standard time is not adjusted for
  // daylight savings.  This code uses the fact that getTimezoneOffset returns
  // a greater value during Standard Time versus Daylight Saving Time (DST).
  // Thus it determines the expected output during Standard Time, and it
  // compares whether the output of the given date the same (Standard) or less
  // (DST).
  var stdTimezoneOffset = Math.max(winterOffset, summerOffset);
  // timezone is specified as seconds west of UTC ("The external variable
  // `timezone` shall be set to the difference, in seconds, between
  // Coordinated Universal Time (UTC) and local standard time."), the same
  // as returned by stdTimezoneOffset.
  // See http://pubs.opengroup.org/onlinepubs/009695399/functions/tzset.html
  HEAPU32[timezone >> 2] = stdTimezoneOffset * 60;
  HEAP32[daylight >> 2] = Number(winterOffset != summerOffset);
  var extractZone = function extractZone(timezoneOffset) {
    // Why inverse sign?
    // Read here https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/getTimezoneOffset
    var sign = timezoneOffset >= 0 ? "-" : "+";
    var absOffset = Math.abs(timezoneOffset);
    var hours = String(Math.floor(absOffset / 60)).padStart(2, "0");
    var minutes = String(absOffset % 60).padStart(2, "0");
    return "UTC".concat(sign).concat(hours).concat(minutes);
  };
  var winterName = extractZone(winterOffset);
  var summerName = extractZone(summerOffset);
  if (summerOffset < winterOffset) {
    // Northern hemisphere
    stringToUTF8(winterName, std_name, 17);
    stringToUTF8(summerName, dst_name, 17);
  } else {
    stringToUTF8(winterName, dst_name, 17);
    stringToUTF8(summerName, std_name, 17);
  }
};
var _emscripten_date_now = function _emscripten_date_now() {
  return Date.now();
};
var getHeapMax = function getHeapMax() {
  return (
    // Stay one Wasm page short of 4GB: while e.g. Chrome is able to allocate
    // full 4GB Wasm memories, the size will wrap back to 0 bytes in Wasm side
    // for any code that deals with heap sizes, which would require special
    // casing all heap size related code to treat 0 specially.
    2147483648
  );
};
var alignMemory = function alignMemory(size, alignment) {
  return Math.ceil(size / alignment) * alignment;
};
var growMemory = function growMemory(size) {
  var b = wasmMemory.buffer;
  var pages = (size - b.byteLength + 65535) / 65536;
  try {
    // round size grow request up to wasm page size (fixed 64KB per spec)
    wasmMemory.grow(pages);
    // .grow() takes a delta compared to the previous size
    updateMemoryViews();
    return 1;
  } /*success*/ catch (e) {}
};

// implicit 0 return to save code size (caller will cast "undefined" into 0
// anyhow)
var _emscripten_resize_heap = function _emscripten_resize_heap(requestedSize) {
  var oldSize = HEAPU8.length;
  // With CAN_ADDRESS_2GB or MEMORY64, pointers are already unsigned.
  requestedSize >>>= 0;
  // With multithreaded builds, races can happen (another thread might increase the size
  // in between), so return a failure, and let the caller retry.
  // Memory resize rules:
  // 1.  Always increase heap size to at least the requested size, rounded up
  //     to next page multiple.
  // 2a. If MEMORY_GROWTH_LINEAR_STEP == -1, excessively resize the heap
  //     geometrically: increase the heap size according to
  //     MEMORY_GROWTH_GEOMETRIC_STEP factor (default +20%), At most
  //     overreserve by MEMORY_GROWTH_GEOMETRIC_CAP bytes (default 96MB).
  // 2b. If MEMORY_GROWTH_LINEAR_STEP != -1, excessively resize the heap
  //     linearly: increase the heap size by at least
  //     MEMORY_GROWTH_LINEAR_STEP bytes.
  // 3.  Max size for the heap is capped at 2048MB-WASM_PAGE_SIZE, or by
  //     MAXIMUM_MEMORY, or by ASAN limit, depending on which is smallest
  // 4.  If we were unable to allocate as much memory, it may be due to
  //     over-eager decision to excessively reserve due to (3) above.
  //     Hence if an allocation fails, cut down on the amount of excess
  //     growth, in an attempt to succeed to perform a smaller allocation.
  // A limit is set for how much we can grow. We should not exceed that
  // (the wasm binary specifies it, so if we tried, we'd fail anyhow).
  var maxHeapSize = getHeapMax();
  if (requestedSize > maxHeapSize) {
    return false;
  }
  // Loop through potential heap size increases. If we attempt a too eager
  // reservation that fails, cut down on the attempted size and reserve a
  // smaller bump instead. (max 3 times, chosen somewhat arbitrarily)
  for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
    var overGrownHeapSize = oldSize * (1 + .2 / cutDown);
    // ensure geometric growth
    // but limit overreserving (default to capping at +96MB overgrowth at most)
    overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
    var newSize = Math.min(maxHeapSize, alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536));
    var replacement = growMemory(newSize);
    if (replacement) {
      return true;
    }
  }
  return false;
};
var ENV = {};
var getExecutableName = function getExecutableName() {
  return thisProgram || "./this.program";
};
var _getEnvStrings = function getEnvStrings() {
  if (!_getEnvStrings.strings) {
    // Default values.
    // Browser language detection #8751
    var lang = ((typeof navigator === "undefined" ? "undefined" : _typeof(navigator)) == "object" && navigator.languages && navigator.languages[0] || "C").replace("-", "_") + ".UTF-8";
    var env = {
      "USER": "web_user",
      "LOGNAME": "web_user",
      "PATH": "/",
      "PWD": "/",
      "HOME": "/home/web_user",
      "LANG": lang,
      "_": getExecutableName()
    };
    // Apply the user-provided values, if any.
    for (var x in ENV) {
      // x is a key in ENV; if ENV[x] is undefined, that means it was
      // explicitly set to be so. We allow user code to do that to
      // force variables with default values to remain unset.
      if (ENV[x] === undefined) delete env[x];else env[x] = ENV[x];
    }
    var strings = [];
    for (var x in env) {
      strings.push("".concat(x, "=").concat(env[x]));
    }
    _getEnvStrings.strings = strings;
  }
  return _getEnvStrings.strings;
};
var stringToAscii = function stringToAscii(str, buffer) {
  for (var i = 0; i < str.length; ++i) {
    HEAP8[buffer++] = str.charCodeAt(i);
  }
  // Null-terminate the string
  HEAP8[buffer] = 0;
};
var _environ_get = function _environ_get(__environ, environ_buf) {
  var bufSize = 0;
  _getEnvStrings().forEach(function (string, i) {
    var ptr = environ_buf + bufSize;
    HEAPU32[__environ + i * 4 >> 2] = ptr;
    stringToAscii(string, ptr);
    bufSize += string.length + 1;
  });
  return 0;
};
var _environ_sizes_get = function _environ_sizes_get(penviron_count, penviron_buf_size) {
  var strings = _getEnvStrings();
  HEAPU32[penviron_count >> 2] = strings.length;
  var bufSize = 0;
  strings.forEach(function (string) {
    return bufSize += string.length + 1;
  });
  HEAPU32[penviron_buf_size >> 2] = bufSize;
  return 0;
};
var PATH = {
  isAbs: function isAbs(path) {
    return path.charAt(0) === "/";
  },
  splitPath: function splitPath(filename) {
    var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
    return splitPathRe.exec(filename).slice(1);
  },
  normalizeArray: function normalizeArray(parts, allowAboveRoot) {
    // if the path tries to go above the root, `up` ends up > 0
    var up = 0;
    for (var i = parts.length - 1; i >= 0; i--) {
      var last = parts[i];
      if (last === ".") {
        parts.splice(i, 1);
      } else if (last === "..") {
        parts.splice(i, 1);
        up++;
      } else if (up) {
        parts.splice(i, 1);
        up--;
      }
    }
    // if the path is allowed to go above the root, restore leading ..s
    if (allowAboveRoot) {
      for (; up; up--) {
        parts.unshift("..");
      }
    }
    return parts;
  },
  normalize: function normalize(path) {
    var isAbsolute = PATH.isAbs(path),
      trailingSlash = path.substr(-1) === "/";
    // Normalize the path
    path = PATH.normalizeArray(path.split("/").filter(function (p) {
      return !!p;
    }), !isAbsolute).join("/");
    if (!path && !isAbsolute) {
      path = ".";
    }
    if (path && trailingSlash) {
      path += "/";
    }
    return (isAbsolute ? "/" : "") + path;
  },
  dirname: function dirname(path) {
    var result = PATH.splitPath(path),
      root = result[0],
      dir = result[1];
    if (!root && !dir) {
      // No dirname whatsoever
      return ".";
    }
    if (dir) {
      // It has a dirname, strip trailing slash
      dir = dir.substr(0, dir.length - 1);
    }
    return root + dir;
  },
  basename: function basename(path) {
    // EMSCRIPTEN return '/'' for '/', not an empty string
    if (path === "/") return "/";
    path = PATH.normalize(path);
    path = path.replace(/\/$/, "");
    var lastSlash = path.lastIndexOf("/");
    if (lastSlash === -1) return path;
    return path.substr(lastSlash + 1);
  },
  join: function join() {
    for (var _len = arguments.length, paths = new Array(_len), _key = 0; _key < _len; _key++) {
      paths[_key] = arguments[_key];
    }
    return PATH.normalize(paths.join("/"));
  },
  join2: function join2(l, r) {
    return PATH.normalize(l + "/" + r);
  }
};
var initRandomFill = function initRandomFill() {
  if ((typeof crypto === "undefined" ? "undefined" : _typeof(crypto)) == "object" && typeof crypto["getRandomValues"] == "function") {
    // for modern web browsers
    return function (view) {
      return crypto.getRandomValues(view);
    };
  } else if (ENVIRONMENT_IS_NODE) {
    // for nodejs with or without crypto support included
    try {
      var crypto_module = require("crypto");
      var randomFillSync = crypto_module["randomFillSync"];
      if (randomFillSync) {
        // nodejs with LTS crypto support
        return function (view) {
          return crypto_module["randomFillSync"](view);
        };
      }
      // very old nodejs with the original crypto API
      var randomBytes = crypto_module["randomBytes"];
      return function (view) {
        return view.set(randomBytes(view.byteLength)),
        // Return the original view to match modern native implementations.
        view;
      };
    } catch (e) {}
  }
  // we couldn't find a proper implementation, as Math.random() is not suitable for /dev/random, see emscripten-core/emscripten/pull/7096
  abort("initRandomDevice");
};
var _randomFill = function randomFill(view) {
  return (_randomFill = initRandomFill())(view);
};
var PATH_FS = {
  resolve: function resolve() {
    var resolvedPath = "",
      resolvedAbsolute = false;
    for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
      var path = i >= 0 ? i < 0 || arguments.length <= i ? undefined : arguments[i] : FS.cwd();
      // Skip empty and invalid entries
      if (typeof path != "string") {
        throw new TypeError("Arguments to path.resolve must be strings");
      } else if (!path) {
        return "";
      }
      // an invalid portion invalidates the whole thing
      resolvedPath = path + "/" + resolvedPath;
      resolvedAbsolute = PATH.isAbs(path);
    }
    // At this point the path should be resolved to a full absolute path, but
    // handle relative paths to be safe (might happen when process.cwd() fails)
    resolvedPath = PATH.normalizeArray(resolvedPath.split("/").filter(function (p) {
      return !!p;
    }), !resolvedAbsolute).join("/");
    return (resolvedAbsolute ? "/" : "") + resolvedPath || ".";
  },
  relative: function relative(from, to) {
    from = PATH_FS.resolve(from).substr(1);
    to = PATH_FS.resolve(to).substr(1);
    function trim(arr) {
      var start = 0;
      for (; start < arr.length; start++) {
        if (arr[start] !== "") break;
      }
      var end = arr.length - 1;
      for (; end >= 0; end--) {
        if (arr[end] !== "") break;
      }
      if (start > end) return [];
      return arr.slice(start, end - start + 1);
    }
    var fromParts = trim(from.split("/"));
    var toParts = trim(to.split("/"));
    var length = Math.min(fromParts.length, toParts.length);
    var samePartsLength = length;
    for (var i = 0; i < length; i++) {
      if (fromParts[i] !== toParts[i]) {
        samePartsLength = i;
        break;
      }
    }
    var outputParts = [];
    for (var i = samePartsLength; i < fromParts.length; i++) {
      outputParts.push("..");
    }
    outputParts = outputParts.concat(toParts.slice(samePartsLength));
    return outputParts.join("/");
  }
};
var FS_stdin_getChar_buffer = [];
var lengthBytesUTF8 = function lengthBytesUTF8(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code
    // unit, not a Unicode code point of the character! So decode
    // UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var c = str.charCodeAt(i);
    // possibly a lead surrogate
    if (c <= 127) {
      len++;
    } else if (c <= 2047) {
      len += 2;
    } else if (c >= 55296 && c <= 57343) {
      len += 4;
      ++i;
    } else {
      len += 3;
    }
  }
  return len;
};

/** @type {function(string, boolean=, number=)} */
function intArrayFromString(stringy, dontAddNull, length) {
  var len = length > 0 ? length : lengthBytesUTF8(stringy) + 1;
  var u8array = new Array(len);
  var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
  if (dontAddNull) u8array.length = numBytesWritten;
  return u8array;
}
var FS_stdin_getChar = function FS_stdin_getChar() {
  if (!FS_stdin_getChar_buffer.length) {
    var result = null;
    if (ENVIRONMENT_IS_NODE) {
      // we will read data by chunks of BUFSIZE
      var BUFSIZE = 256;
      var buf = Buffer.alloc(BUFSIZE);
      var bytesRead = 0;
      // For some reason we must suppress a closure warning here, even though
      // fd definitely exists on process.stdin, and is even the proper way to
      // get the fd of stdin,
      // https://github.com/nodejs/help/issues/2136#issuecomment-523649904
      // This started to happen after moving this logic out of library_tty.js,
      // so it is related to the surrounding code in some unclear manner.
      /** @suppress {missingProperties} */
      var fd = process.stdin.fd;
      try {
        bytesRead = fs.readSync(fd, buf, 0, BUFSIZE);
      } catch (e) {
        // Cross-platform differences: on Windows, reading EOF throws an
        // exception, but on other OSes, reading EOF returns 0. Uniformize
        // behavior by treating the EOF exception to return 0.
        if (e.toString().includes("EOF")) bytesRead = 0;else throw e;
      }
      if (bytesRead > 0) {
        result = buf.slice(0, bytesRead).toString("utf-8");
      }
    } else if (typeof window != "undefined" && typeof window.prompt == "function") {
      // Browser.
      result = window.prompt("Input: ");
      // returns null on cancel
      if (result !== null) {
        result += "\n";
      }
    } else {}
    if (!result) {
      return null;
    }
    FS_stdin_getChar_buffer = intArrayFromString(result, true);
  }
  return FS_stdin_getChar_buffer.shift();
};
var TTY = {
  ttys: [],
  init: function init() {},
  // https://github.com/emscripten-core/emscripten/pull/1555
  // if (ENVIRONMENT_IS_NODE) {
  //   // currently, FS.init does not distinguish if process.stdin is a file or TTY
  //   // device, it always assumes it's a TTY device. because of this, we're forcing
  //   // process.stdin to UTF8 encoding to at least make stdin reading compatible
  //   // with text files until FS.init can be refactored.
  //   process.stdin.setEncoding('utf8');
  // }
  shutdown: function shutdown() {},
  // https://github.com/emscripten-core/emscripten/pull/1555
  // if (ENVIRONMENT_IS_NODE) {
  //   // inolen: any idea as to why node -e 'process.stdin.read()' wouldn't exit immediately (with process.stdin being a tty)?
  //   // isaacs: because now it's reading from the stream, you've expressed interest in it, so that read() kicks off a _read() which creates a ReadReq operation
  //   // inolen: I thought read() in that case was a synchronous operation that just grabbed some amount of buffered data if it exists?
  //   // isaacs: it is. but it also triggers a _read() call, which calls readStart() on the handle
  //   // isaacs: do process.stdin.pause() and i'd think it'd probably close the pending call
  //   process.stdin.pause();
  // }
  register: function register(dev, ops) {
    TTY.ttys[dev] = {
      input: [],
      output: [],
      ops: ops
    };
    FS.registerDevice(dev, TTY.stream_ops);
  },
  stream_ops: {
    open: function open(stream) {
      var tty = TTY.ttys[stream.node.rdev];
      if (!tty) {
        throw new FS.ErrnoError(43);
      }
      stream.tty = tty;
      stream.seekable = false;
    },
    close: function close(stream) {
      // flush any pending line data
      stream.tty.ops.fsync(stream.tty);
    },
    fsync: function fsync(stream) {
      stream.tty.ops.fsync(stream.tty);
    },
    read: function read(stream, buffer, offset, length, pos) {
      /* ignored */if (!stream.tty || !stream.tty.ops.get_char) {
        throw new FS.ErrnoError(60);
      }
      var bytesRead = 0;
      for (var i = 0; i < length; i++) {
        var result;
        try {
          result = stream.tty.ops.get_char(stream.tty);
        } catch (e) {
          throw new FS.ErrnoError(29);
        }
        if (result === undefined && bytesRead === 0) {
          throw new FS.ErrnoError(6);
        }
        if (result === null || result === undefined) break;
        bytesRead++;
        buffer[offset + i] = result;
      }
      if (bytesRead) {
        stream.node.timestamp = Date.now();
      }
      return bytesRead;
    },
    write: function write(stream, buffer, offset, length, pos) {
      if (!stream.tty || !stream.tty.ops.put_char) {
        throw new FS.ErrnoError(60);
      }
      try {
        for (var i = 0; i < length; i++) {
          stream.tty.ops.put_char(stream.tty, buffer[offset + i]);
        }
      } catch (e) {
        throw new FS.ErrnoError(29);
      }
      if (length) {
        stream.node.timestamp = Date.now();
      }
      return i;
    }
  },
  default_tty_ops: {
    get_char: function get_char(tty) {
      return FS_stdin_getChar();
    },
    put_char: function put_char(tty, val) {
      if (val === null || val === 10) {
        out(UTF8ArrayToString(tty.output, 0));
        tty.output = [];
      } else {
        if (val != 0) tty.output.push(val);
      }
    },
    // val == 0 would cut text output off in the middle.
    fsync: function fsync(tty) {
      if (tty.output && tty.output.length > 0) {
        out(UTF8ArrayToString(tty.output, 0));
        tty.output = [];
      }
    },
    ioctl_tcgets: function ioctl_tcgets(tty) {
      // typical setting
      return {
        c_iflag: 25856,
        c_oflag: 5,
        c_cflag: 191,
        c_lflag: 35387,
        c_cc: [3, 28, 127, 21, 4, 0, 1, 0, 17, 19, 26, 0, 18, 15, 23, 22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      };
    },
    ioctl_tcsets: function ioctl_tcsets(tty, optional_actions, data) {
      // currently just ignore
      return 0;
    },
    ioctl_tiocgwinsz: function ioctl_tiocgwinsz(tty) {
      return [24, 80];
    }
  },
  default_tty1_ops: {
    put_char: function put_char(tty, val) {
      if (val === null || val === 10) {
        err(UTF8ArrayToString(tty.output, 0));
        tty.output = [];
      } else {
        if (val != 0) tty.output.push(val);
      }
    },
    fsync: function fsync(tty) {
      if (tty.output && tty.output.length > 0) {
        err(UTF8ArrayToString(tty.output, 0));
        tty.output = [];
      }
    }
  }
};
var mmapAlloc = function mmapAlloc(size) {
  abort();
};
var MEMFS = {
  ops_table: null,
  mount: function mount(_mount) {
    return MEMFS.createNode(null, "/", 16384 | 511, /* 0777 */0);
  },
  createNode: function createNode(parent, name, mode, dev) {
    if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
      // no supported
      throw new FS.ErrnoError(63);
    }
    MEMFS.ops_table || (MEMFS.ops_table = {
      dir: {
        node: {
          getattr: MEMFS.node_ops.getattr,
          setattr: MEMFS.node_ops.setattr,
          lookup: MEMFS.node_ops.lookup,
          mknod: MEMFS.node_ops.mknod,
          rename: MEMFS.node_ops.rename,
          unlink: MEMFS.node_ops.unlink,
          rmdir: MEMFS.node_ops.rmdir,
          readdir: MEMFS.node_ops.readdir,
          symlink: MEMFS.node_ops.symlink
        },
        stream: {
          llseek: MEMFS.stream_ops.llseek
        }
      },
      file: {
        node: {
          getattr: MEMFS.node_ops.getattr,
          setattr: MEMFS.node_ops.setattr
        },
        stream: {
          llseek: MEMFS.stream_ops.llseek,
          read: MEMFS.stream_ops.read,
          write: MEMFS.stream_ops.write,
          allocate: MEMFS.stream_ops.allocate,
          mmap: MEMFS.stream_ops.mmap,
          msync: MEMFS.stream_ops.msync
        }
      },
      link: {
        node: {
          getattr: MEMFS.node_ops.getattr,
          setattr: MEMFS.node_ops.setattr,
          readlink: MEMFS.node_ops.readlink
        },
        stream: {}
      },
      chrdev: {
        node: {
          getattr: MEMFS.node_ops.getattr,
          setattr: MEMFS.node_ops.setattr
        },
        stream: FS.chrdev_stream_ops
      }
    });
    var node = FS.createNode(parent, name, mode, dev);
    if (FS.isDir(node.mode)) {
      node.node_ops = MEMFS.ops_table.dir.node;
      node.stream_ops = MEMFS.ops_table.dir.stream;
      node.contents = {};
    } else if (FS.isFile(node.mode)) {
      node.node_ops = MEMFS.ops_table.file.node;
      node.stream_ops = MEMFS.ops_table.file.stream;
      node.usedBytes = 0;
      // The actual number of bytes used in the typed array, as opposed to contents.length which gives the whole capacity.
      // When the byte data of the file is populated, this will point to either a typed array, or a normal JS array. Typed arrays are preferred
      // for performance, and used by default. However, typed arrays are not resizable like normal JS arrays are, so there is a small disk size
      // penalty involved for appending file writes that continuously grow a file similar to std::vector capacity vs used -scheme.
      node.contents = null;
    } else if (FS.isLink(node.mode)) {
      node.node_ops = MEMFS.ops_table.link.node;
      node.stream_ops = MEMFS.ops_table.link.stream;
    } else if (FS.isChrdev(node.mode)) {
      node.node_ops = MEMFS.ops_table.chrdev.node;
      node.stream_ops = MEMFS.ops_table.chrdev.stream;
    }
    node.timestamp = Date.now();
    // add the new node to the parent
    if (parent) {
      parent.contents[name] = node;
      parent.timestamp = node.timestamp;
    }
    return node;
  },
  getFileDataAsTypedArray: function getFileDataAsTypedArray(node) {
    if (!node.contents) return new Uint8Array(0);
    if (node.contents.subarray) return node.contents.subarray(0, node.usedBytes);
    // Make sure to not return excess unused bytes.
    return new Uint8Array(node.contents);
  },
  expandFileStorage: function expandFileStorage(node, newCapacity) {
    var prevCapacity = node.contents ? node.contents.length : 0;
    if (prevCapacity >= newCapacity) return;
    // No need to expand, the storage was already large enough.
    // Don't expand strictly to the given requested limit if it's only a very small increase, but instead geometrically grow capacity.
    // For small filesizes (<1MB), perform size*2 geometric increase, but for large sizes, do a much more conservative size*1.125 increase to
    // avoid overshooting the allocation cap by a very large margin.
    var CAPACITY_DOUBLING_MAX = 1024 * 1024;
    newCapacity = Math.max(newCapacity, prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2 : 1.125) >>> 0);
    if (prevCapacity != 0) newCapacity = Math.max(newCapacity, 256);
    // At minimum allocate 256b for each file when expanding.
    var oldContents = node.contents;
    node.contents = new Uint8Array(newCapacity);
    // Allocate new storage.
    if (node.usedBytes > 0) node.contents.set(oldContents.subarray(0, node.usedBytes), 0);
  },
  // Copy old data over to the new storage.
  resizeFileStorage: function resizeFileStorage(node, newSize) {
    if (node.usedBytes == newSize) return;
    if (newSize == 0) {
      node.contents = null;
      // Fully decommit when requesting a resize to zero.
      node.usedBytes = 0;
    } else {
      var oldContents = node.contents;
      node.contents = new Uint8Array(newSize);
      // Allocate new storage.
      if (oldContents) {
        node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes)));
      }
      // Copy old data over to the new storage.
      node.usedBytes = newSize;
    }
  },
  node_ops: {
    getattr: function getattr(node) {
      var attr = {};
      // device numbers reuse inode numbers.
      attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
      attr.ino = node.id;
      attr.mode = node.mode;
      attr.nlink = 1;
      attr.uid = 0;
      attr.gid = 0;
      attr.rdev = node.rdev;
      if (FS.isDir(node.mode)) {
        attr.size = 4096;
      } else if (FS.isFile(node.mode)) {
        attr.size = node.usedBytes;
      } else if (FS.isLink(node.mode)) {
        attr.size = node.link.length;
      } else {
        attr.size = 0;
      }
      attr.atime = new Date(node.timestamp);
      attr.mtime = new Date(node.timestamp);
      attr.ctime = new Date(node.timestamp);
      // NOTE: In our implementation, st_blocks = Math.ceil(st_size/st_blksize),
      //       but this is not required by the standard.
      attr.blksize = 4096;
      attr.blocks = Math.ceil(attr.size / attr.blksize);
      return attr;
    },
    setattr: function setattr(node, attr) {
      if (attr.mode !== undefined) {
        node.mode = attr.mode;
      }
      if (attr.timestamp !== undefined) {
        node.timestamp = attr.timestamp;
      }
      if (attr.size !== undefined) {
        MEMFS.resizeFileStorage(node, attr.size);
      }
    },
    lookup: function lookup(parent, name) {
      throw FS.genericErrors[44];
    },
    mknod: function mknod(parent, name, mode, dev) {
      return MEMFS.createNode(parent, name, mode, dev);
    },
    rename: function rename(old_node, new_dir, new_name) {
      // if we're overwriting a directory at new_name, make sure it's empty.
      if (FS.isDir(old_node.mode)) {
        var new_node;
        try {
          new_node = FS.lookupNode(new_dir, new_name);
        } catch (e) {}
        if (new_node) {
          for (var i in new_node.contents) {
            throw new FS.ErrnoError(55);
          }
        }
      }
      // do the internal rewiring
      delete old_node.parent.contents[old_node.name];
      old_node.parent.timestamp = Date.now();
      old_node.name = new_name;
      new_dir.contents[new_name] = old_node;
      new_dir.timestamp = old_node.parent.timestamp;
    },
    unlink: function unlink(parent, name) {
      delete parent.contents[name];
      parent.timestamp = Date.now();
    },
    rmdir: function rmdir(parent, name) {
      var node = FS.lookupNode(parent, name);
      for (var i in node.contents) {
        throw new FS.ErrnoError(55);
      }
      delete parent.contents[name];
      parent.timestamp = Date.now();
    },
    readdir: function readdir(node) {
      var entries = [".", ".."];
      for (var _i = 0, _Object$keys = Object.keys(node.contents); _i < _Object$keys.length; _i++) {
        var key = _Object$keys[_i];
        entries.push(key);
      }
      return entries;
    },
    symlink: function symlink(parent, newname, oldpath) {
      var node = MEMFS.createNode(parent, newname, 511 | /* 0777 */40960, 0);
      node.link = oldpath;
      return node;
    },
    readlink: function readlink(node) {
      if (!FS.isLink(node.mode)) {
        throw new FS.ErrnoError(28);
      }
      return node.link;
    }
  },
  stream_ops: {
    read: function read(stream, buffer, offset, length, position) {
      var contents = stream.node.contents;
      if (position >= stream.node.usedBytes) return 0;
      var size = Math.min(stream.node.usedBytes - position, length);
      if (size > 8 && contents.subarray) {
        // non-trivial, and typed array
        buffer.set(contents.subarray(position, position + size), offset);
      } else {
        for (var i = 0; i < size; i++) buffer[offset + i] = contents[position + i];
      }
      return size;
    },
    write: function write(stream, buffer, offset, length, position, canOwn) {
      // If the buffer is located in main memory (HEAP), and if
      // memory can grow, we can't hold on to references of the
      // memory buffer, as they may get invalidated. That means we
      // need to do copy its contents.
      if (buffer.buffer === HEAP8.buffer) {
        canOwn = false;
      }
      if (!length) return 0;
      var node = stream.node;
      node.timestamp = Date.now();
      if (buffer.subarray && (!node.contents || node.contents.subarray)) {
        // This write is from a typed array to a typed array?
        if (canOwn) {
          node.contents = buffer.subarray(offset, offset + length);
          node.usedBytes = length;
          return length;
        } else if (node.usedBytes === 0 && position === 0) {
          // If this is a simple first write to an empty file, do a fast set since we don't need to care about old data.
          node.contents = buffer.slice(offset, offset + length);
          node.usedBytes = length;
          return length;
        } else if (position + length <= node.usedBytes) {
          // Writing to an already allocated and used subrange of the file?
          node.contents.set(buffer.subarray(offset, offset + length), position);
          return length;
        }
      }
      // Appending to an existing file and we need to reallocate, or source data did not come as a typed array.
      MEMFS.expandFileStorage(node, position + length);
      if (node.contents.subarray && buffer.subarray) {
        // Use typed array write which is available.
        node.contents.set(buffer.subarray(offset, offset + length), position);
      } else {
        for (var i = 0; i < length; i++) {
          node.contents[position + i] = buffer[offset + i];
        }
      }
      node.usedBytes = Math.max(node.usedBytes, position + length);
      return length;
    },
    llseek: function llseek(stream, offset, whence) {
      var position = offset;
      if (whence === 1) {
        position += stream.position;
      } else if (whence === 2) {
        if (FS.isFile(stream.node.mode)) {
          position += stream.node.usedBytes;
        }
      }
      if (position < 0) {
        throw new FS.ErrnoError(28);
      }
      return position;
    },
    allocate: function allocate(stream, offset, length) {
      MEMFS.expandFileStorage(stream.node, offset + length);
      stream.node.usedBytes = Math.max(stream.node.usedBytes, offset + length);
    },
    mmap: function mmap(stream, length, position, prot, flags) {
      if (!FS.isFile(stream.node.mode)) {
        throw new FS.ErrnoError(43);
      }
      var ptr;
      var allocated;
      var contents = stream.node.contents;
      // Only make a new copy when MAP_PRIVATE is specified.
      if (!(flags & 2) && contents && contents.buffer === HEAP8.buffer) {
        // We can't emulate MAP_SHARED when the file is not backed by the
        // buffer we're mapping to (e.g. the HEAP buffer).
        allocated = false;
        ptr = contents.byteOffset;
      } else {
        allocated = true;
        ptr = mmapAlloc(length);
        if (!ptr) {
          throw new FS.ErrnoError(48);
        }
        if (contents) {
          // Try to avoid unnecessary slices.
          if (position > 0 || position + length < contents.length) {
            if (contents.subarray) {
              contents = contents.subarray(position, position + length);
            } else {
              contents = Array.prototype.slice.call(contents, position, position + length);
            }
          }
          HEAP8.set(contents, ptr);
        }
      }
      return {
        ptr: ptr,
        allocated: allocated
      };
    },
    msync: function msync(stream, buffer, offset, length, mmapFlags) {
      MEMFS.stream_ops.write(stream, buffer, 0, length, offset, false);
      // should we check if bytesWritten and length are the same?
      return 0;
    }
  }
};

/** @param {boolean=} noRunDep */
var asyncLoad = function asyncLoad(url, onload, onerror, noRunDep) {
  var dep = !noRunDep ? getUniqueRunDependency("al ".concat(url)) : "";
  readAsync(url).then(function (arrayBuffer) {
    onload(new Uint8Array(arrayBuffer));
    if (dep) removeRunDependency(dep);
  }, function (err) {
    if (onerror) {
      onerror();
    } else {
      throw "Loading data file \"".concat(url, "\" failed.");
    }
  });
  if (dep) addRunDependency(dep);
};
var FS_createDataFile = function FS_createDataFile(parent, name, fileData, canRead, canWrite, canOwn) {
  FS.createDataFile(parent, name, fileData, canRead, canWrite, canOwn);
};
var preloadPlugins = Module["preloadPlugins"] || [];
var FS_handledByPreloadPlugin = function FS_handledByPreloadPlugin(byteArray, fullname, finish, onerror) {
  // Ensure plugins are ready.
  if (typeof Browser != "undefined") Browser.init();
  var handled = false;
  preloadPlugins.forEach(function (plugin) {
    if (handled) return;
    if (plugin["canHandle"](fullname)) {
      plugin["handle"](byteArray, fullname, finish, onerror);
      handled = true;
    }
  });
  return handled;
};
var FS_createPreloadedFile = function FS_createPreloadedFile(parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn, preFinish) {
  // TODO we should allow people to just pass in a complete filename instead
  // of parent and name being that we just join them anyways
  var fullname = name ? PATH_FS.resolve(PATH.join2(parent, name)) : parent;
  var dep = getUniqueRunDependency("cp ".concat(fullname));
  // might have several active requests for the same fullname
  function processData(byteArray) {
    function finish(byteArray) {
      preFinish === null || preFinish === void 0 || preFinish();
      if (!dontCreateFile) {
        FS_createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
      }
      onload === null || onload === void 0 || onload();
      removeRunDependency(dep);
    }
    if (FS_handledByPreloadPlugin(byteArray, fullname, finish, function () {
      onerror === null || onerror === void 0 || onerror();
      removeRunDependency(dep);
    })) {
      return;
    }
    finish(byteArray);
  }
  addRunDependency(dep);
  if (typeof url == "string") {
    asyncLoad(url, processData, onerror);
  } else {
    processData(url);
  }
};
var FS_modeStringToFlags = function FS_modeStringToFlags(str) {
  var flagModes = {
    "r": 0,
    "r+": 2,
    "w": 512 | 64 | 1,
    "w+": 512 | 64 | 2,
    "a": 1024 | 64 | 1,
    "a+": 1024 | 64 | 2
  };
  var flags = flagModes[str];
  if (typeof flags == "undefined") {
    throw new Error("Unknown file open mode: ".concat(str));
  }
  return flags;
};
var FS_getMode = function FS_getMode(canRead, canWrite) {
  var mode = 0;
  if (canRead) mode |= 292 | 73;
  if (canWrite) mode |= 146;
  return mode;
};
var FS = {
  root: null,
  mounts: [],
  devices: {},
  streams: [],
  nextInode: 1,
  nameTable: null,
  currentPath: "/",
  initialized: false,
  ignorePermissions: true,
  ErrnoError: /*#__PURE__*/_createClass(
  // We set the `name` property to be able to identify `FS.ErrnoError`
  // - the `name` is a standard ECMA-262 property of error objects. Kind of good to have it anyway.
  // - when using PROXYFS, an error can come from an underlying FS
  // as different FS objects have their own FS.ErrnoError each,
  // the test `err instanceof FS.ErrnoError` won't detect an error coming from another filesystem, causing bugs.
  // we'll use the reliable test `err.name == "ErrnoError"` instead
  function ErrnoError(errno) {
    "use strict";

    _classCallCheck(this, ErrnoError);
    // TODO(sbc): Use the inline member declaration syntax once we
    // support it in acorn and closure.
    this.name = "ErrnoError";
    this.errno = errno;
  }),
  genericErrors: {},
  filesystems: null,
  syncFSRequests: 0,
  FSStream: /*#__PURE__*/function () {
    "use strict";

    function FSStream() {
      _classCallCheck(this, FSStream);
      // TODO(https://github.com/emscripten-core/emscripten/issues/21414):
      // Use inline field declarations.
      this.shared = {};
    }
    return _createClass(FSStream, [{
      key: "object",
      get: function get() {
        return this.node;
      },
      set: function set(val) {
        this.node = val;
      }
    }, {
      key: "isRead",
      get: function get() {
        return (this.flags & 2097155) !== 1;
      }
    }, {
      key: "isWrite",
      get: function get() {
        return (this.flags & 2097155) !== 0;
      }
    }, {
      key: "isAppend",
      get: function get() {
        return this.flags & 1024;
      }
    }, {
      key: "flags",
      get: function get() {
        return this.shared.flags;
      },
      set: function set(val) {
        this.shared.flags = val;
      }
    }, {
      key: "position",
      get: function get() {
        return this.shared.position;
      },
      set: function set(val) {
        this.shared.position = val;
      }
    }]);
  }(),
  FSNode: /*#__PURE__*/function () {
    "use strict";

    function FSNode(parent, name, mode, rdev) {
      _classCallCheck(this, FSNode);
      if (!parent) {
        parent = this;
      }
      // root node sets parent to itself
      this.parent = parent;
      this.mount = parent.mount;
      this.mounted = null;
      this.id = FS.nextInode++;
      this.name = name;
      this.mode = mode;
      this.node_ops = {};
      this.stream_ops = {};
      this.rdev = rdev;
      this.readMode = 292 | 73;
      this.writeMode = 146;
    }
    return _createClass(FSNode, [{
      key: "read",
      get: function get() {
        return (this.mode & this.readMode) === this.readMode;
      },
      set: function set(val) {
        val ? this.mode |= this.readMode : this.mode &= ~this.readMode;
      }
    }, {
      key: "write",
      get: function get() {
        return (this.mode & this.writeMode) === this.writeMode;
      },
      set: function set(val) {
        val ? this.mode |= this.writeMode : this.mode &= ~this.writeMode;
      }
    }, {
      key: "isFolder",
      get: function get() {
        return FS.isDir(this.mode);
      }
    }, {
      key: "isDevice",
      get: function get() {
        return FS.isChrdev(this.mode);
      }
    }]);
  }(),
  lookupPath: function lookupPath(path) {
    var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
    path = PATH_FS.resolve(path);
    if (!path) return {
      path: "",
      node: null
    };
    var defaults = {
      follow_mount: true,
      recurse_count: 0
    };
    opts = Object.assign(defaults, opts);
    if (opts.recurse_count > 8) {
      // max recursive lookup of 8
      throw new FS.ErrnoError(32);
    }
    // split the absolute path
    var parts = path.split("/").filter(function (p) {
      return !!p;
    });
    // start at the root
    var current = FS.root;
    var current_path = "/";
    for (var i = 0; i < parts.length; i++) {
      var islast = i === parts.length - 1;
      if (islast && opts.parent) {
        // stop resolving
        break;
      }
      current = FS.lookupNode(current, parts[i]);
      current_path = PATH.join2(current_path, parts[i]);
      // jump to the mount's root node if this is a mountpoint
      if (FS.isMountpoint(current)) {
        if (!islast || islast && opts.follow_mount) {
          current = current.mounted.root;
        }
      }
      // by default, lookupPath will not follow a symlink if it is the final path component.
      // setting opts.follow = true will override this behavior.
      if (!islast || opts.follow) {
        var count = 0;
        while (FS.isLink(current.mode)) {
          var link = FS.readlink(current_path);
          current_path = PATH_FS.resolve(PATH.dirname(current_path), link);
          var lookup = FS.lookupPath(current_path, {
            recurse_count: opts.recurse_count + 1
          });
          current = lookup.node;
          if (count++ > 40) {
            // limit max consecutive symlinks to 40 (SYMLOOP_MAX).
            throw new FS.ErrnoError(32);
          }
        }
      }
    }
    return {
      path: current_path,
      node: current
    };
  },
  getPath: function getPath(node) {
    var path;
    while (true) {
      if (FS.isRoot(node)) {
        var mount = node.mount.mountpoint;
        if (!path) return mount;
        return mount[mount.length - 1] !== "/" ? "".concat(mount, "/").concat(path) : mount + path;
      }
      path = path ? "".concat(node.name, "/").concat(path) : node.name;
      node = node.parent;
    }
  },
  hashName: function hashName(parentid, name) {
    var hash = 0;
    for (var i = 0; i < name.length; i++) {
      hash = (hash << 5) - hash + name.charCodeAt(i) | 0;
    }
    return (parentid + hash >>> 0) % FS.nameTable.length;
  },
  hashAddNode: function hashAddNode(node) {
    var hash = FS.hashName(node.parent.id, node.name);
    node.name_next = FS.nameTable[hash];
    FS.nameTable[hash] = node;
  },
  hashRemoveNode: function hashRemoveNode(node) {
    var hash = FS.hashName(node.parent.id, node.name);
    if (FS.nameTable[hash] === node) {
      FS.nameTable[hash] = node.name_next;
    } else {
      var current = FS.nameTable[hash];
      while (current) {
        if (current.name_next === node) {
          current.name_next = node.name_next;
          break;
        }
        current = current.name_next;
      }
    }
  },
  lookupNode: function lookupNode(parent, name) {
    var errCode = FS.mayLookup(parent);
    if (errCode) {
      throw new FS.ErrnoError(errCode);
    }
    var hash = FS.hashName(parent.id, name);
    for (var node = FS.nameTable[hash]; node; node = node.name_next) {
      var nodeName = node.name;
      if (node.parent.id === parent.id && nodeName === name) {
        return node;
      }
    }
    // if we failed to find it in the cache, call into the VFS
    return FS.lookup(parent, name);
  },
  createNode: function createNode(parent, name, mode, rdev) {
    var node = new FS.FSNode(parent, name, mode, rdev);
    FS.hashAddNode(node);
    return node;
  },
  destroyNode: function destroyNode(node) {
    FS.hashRemoveNode(node);
  },
  isRoot: function isRoot(node) {
    return node === node.parent;
  },
  isMountpoint: function isMountpoint(node) {
    return !!node.mounted;
  },
  isFile: function isFile(mode) {
    return (mode & 61440) === 32768;
  },
  isDir: function isDir(mode) {
    return (mode & 61440) === 16384;
  },
  isLink: function isLink(mode) {
    return (mode & 61440) === 40960;
  },
  isChrdev: function isChrdev(mode) {
    return (mode & 61440) === 8192;
  },
  isBlkdev: function isBlkdev(mode) {
    return (mode & 61440) === 24576;
  },
  isFIFO: function isFIFO(mode) {
    return (mode & 61440) === 4096;
  },
  isSocket: function isSocket(mode) {
    return (mode & 49152) === 49152;
  },
  flagsToPermissionString: function flagsToPermissionString(flag) {
    var perms = ["r", "w", "rw"][flag & 3];
    if (flag & 512) {
      perms += "w";
    }
    return perms;
  },
  nodePermissions: function nodePermissions(node, perms) {
    if (FS.ignorePermissions) {
      return 0;
    }
    // return 0 if any user, group or owner bits are set.
    if (perms.includes("r") && !(node.mode & 292)) {
      return 2;
    } else if (perms.includes("w") && !(node.mode & 146)) {
      return 2;
    } else if (perms.includes("x") && !(node.mode & 73)) {
      return 2;
    }
    return 0;
  },
  mayLookup: function mayLookup(dir) {
    if (!FS.isDir(dir.mode)) return 54;
    var errCode = FS.nodePermissions(dir, "x");
    if (errCode) return errCode;
    if (!dir.node_ops.lookup) return 2;
    return 0;
  },
  mayCreate: function mayCreate(dir, name) {
    try {
      var node = FS.lookupNode(dir, name);
      return 20;
    } catch (e) {}
    return FS.nodePermissions(dir, "wx");
  },
  mayDelete: function mayDelete(dir, name, isdir) {
    var node;
    try {
      node = FS.lookupNode(dir, name);
    } catch (e) {
      return e.errno;
    }
    var errCode = FS.nodePermissions(dir, "wx");
    if (errCode) {
      return errCode;
    }
    if (isdir) {
      if (!FS.isDir(node.mode)) {
        return 54;
      }
      if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
        return 10;
      }
    } else {
      if (FS.isDir(node.mode)) {
        return 31;
      }
    }
    return 0;
  },
  mayOpen: function mayOpen(node, flags) {
    if (!node) {
      return 44;
    }
    if (FS.isLink(node.mode)) {
      return 32;
    } else if (FS.isDir(node.mode)) {
      if (FS.flagsToPermissionString(flags) !== "r" ||
      // opening for write
      flags & 512) {
        // TODO: check for O_SEARCH? (== search for dir only)
        return 31;
      }
    }
    return FS.nodePermissions(node, FS.flagsToPermissionString(flags));
  },
  MAX_OPEN_FDS: 4096,
  nextfd: function nextfd() {
    for (var fd = 0; fd <= FS.MAX_OPEN_FDS; fd++) {
      if (!FS.streams[fd]) {
        return fd;
      }
    }
    throw new FS.ErrnoError(33);
  },
  getStreamChecked: function getStreamChecked(fd) {
    var stream = FS.getStream(fd);
    if (!stream) {
      throw new FS.ErrnoError(8);
    }
    return stream;
  },
  getStream: function getStream(fd) {
    return FS.streams[fd];
  },
  createStream: function createStream(stream) {
    var fd = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : -1;
    // clone it, so we can return an instance of FSStream
    stream = Object.assign(new FS.FSStream(), stream);
    if (fd == -1) {
      fd = FS.nextfd();
    }
    stream.fd = fd;
    FS.streams[fd] = stream;
    return stream;
  },
  closeStream: function closeStream(fd) {
    FS.streams[fd] = null;
  },
  dupStream: function dupStream(origStream) {
    var _stream$stream_ops, _stream$stream_ops$du;
    var fd = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : -1;
    var stream = FS.createStream(origStream, fd);
    (_stream$stream_ops = stream.stream_ops) === null || _stream$stream_ops === void 0 || (_stream$stream_ops$du = _stream$stream_ops.dup) === null || _stream$stream_ops$du === void 0 || _stream$stream_ops$du.call(_stream$stream_ops, stream);
    return stream;
  },
  chrdev_stream_ops: {
    open: function open(stream) {
      var _stream$stream_ops$op, _stream$stream_ops2;
      var device = FS.getDevice(stream.node.rdev);
      // override node's stream ops with the device's
      stream.stream_ops = device.stream_ops;
      // forward the open call
      (_stream$stream_ops$op = (_stream$stream_ops2 = stream.stream_ops).open) === null || _stream$stream_ops$op === void 0 || _stream$stream_ops$op.call(_stream$stream_ops2, stream);
    },
    llseek: function llseek() {
      throw new FS.ErrnoError(70);
    }
  },
  major: function major(dev) {
    return dev >> 8;
  },
  minor: function minor(dev) {
    return dev & 255;
  },
  makedev: function makedev(ma, mi) {
    return ma << 8 | mi;
  },
  registerDevice: function registerDevice(dev, ops) {
    FS.devices[dev] = {
      stream_ops: ops
    };
  },
  getDevice: function getDevice(dev) {
    return FS.devices[dev];
  },
  getMounts: function getMounts(mount) {
    var mounts = [];
    var check = [mount];
    while (check.length) {
      var m = check.pop();
      mounts.push(m);
      check.push.apply(check, _toConsumableArray(m.mounts));
    }
    return mounts;
  },
  syncfs: function syncfs(populate, callback) {
    if (typeof populate == "function") {
      callback = populate;
      populate = false;
    }
    FS.syncFSRequests++;
    if (FS.syncFSRequests > 1) {
      err("warning: ".concat(FS.syncFSRequests, " FS.syncfs operations in flight at once, probably just doing extra work"));
    }
    var mounts = FS.getMounts(FS.root.mount);
    var completed = 0;
    function doCallback(errCode) {
      FS.syncFSRequests--;
      return callback(errCode);
    }
    function done(errCode) {
      if (errCode) {
        if (!done.errored) {
          done.errored = true;
          return doCallback(errCode);
        }
        return;
      }
      if (++completed >= mounts.length) {
        doCallback(null);
      }
    }
    // sync all mounts
    mounts.forEach(function (mount) {
      if (!mount.type.syncfs) {
        return done(null);
      }
      mount.type.syncfs(mount, populate, done);
    });
  },
  mount: function mount(type, opts, mountpoint) {
    var root = mountpoint === "/";
    var pseudo = !mountpoint;
    var node;
    if (root && FS.root) {
      throw new FS.ErrnoError(10);
    } else if (!root && !pseudo) {
      var lookup = FS.lookupPath(mountpoint, {
        follow_mount: false
      });
      mountpoint = lookup.path;
      // use the absolute path
      node = lookup.node;
      if (FS.isMountpoint(node)) {
        throw new FS.ErrnoError(10);
      }
      if (!FS.isDir(node.mode)) {
        throw new FS.ErrnoError(54);
      }
    }
    var mount = {
      type: type,
      opts: opts,
      mountpoint: mountpoint,
      mounts: []
    };
    // create a root node for the fs
    var mountRoot = type.mount(mount);
    mountRoot.mount = mount;
    mount.root = mountRoot;
    if (root) {
      FS.root = mountRoot;
    } else if (node) {
      // set as a mountpoint
      node.mounted = mount;
      // add the new mount to the current mount's children
      if (node.mount) {
        node.mount.mounts.push(mount);
      }
    }
    return mountRoot;
  },
  unmount: function unmount(mountpoint) {
    var lookup = FS.lookupPath(mountpoint, {
      follow_mount: false
    });
    if (!FS.isMountpoint(lookup.node)) {
      throw new FS.ErrnoError(28);
    }
    // destroy the nodes for this mount, and all its child mounts
    var node = lookup.node;
    var mount = node.mounted;
    var mounts = FS.getMounts(mount);
    Object.keys(FS.nameTable).forEach(function (hash) {
      var current = FS.nameTable[hash];
      while (current) {
        var next = current.name_next;
        if (mounts.includes(current.mount)) {
          FS.destroyNode(current);
        }
        current = next;
      }
    });
    // no longer a mountpoint
    node.mounted = null;
    // remove this mount from the child mounts
    var idx = node.mount.mounts.indexOf(mount);
    node.mount.mounts.splice(idx, 1);
  },
  lookup: function lookup(parent, name) {
    return parent.node_ops.lookup(parent, name);
  },
  mknod: function mknod(path, mode, dev) {
    var lookup = FS.lookupPath(path, {
      parent: true
    });
    var parent = lookup.node;
    var name = PATH.basename(path);
    if (!name || name === "." || name === "..") {
      throw new FS.ErrnoError(28);
    }
    var errCode = FS.mayCreate(parent, name);
    if (errCode) {
      throw new FS.ErrnoError(errCode);
    }
    if (!parent.node_ops.mknod) {
      throw new FS.ErrnoError(63);
    }
    return parent.node_ops.mknod(parent, name, mode, dev);
  },
  create: function create(path, mode) {
    mode = mode !== undefined ? mode : 438;
    /* 0666 */
    mode &= 4095;
    mode |= 32768;
    return FS.mknod(path, mode, 0);
  },
  mkdir: function mkdir(path, mode) {
    mode = mode !== undefined ? mode : 511;
    /* 0777 */
    mode &= 511 | 512;
    mode |= 16384;
    return FS.mknod(path, mode, 0);
  },
  mkdirTree: function mkdirTree(path, mode) {
    var dirs = path.split("/");
    var d = "";
    for (var i = 0; i < dirs.length; ++i) {
      if (!dirs[i]) continue;
      d += "/" + dirs[i];
      try {
        FS.mkdir(d, mode);
      } catch (e) {
        if (e.errno != 20) throw e;
      }
    }
  },
  mkdev: function mkdev(path, mode, dev) {
    if (typeof dev == "undefined") {
      dev = mode;
      mode = 438;
    }
    /* 0666 */
    mode |= 8192;
    return FS.mknod(path, mode, dev);
  },
  symlink: function symlink(oldpath, newpath) {
    if (!PATH_FS.resolve(oldpath)) {
      throw new FS.ErrnoError(44);
    }
    var lookup = FS.lookupPath(newpath, {
      parent: true
    });
    var parent = lookup.node;
    if (!parent) {
      throw new FS.ErrnoError(44);
    }
    var newname = PATH.basename(newpath);
    var errCode = FS.mayCreate(parent, newname);
    if (errCode) {
      throw new FS.ErrnoError(errCode);
    }
    if (!parent.node_ops.symlink) {
      throw new FS.ErrnoError(63);
    }
    return parent.node_ops.symlink(parent, newname, oldpath);
  },
  rename: function rename(old_path, new_path) {
    var old_dirname = PATH.dirname(old_path);
    var new_dirname = PATH.dirname(new_path);
    var old_name = PATH.basename(old_path);
    var new_name = PATH.basename(new_path);
    // parents must exist
    var lookup, old_dir, new_dir;
    // let the errors from non existent directories percolate up
    lookup = FS.lookupPath(old_path, {
      parent: true
    });
    old_dir = lookup.node;
    lookup = FS.lookupPath(new_path, {
      parent: true
    });
    new_dir = lookup.node;
    if (!old_dir || !new_dir) throw new FS.ErrnoError(44);
    // need to be part of the same mount
    if (old_dir.mount !== new_dir.mount) {
      throw new FS.ErrnoError(75);
    }
    // source must exist
    var old_node = FS.lookupNode(old_dir, old_name);
    // old path should not be an ancestor of the new path
    var relative = PATH_FS.relative(old_path, new_dirname);
    if (relative.charAt(0) !== ".") {
      throw new FS.ErrnoError(28);
    }
    // new path should not be an ancestor of the old path
    relative = PATH_FS.relative(new_path, old_dirname);
    if (relative.charAt(0) !== ".") {
      throw new FS.ErrnoError(55);
    }
    // see if the new path already exists
    var new_node;
    try {
      new_node = FS.lookupNode(new_dir, new_name);
    } catch (e) {}
    // early out if nothing needs to change
    if (old_node === new_node) {
      return;
    }
    // we'll need to delete the old entry
    var isdir = FS.isDir(old_node.mode);
    var errCode = FS.mayDelete(old_dir, old_name, isdir);
    if (errCode) {
      throw new FS.ErrnoError(errCode);
    }
    // need delete permissions if we'll be overwriting.
    // need create permissions if new doesn't already exist.
    errCode = new_node ? FS.mayDelete(new_dir, new_name, isdir) : FS.mayCreate(new_dir, new_name);
    if (errCode) {
      throw new FS.ErrnoError(errCode);
    }
    if (!old_dir.node_ops.rename) {
      throw new FS.ErrnoError(63);
    }
    if (FS.isMountpoint(old_node) || new_node && FS.isMountpoint(new_node)) {
      throw new FS.ErrnoError(10);
    }
    // if we are going to change the parent, check write permissions
    if (new_dir !== old_dir) {
      errCode = FS.nodePermissions(old_dir, "w");
      if (errCode) {
        throw new FS.ErrnoError(errCode);
      }
    }
    // remove the node from the lookup hash
    FS.hashRemoveNode(old_node);
    // do the underlying fs rename
    try {
      old_dir.node_ops.rename(old_node, new_dir, new_name);
      // update old node (we do this here to avoid each backend 
      // needing to)
      old_node.parent = new_dir;
    } catch (e) {
      throw e;
    } finally {
      // add the node back to the hash (in case node_ops.rename
      // changed its name)
      FS.hashAddNode(old_node);
    }
  },
  rmdir: function rmdir(path) {
    var lookup = FS.lookupPath(path, {
      parent: true
    });
    var parent = lookup.node;
    var name = PATH.basename(path);
    var node = FS.lookupNode(parent, name);
    var errCode = FS.mayDelete(parent, name, true);
    if (errCode) {
      throw new FS.ErrnoError(errCode);
    }
    if (!parent.node_ops.rmdir) {
      throw new FS.ErrnoError(63);
    }
    if (FS.isMountpoint(node)) {
      throw new FS.ErrnoError(10);
    }
    parent.node_ops.rmdir(parent, name);
    FS.destroyNode(node);
  },
  readdir: function readdir(path) {
    var lookup = FS.lookupPath(path, {
      follow: true
    });
    var node = lookup.node;
    if (!node.node_ops.readdir) {
      throw new FS.ErrnoError(54);
    }
    return node.node_ops.readdir(node);
  },
  unlink: function unlink(path) {
    var lookup = FS.lookupPath(path, {
      parent: true
    });
    var parent = lookup.node;
    if (!parent) {
      throw new FS.ErrnoError(44);
    }
    var name = PATH.basename(path);
    var node = FS.lookupNode(parent, name);
    var errCode = FS.mayDelete(parent, name, false);
    if (errCode) {
      // According to POSIX, we should map EISDIR to EPERM, but
      // we instead do what Linux does (and we must, as we use
      // the musl linux libc).
      throw new FS.ErrnoError(errCode);
    }
    if (!parent.node_ops.unlink) {
      throw new FS.ErrnoError(63);
    }
    if (FS.isMountpoint(node)) {
      throw new FS.ErrnoError(10);
    }
    parent.node_ops.unlink(parent, name);
    FS.destroyNode(node);
  },
  readlink: function readlink(path) {
    var lookup = FS.lookupPath(path);
    var link = lookup.node;
    if (!link) {
      throw new FS.ErrnoError(44);
    }
    if (!link.node_ops.readlink) {
      throw new FS.ErrnoError(28);
    }
    return PATH_FS.resolve(FS.getPath(link.parent), link.node_ops.readlink(link));
  },
  stat: function stat(path, dontFollow) {
    var lookup = FS.lookupPath(path, {
      follow: !dontFollow
    });
    var node = lookup.node;
    if (!node) {
      throw new FS.ErrnoError(44);
    }
    if (!node.node_ops.getattr) {
      throw new FS.ErrnoError(63);
    }
    return node.node_ops.getattr(node);
  },
  lstat: function lstat(path) {
    return FS.stat(path, true);
  },
  chmod: function chmod(path, mode, dontFollow) {
    var node;
    if (typeof path == "string") {
      var lookup = FS.lookupPath(path, {
        follow: !dontFollow
      });
      node = lookup.node;
    } else {
      node = path;
    }
    if (!node.node_ops.setattr) {
      throw new FS.ErrnoError(63);
    }
    node.node_ops.setattr(node, {
      mode: mode & 4095 | node.mode & ~4095,
      timestamp: Date.now()
    });
  },
  lchmod: function lchmod(path, mode) {
    FS.chmod(path, mode, true);
  },
  fchmod: function fchmod(fd, mode) {
    var stream = FS.getStreamChecked(fd);
    FS.chmod(stream.node, mode);
  },
  chown: function chown(path, uid, gid, dontFollow) {
    var node;
    if (typeof path == "string") {
      var lookup = FS.lookupPath(path, {
        follow: !dontFollow
      });
      node = lookup.node;
    } else {
      node = path;
    }
    if (!node.node_ops.setattr) {
      throw new FS.ErrnoError(63);
    }
    node.node_ops.setattr(node, {
      timestamp: Date.now()
    });
  },
  // we ignore the uid / gid for now
  lchown: function lchown(path, uid, gid) {
    FS.chown(path, uid, gid, true);
  },
  fchown: function fchown(fd, uid, gid) {
    var stream = FS.getStreamChecked(fd);
    FS.chown(stream.node, uid, gid);
  },
  truncate: function truncate(path, len) {
    if (len < 0) {
      throw new FS.ErrnoError(28);
    }
    var node;
    if (typeof path == "string") {
      var lookup = FS.lookupPath(path, {
        follow: true
      });
      node = lookup.node;
    } else {
      node = path;
    }
    if (!node.node_ops.setattr) {
      throw new FS.ErrnoError(63);
    }
    if (FS.isDir(node.mode)) {
      throw new FS.ErrnoError(31);
    }
    if (!FS.isFile(node.mode)) {
      throw new FS.ErrnoError(28);
    }
    var errCode = FS.nodePermissions(node, "w");
    if (errCode) {
      throw new FS.ErrnoError(errCode);
    }
    node.node_ops.setattr(node, {
      size: len,
      timestamp: Date.now()
    });
  },
  ftruncate: function ftruncate(fd, len) {
    var stream = FS.getStreamChecked(fd);
    if ((stream.flags & 2097155) === 0) {
      throw new FS.ErrnoError(28);
    }
    FS.truncate(stream.node, len);
  },
  utime: function utime(path, atime, mtime) {
    var lookup = FS.lookupPath(path, {
      follow: true
    });
    var node = lookup.node;
    node.node_ops.setattr(node, {
      timestamp: Math.max(atime, mtime)
    });
  },
  open: function open(path, flags, mode) {
    if (path === "") {
      throw new FS.ErrnoError(44);
    }
    flags = typeof flags == "string" ? FS_modeStringToFlags(flags) : flags;
    if (flags & 64) {
      mode = typeof mode == "undefined" ? 438 : /* 0666 */mode;
      mode = mode & 4095 | 32768;
    } else {
      mode = 0;
    }
    var node;
    if (_typeof(path) == "object") {
      node = path;
    } else {
      path = PATH.normalize(path);
      try {
        var lookup = FS.lookupPath(path, {
          follow: !(flags & 131072)
        });
        node = lookup.node;
      } catch (e) {}
    }
    // perhaps we need to create the node
    var created = false;
    if (flags & 64) {
      if (node) {
        // if O_CREAT and O_EXCL are set, error out if the node already exists
        if (flags & 128) {
          throw new FS.ErrnoError(20);
        }
      } else {
        // node doesn't exist, try to create it
        node = FS.mknod(path, mode, 0);
        created = true;
      }
    }
    if (!node) {
      throw new FS.ErrnoError(44);
    }
    // can't truncate a device
    if (FS.isChrdev(node.mode)) {
      flags &= ~512;
    }
    // if asked only for a directory, then this must be one
    if (flags & 65536 && !FS.isDir(node.mode)) {
      throw new FS.ErrnoError(54);
    }
    // check permissions, if this is not a file we just created now (it is ok to
    // create and write to a file with read-only permissions; it is read-only
    // for later use)
    if (!created) {
      var errCode = FS.mayOpen(node, flags);
      if (errCode) {
        throw new FS.ErrnoError(errCode);
      }
    }
    // do truncation if necessary
    if (flags & 512 && !created) {
      FS.truncate(node, 0);
    }
    // we've already handled these, don't pass down to the underlying vfs
    flags &= ~(128 | 512 | 131072);
    // register the stream with the filesystem
    var stream = FS.createStream({
      node: node,
      path: FS.getPath(node),
      // we want the absolute path to the node
      flags: flags,
      seekable: true,
      position: 0,
      stream_ops: node.stream_ops,
      // used by the file family libc calls (fopen, fwrite, ferror, etc.)
      ungotten: [],
      error: false
    });
    // call the new stream's open function
    if (stream.stream_ops.open) {
      stream.stream_ops.open(stream);
    }
    if (Module["logReadFiles"] && !(flags & 1)) {
      if (!FS.readFiles) FS.readFiles = {};
      if (!(path in FS.readFiles)) {
        FS.readFiles[path] = 1;
      }
    }
    return stream;
  },
  close: function close(stream) {
    if (FS.isClosed(stream)) {
      throw new FS.ErrnoError(8);
    }
    if (stream.getdents) stream.getdents = null;
    // free readdir state
    try {
      if (stream.stream_ops.close) {
        stream.stream_ops.close(stream);
      }
    } catch (e) {
      throw e;
    } finally {
      FS.closeStream(stream.fd);
    }
    stream.fd = null;
  },
  isClosed: function isClosed(stream) {
    return stream.fd === null;
  },
  llseek: function llseek(stream, offset, whence) {
    if (FS.isClosed(stream)) {
      throw new FS.ErrnoError(8);
    }
    if (!stream.seekable || !stream.stream_ops.llseek) {
      throw new FS.ErrnoError(70);
    }
    if (whence != 0 && whence != 1 && whence != 2) {
      throw new FS.ErrnoError(28);
    }
    stream.position = stream.stream_ops.llseek(stream, offset, whence);
    stream.ungotten = [];
    return stream.position;
  },
  read: function read(stream, buffer, offset, length, position) {
    if (length < 0 || position < 0) {
      throw new FS.ErrnoError(28);
    }
    if (FS.isClosed(stream)) {
      throw new FS.ErrnoError(8);
    }
    if ((stream.flags & 2097155) === 1) {
      throw new FS.ErrnoError(8);
    }
    if (FS.isDir(stream.node.mode)) {
      throw new FS.ErrnoError(31);
    }
    if (!stream.stream_ops.read) {
      throw new FS.ErrnoError(28);
    }
    var seeking = typeof position != "undefined";
    if (!seeking) {
      position = stream.position;
    } else if (!stream.seekable) {
      throw new FS.ErrnoError(70);
    }
    var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
    if (!seeking) stream.position += bytesRead;
    return bytesRead;
  },
  write: function write(stream, buffer, offset, length, position, canOwn) {
    if (length < 0 || position < 0) {
      throw new FS.ErrnoError(28);
    }
    if (FS.isClosed(stream)) {
      throw new FS.ErrnoError(8);
    }
    if ((stream.flags & 2097155) === 0) {
      throw new FS.ErrnoError(8);
    }
    if (FS.isDir(stream.node.mode)) {
      throw new FS.ErrnoError(31);
    }
    if (!stream.stream_ops.write) {
      throw new FS.ErrnoError(28);
    }
    if (stream.seekable && stream.flags & 1024) {
      // seek to the end before writing in append mode
      FS.llseek(stream, 0, 2);
    }
    var seeking = typeof position != "undefined";
    if (!seeking) {
      position = stream.position;
    } else if (!stream.seekable) {
      throw new FS.ErrnoError(70);
    }
    var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
    if (!seeking) stream.position += bytesWritten;
    return bytesWritten;
  },
  allocate: function allocate(stream, offset, length) {
    if (FS.isClosed(stream)) {
      throw new FS.ErrnoError(8);
    }
    if (offset < 0 || length <= 0) {
      throw new FS.ErrnoError(28);
    }
    if ((stream.flags & 2097155) === 0) {
      throw new FS.ErrnoError(8);
    }
    if (!FS.isFile(stream.node.mode) && !FS.isDir(stream.node.mode)) {
      throw new FS.ErrnoError(43);
    }
    if (!stream.stream_ops.allocate) {
      throw new FS.ErrnoError(138);
    }
    stream.stream_ops.allocate(stream, offset, length);
  },
  mmap: function mmap(stream, length, position, prot, flags) {
    // User requests writing to file (prot & PROT_WRITE != 0).
    // Checking if we have permissions to write to the file unless
    // MAP_PRIVATE flag is set. According to POSIX spec it is possible
    // to write to file opened in read-only mode with MAP_PRIVATE flag,
    // as all modifications will be visible only in the memory of
    // the current process.
    if ((prot & 2) !== 0 && (flags & 2) === 0 && (stream.flags & 2097155) !== 2) {
      throw new FS.ErrnoError(2);
    }
    if ((stream.flags & 2097155) === 1) {
      throw new FS.ErrnoError(2);
    }
    if (!stream.stream_ops.mmap) {
      throw new FS.ErrnoError(43);
    }
    if (!length) {
      throw new FS.ErrnoError(28);
    }
    return stream.stream_ops.mmap(stream, length, position, prot, flags);
  },
  msync: function msync(stream, buffer, offset, length, mmapFlags) {
    if (!stream.stream_ops.msync) {
      return 0;
    }
    return stream.stream_ops.msync(stream, buffer, offset, length, mmapFlags);
  },
  ioctl: function ioctl(stream, cmd, arg) {
    if (!stream.stream_ops.ioctl) {
      throw new FS.ErrnoError(59);
    }
    return stream.stream_ops.ioctl(stream, cmd, arg);
  },
  readFile: function readFile(path) {
    var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
    opts.flags = opts.flags || 0;
    opts.encoding = opts.encoding || "binary";
    if (opts.encoding !== "utf8" && opts.encoding !== "binary") {
      throw new Error("Invalid encoding type \"".concat(opts.encoding, "\""));
    }
    var ret;
    var stream = FS.open(path, opts.flags);
    var stat = FS.stat(path);
    var length = stat.size;
    var buf = new Uint8Array(length);
    FS.read(stream, buf, 0, length, 0);
    if (opts.encoding === "utf8") {
      ret = UTF8ArrayToString(buf, 0);
    } else if (opts.encoding === "binary") {
      ret = buf;
    }
    FS.close(stream);
    return ret;
  },
  writeFile: function writeFile(path, data) {
    var opts = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
    opts.flags = opts.flags || 577;
    var stream = FS.open(path, opts.flags, opts.mode);
    if (typeof data == "string") {
      var buf = new Uint8Array(lengthBytesUTF8(data) + 1);
      var actualNumBytes = stringToUTF8Array(data, buf, 0, buf.length);
      FS.write(stream, buf, 0, actualNumBytes, undefined, opts.canOwn);
    } else if (ArrayBuffer.isView(data)) {
      FS.write(stream, data, 0, data.byteLength, undefined, opts.canOwn);
    } else {
      throw new Error("Unsupported data type");
    }
    FS.close(stream);
  },
  cwd: function cwd() {
    return FS.currentPath;
  },
  chdir: function chdir(path) {
    var lookup = FS.lookupPath(path, {
      follow: true
    });
    if (lookup.node === null) {
      throw new FS.ErrnoError(44);
    }
    if (!FS.isDir(lookup.node.mode)) {
      throw new FS.ErrnoError(54);
    }
    var errCode = FS.nodePermissions(lookup.node, "x");
    if (errCode) {
      throw new FS.ErrnoError(errCode);
    }
    FS.currentPath = lookup.path;
  },
  createDefaultDirectories: function createDefaultDirectories() {
    FS.mkdir("/tmp");
    FS.mkdir("/home");
    FS.mkdir("/home/web_user");
  },
  createDefaultDevices: function createDefaultDevices() {
    // create /dev
    FS.mkdir("/dev");
    // setup /dev/null
    FS.registerDevice(FS.makedev(1, 3), {
      read: function read() {
        return 0;
      },
      write: function write(stream, buffer, offset, length, pos) {
        return length;
      }
    });
    FS.mkdev("/dev/null", FS.makedev(1, 3));
    // setup /dev/tty and /dev/tty1
    // stderr needs to print output using err() rather than out()
    // so we register a second tty just for it.
    TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
    TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
    FS.mkdev("/dev/tty", FS.makedev(5, 0));
    FS.mkdev("/dev/tty1", FS.makedev(6, 0));
    // setup /dev/[u]random
    // use a buffer to avoid overhead of individual crypto calls per byte
    var randomBuffer = new Uint8Array(1024),
      randomLeft = 0;
    var randomByte = function randomByte() {
      if (randomLeft === 0) {
        randomLeft = _randomFill(randomBuffer).byteLength;
      }
      return randomBuffer[--randomLeft];
    };
    FS.createDevice("/dev", "random", randomByte);
    FS.createDevice("/dev", "urandom", randomByte);
    // we're not going to emulate the actual shm device,
    // just create the tmp dirs that reside in it commonly
    FS.mkdir("/dev/shm");
    FS.mkdir("/dev/shm/tmp");
  },
  createSpecialDirectories: function createSpecialDirectories() {
    // create /proc/self/fd which allows /proc/self/fd/6 => readlink gives the
    // name of the stream for fd 6 (see test_unistd_ttyname)
    FS.mkdir("/proc");
    var proc_self = FS.mkdir("/proc/self");
    FS.mkdir("/proc/self/fd");
    FS.mount({
      mount: function mount() {
        var node = FS.createNode(proc_self, "fd", 16384 | 511, /* 0777 */73);
        node.node_ops = {
          lookup: function lookup(parent, name) {
            var fd = +name;
            var stream = FS.getStreamChecked(fd);
            var ret = {
              parent: null,
              mount: {
                mountpoint: "fake"
              },
              node_ops: {
                readlink: function readlink() {
                  return stream.path;
                }
              }
            };
            ret.parent = ret;
            // make it look like a simple root node
            return ret;
          }
        };
        return node;
      }
    }, {}, "/proc/self/fd");
  },
  createStandardStreams: function createStandardStreams(input, output, error) {
    // TODO deprecate the old functionality of a single
    // input / output callback and that utilizes FS.createDevice
    // and instead require a unique set of stream ops
    // by default, we symlink the standard streams to the
    // default tty devices. however, if the standard streams
    // have been overwritten we create a unique device for
    // them instead.
    if (input) {
      FS.createDevice("/dev", "stdin", input);
    } else {
      FS.symlink("/dev/tty", "/dev/stdin");
    }
    if (output) {
      FS.createDevice("/dev", "stdout", null, output);
    } else {
      FS.symlink("/dev/tty", "/dev/stdout");
    }
    if (error) {
      FS.createDevice("/dev", "stderr", null, error);
    } else {
      FS.symlink("/dev/tty1", "/dev/stderr");
    }
    // open default streams for the stdin, stdout and stderr devices
    var stdin = FS.open("/dev/stdin", 0);
    var stdout = FS.open("/dev/stdout", 1);
    var stderr = FS.open("/dev/stderr", 1);
  },
  staticInit: function staticInit() {
    // Some errors may happen quite a bit, to avoid overhead we reuse them (and suffer a lack of stack info)
    [44].forEach(function (code) {
      FS.genericErrors[code] = new FS.ErrnoError(code);
      FS.genericErrors[code].stack = "<generic error, no stack>";
    });
    FS.nameTable = new Array(4096);
    FS.mount(MEMFS, {}, "/");
    FS.createDefaultDirectories();
    FS.createDefaultDevices();
    FS.createSpecialDirectories();
    FS.filesystems = {
      "MEMFS": MEMFS
    };
  },
  init: function init(input, output, error) {
    var _input, _output, _error;
    FS.initialized = true;
    // Allow Module.stdin etc. to provide defaults, if none explicitly passed to us here
    (_input = input) !== null && _input !== void 0 ? _input : input = Module["stdin"];
    (_output = output) !== null && _output !== void 0 ? _output : output = Module["stdout"];
    (_error = error) !== null && _error !== void 0 ? _error : error = Module["stderr"];
    FS.createStandardStreams(input, output, error);
  },
  quit: function quit() {
    FS.initialized = false;
    // force-flush all streams, so we get musl std streams printed out
    // close all of our streams
    for (var i = 0; i < FS.streams.length; i++) {
      var stream = FS.streams[i];
      if (!stream) {
        continue;
      }
      FS.close(stream);
    }
  },
  findObject: function findObject(path, dontResolveLastLink) {
    var ret = FS.analyzePath(path, dontResolveLastLink);
    if (!ret.exists) {
      return null;
    }
    return ret.object;
  },
  analyzePath: function analyzePath(path, dontResolveLastLink) {
    // operate from within the context of the symlink's target
    try {
      var lookup = FS.lookupPath(path, {
        follow: !dontResolveLastLink
      });
      path = lookup.path;
    } catch (e) {}
    var ret = {
      isRoot: false,
      exists: false,
      error: 0,
      name: null,
      path: null,
      object: null,
      parentExists: false,
      parentPath: null,
      parentObject: null
    };
    try {
      var lookup = FS.lookupPath(path, {
        parent: true
      });
      ret.parentExists = true;
      ret.parentPath = lookup.path;
      ret.parentObject = lookup.node;
      ret.name = PATH.basename(path);
      lookup = FS.lookupPath(path, {
        follow: !dontResolveLastLink
      });
      ret.exists = true;
      ret.path = lookup.path;
      ret.object = lookup.node;
      ret.name = lookup.node.name;
      ret.isRoot = lookup.path === "/";
    } catch (e) {
      ret.error = e.errno;
    }
    return ret;
  },
  createPath: function createPath(parent, path, canRead, canWrite) {
    parent = typeof parent == "string" ? parent : FS.getPath(parent);
    var parts = path.split("/").reverse();
    while (parts.length) {
      var part = parts.pop();
      if (!part) continue;
      var current = PATH.join2(parent, part);
      try {
        FS.mkdir(current);
      } catch (e) {}
      // ignore EEXIST
      parent = current;
    }
    return current;
  },
  createFile: function createFile(parent, name, properties, canRead, canWrite) {
    var path = PATH.join2(typeof parent == "string" ? parent : FS.getPath(parent), name);
    var mode = FS_getMode(canRead, canWrite);
    return FS.create(path, mode);
  },
  createDataFile: function createDataFile(parent, name, data, canRead, canWrite, canOwn) {
    var path = name;
    if (parent) {
      parent = typeof parent == "string" ? parent : FS.getPath(parent);
      path = name ? PATH.join2(parent, name) : parent;
    }
    var mode = FS_getMode(canRead, canWrite);
    var node = FS.create(path, mode);
    if (data) {
      if (typeof data == "string") {
        var arr = new Array(data.length);
        for (var i = 0, len = data.length; i < len; ++i) arr[i] = data.charCodeAt(i);
        data = arr;
      }
      // make sure we can write to the file
      FS.chmod(node, mode | 146);
      var stream = FS.open(node, 577);
      FS.write(stream, data, 0, data.length, 0, canOwn);
      FS.close(stream);
      FS.chmod(node, mode);
    }
  },
  createDevice: function createDevice(parent, name, input, output) {
    var path = PATH.join2(typeof parent == "string" ? parent : FS.getPath(parent), name);
    var mode = FS_getMode(!!input, !!output);
    if (!FS.createDevice.major) FS.createDevice.major = 64;
    var dev = FS.makedev(FS.createDevice.major++, 0);
    // Create a fake device that a set of stream ops to emulate
    // the old behavior.
    FS.registerDevice(dev, {
      open: function open(stream) {
        stream.seekable = false;
      },
      close: function close(stream) {
        var _output$buffer;
        // flush any pending line data
        if (output !== null && output !== void 0 && (_output$buffer = output.buffer) !== null && _output$buffer !== void 0 && _output$buffer.length) {
          output(10);
        }
      },
      read: function read(stream, buffer, offset, length, pos) {
        /* ignored */var bytesRead = 0;
        for (var i = 0; i < length; i++) {
          var result;
          try {
            result = input();
          } catch (e) {
            throw new FS.ErrnoError(29);
          }
          if (result === undefined && bytesRead === 0) {
            throw new FS.ErrnoError(6);
          }
          if (result === null || result === undefined) break;
          bytesRead++;
          buffer[offset + i] = result;
        }
        if (bytesRead) {
          stream.node.timestamp = Date.now();
        }
        return bytesRead;
      },
      write: function write(stream, buffer, offset, length, pos) {
        for (var i = 0; i < length; i++) {
          try {
            output(buffer[offset + i]);
          } catch (e) {
            throw new FS.ErrnoError(29);
          }
        }
        if (length) {
          stream.node.timestamp = Date.now();
        }
        return i;
      }
    });
    return FS.mkdev(path, mode, dev);
  },
  forceLoadFile: function forceLoadFile(obj) {
    if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
    if (typeof XMLHttpRequest != "undefined") {
      throw new Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
    } else {
      // Command-line.
      try {
        obj.contents = readBinary(obj.url);
        obj.usedBytes = obj.contents.length;
      } catch (e) {
        throw new FS.ErrnoError(29);
      }
    }
  },
  createLazyFile: function createLazyFile(parent, name, url, canRead, canWrite) {
    // Lazy chunked Uint8Array (implements get and length from Uint8Array).
    // Actual getting is abstracted away for eventual reuse.
    var LazyUint8Array = /*#__PURE__*/function () {
      "use strict";

      function LazyUint8Array() {
        _classCallCheck(this, LazyUint8Array);
        this.lengthKnown = false;
        this.chunks = [];
      }
      // Loaded chunks. Index is the chunk number
      return _createClass(LazyUint8Array, [{
        key: "get",
        value: function get(idx) {
          if (idx > this.length - 1 || idx < 0) {
            return undefined;
          }
          var chunkOffset = idx % this.chunkSize;
          var chunkNum = idx / this.chunkSize | 0;
          return this.getter(chunkNum)[chunkOffset];
        }
      }, {
        key: "setDataGetter",
        value: function setDataGetter(getter) {
          this.getter = getter;
        }
      }, {
        key: "cacheLength",
        value: function cacheLength() {
          // Find length
          var xhr = new XMLHttpRequest();
          xhr.open("HEAD", url, false);
          xhr.send(null);
          if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
          var datalength = Number(xhr.getResponseHeader("Content-length"));
          var header;
          var hasByteServing = (header = xhr.getResponseHeader("Accept-Ranges")) && header === "bytes";
          var usesGzip = (header = xhr.getResponseHeader("Content-Encoding")) && header === "gzip";
          var chunkSize = 1024 * 1024;
          // Chunk size in bytes
          if (!hasByteServing) chunkSize = datalength;
          // Function to get a range from the remote URL.
          var doXHR = function doXHR(from, to) {
            if (from > to) throw new Error("invalid range (" + from + ", " + to + ") or no bytes requested!");
            if (to > datalength - 1) throw new Error("only " + datalength + " bytes available! programmer error!");
            // TODO: Use mozResponseArrayBuffer, responseStream, etc. if available.
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url, false);
            if (datalength !== chunkSize) xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);
            // Some hints to the browser that we want binary data.
            xhr.responseType = "arraybuffer";
            if (xhr.overrideMimeType) {
              xhr.overrideMimeType("text/plain; charset=x-user-defined");
            }
            xhr.send(null);
            if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
            if (xhr.response !== undefined) {
              return new Uint8Array(/** @type{Array<number>} */xhr.response || []);
            }
            return intArrayFromString(xhr.responseText || "", true);
          };
          var lazyArray = this;
          lazyArray.setDataGetter(function (chunkNum) {
            var start = chunkNum * chunkSize;
            var end = (chunkNum + 1) * chunkSize - 1;
            // including this byte
            end = Math.min(end, datalength - 1);
            // if datalength-1 is selected, this is the last block
            if (typeof lazyArray.chunks[chunkNum] == "undefined") {
              lazyArray.chunks[chunkNum] = doXHR(start, end);
            }
            if (typeof lazyArray.chunks[chunkNum] == "undefined") throw new Error("doXHR failed!");
            return lazyArray.chunks[chunkNum];
          });
          if (usesGzip || !datalength) {
            // if the server uses gzip or doesn't supply the length, we have to download the whole file to get the (uncompressed) length
            chunkSize = datalength = 1;
            // this will force getter(0)/doXHR do download the whole file
            datalength = this.getter(0).length;
            chunkSize = datalength;
            out("LazyFiles on gzip forces download of the whole file when length is accessed");
          }
          this._length = datalength;
          this._chunkSize = chunkSize;
          this.lengthKnown = true;
        }
      }, {
        key: "length",
        get: function get() {
          if (!this.lengthKnown) {
            this.cacheLength();
          }
          return this._length;
        }
      }, {
        key: "chunkSize",
        get: function get() {
          if (!this.lengthKnown) {
            this.cacheLength();
          }
          return this._chunkSize;
        }
      }]);
    }();
    if (typeof XMLHttpRequest != "undefined") {
      if (!ENVIRONMENT_IS_WORKER) throw "Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc";
      var lazyArray = new LazyUint8Array();
      var properties = {
        isDevice: false,
        contents: lazyArray
      };
    } else {
      var properties = {
        isDevice: false,
        url: url
      };
    }
    var node = FS.createFile(parent, name, properties, canRead, canWrite);
    // This is a total hack, but I want to get this lazy file code out of the
    // core of MEMFS. If we want to keep this lazy file concept I feel it should
    // be its own thin LAZYFS proxying calls to MEMFS.
    if (properties.contents) {
      node.contents = properties.contents;
    } else if (properties.url) {
      node.contents = null;
      node.url = properties.url;
    }
    // Add a function that defers querying the file size until it is asked the first time.
    Object.defineProperties(node, {
      usedBytes: {
        get: function get() {
          return this.contents.length;
        }
      }
    });
    // override each stream op with one that tries to force load the lazy file first
    var stream_ops = {};
    var keys = Object.keys(node.stream_ops);
    keys.forEach(function (key) {
      var fn = node.stream_ops[key];
      stream_ops[key] = function () {
        FS.forceLoadFile(node);
        return fn.apply(void 0, arguments);
      };
    });
    function writeChunks(stream, buffer, offset, length, position) {
      var contents = stream.node.contents;
      if (position >= contents.length) return 0;
      var size = Math.min(contents.length - position, length);
      if (contents.slice) {
        // normal array
        for (var i = 0; i < size; i++) {
          buffer[offset + i] = contents[position + i];
        }
      } else {
        for (var i = 0; i < size; i++) {
          // LazyUint8Array from sync binary XHR
          buffer[offset + i] = contents.get(position + i);
        }
      }
      return size;
    }
    // use a custom read function
    stream_ops.read = function (stream, buffer, offset, length, position) {
      FS.forceLoadFile(node);
      return writeChunks(stream, buffer, offset, length, position);
    };
    // use a custom mmap function
    stream_ops.mmap = function (stream, length, position, prot, flags) {
      FS.forceLoadFile(node);
      var ptr = mmapAlloc(length);
      if (!ptr) {
        throw new FS.ErrnoError(48);
      }
      writeChunks(stream, HEAP8, ptr, length, position);
      return {
        ptr: ptr,
        allocated: true
      };
    };
    node.stream_ops = stream_ops;
    return node;
  }
};
var SYSCALLS = {
  DEFAULT_POLLMASK: 5,
  calculateAt: function calculateAt(dirfd, path, allowEmpty) {
    if (PATH.isAbs(path)) {
      return path;
    }
    // relative path
    var dir;
    if (dirfd === -100) {
      dir = FS.cwd();
    } else {
      var dirstream = SYSCALLS.getStreamFromFD(dirfd);
      dir = dirstream.path;
    }
    if (path.length == 0) {
      if (!allowEmpty) {
        throw new FS.ErrnoError(44);
      }
      return dir;
    }
    return PATH.join2(dir, path);
  },
  doStat: function doStat(func, path, buf) {
    var stat = func(path);
    HEAP32[buf >> 2] = stat.dev;
    HEAP32[buf + 4 >> 2] = stat.mode;
    HEAPU32[buf + 8 >> 2] = stat.nlink;
    HEAP32[buf + 12 >> 2] = stat.uid;
    HEAP32[buf + 16 >> 2] = stat.gid;
    HEAP32[buf + 20 >> 2] = stat.rdev;
    tempI64 = [stat.size >>> 0, (tempDouble = stat.size, +Math.abs(tempDouble) >= 1 ? tempDouble > 0 ? +Math.floor(tempDouble / 4294967296) >>> 0 : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296) >>> 0 : 0)], HEAP32[buf + 24 >> 2] = tempI64[0], HEAP32[buf + 28 >> 2] = tempI64[1];
    HEAP32[buf + 32 >> 2] = 4096;
    HEAP32[buf + 36 >> 2] = stat.blocks;
    var atime = stat.atime.getTime();
    var mtime = stat.mtime.getTime();
    var ctime = stat.ctime.getTime();
    tempI64 = [Math.floor(atime / 1e3) >>> 0, (tempDouble = Math.floor(atime / 1e3), +Math.abs(tempDouble) >= 1 ? tempDouble > 0 ? +Math.floor(tempDouble / 4294967296) >>> 0 : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296) >>> 0 : 0)], HEAP32[buf + 40 >> 2] = tempI64[0], HEAP32[buf + 44 >> 2] = tempI64[1];
    HEAPU32[buf + 48 >> 2] = atime % 1e3 * 1e3 * 1e3;
    tempI64 = [Math.floor(mtime / 1e3) >>> 0, (tempDouble = Math.floor(mtime / 1e3), +Math.abs(tempDouble) >= 1 ? tempDouble > 0 ? +Math.floor(tempDouble / 4294967296) >>> 0 : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296) >>> 0 : 0)], HEAP32[buf + 56 >> 2] = tempI64[0], HEAP32[buf + 60 >> 2] = tempI64[1];
    HEAPU32[buf + 64 >> 2] = mtime % 1e3 * 1e3 * 1e3;
    tempI64 = [Math.floor(ctime / 1e3) >>> 0, (tempDouble = Math.floor(ctime / 1e3), +Math.abs(tempDouble) >= 1 ? tempDouble > 0 ? +Math.floor(tempDouble / 4294967296) >>> 0 : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296) >>> 0 : 0)], HEAP32[buf + 72 >> 2] = tempI64[0], HEAP32[buf + 76 >> 2] = tempI64[1];
    HEAPU32[buf + 80 >> 2] = ctime % 1e3 * 1e3 * 1e3;
    tempI64 = [stat.ino >>> 0, (tempDouble = stat.ino, +Math.abs(tempDouble) >= 1 ? tempDouble > 0 ? +Math.floor(tempDouble / 4294967296) >>> 0 : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296) >>> 0 : 0)], HEAP32[buf + 88 >> 2] = tempI64[0], HEAP32[buf + 92 >> 2] = tempI64[1];
    return 0;
  },
  doMsync: function doMsync(addr, stream, len, flags, offset) {
    if (!FS.isFile(stream.node.mode)) {
      throw new FS.ErrnoError(43);
    }
    if (flags & 2) {
      // MAP_PRIVATE calls need not to be synced back to underlying fs
      return 0;
    }
    var buffer = HEAPU8.slice(addr, addr + len);
    FS.msync(stream, buffer, offset, len, flags);
  },
  getStreamFromFD: function getStreamFromFD(fd) {
    var stream = FS.getStreamChecked(fd);
    return stream;
  },
  varargs: undefined,
  getStr: function getStr(ptr) {
    var ret = UTF8ToString(ptr);
    return ret;
  }
};
function _fd_close(fd) {
  try {
    var stream = SYSCALLS.getStreamFromFD(fd);
    FS.close(stream);
    return 0;
  } catch (e) {
    if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
    return e.errno;
  }
}

/** @param {number=} offset */
var doReadv = function doReadv(stream, iov, iovcnt, offset) {
  var ret = 0;
  for (var i = 0; i < iovcnt; i++) {
    var ptr = HEAPU32[iov >> 2];
    var len = HEAPU32[iov + 4 >> 2];
    iov += 8;
    var curr = FS.read(stream, HEAP8, ptr, len, offset);
    if (curr < 0) return -1;
    ret += curr;
    if (curr < len) break;
    // nothing more to read
    if (typeof offset != "undefined") {
      offset += curr;
    }
  }
  return ret;
};
function _fd_read(fd, iov, iovcnt, pnum) {
  try {
    var stream = SYSCALLS.getStreamFromFD(fd);
    var num = doReadv(stream, iov, iovcnt);
    HEAPU32[pnum >> 2] = num;
    return 0;
  } catch (e) {
    if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
    return e.errno;
  }
}
var convertI32PairToI53Checked = function convertI32PairToI53Checked(lo, hi) {
  return hi + 2097152 >>> 0 < 4194305 - !!lo ? (lo >>> 0) + hi * 4294967296 : NaN;
};
function _fd_seek(fd, offset_low, offset_high, whence, newOffset) {
  var offset = convertI32PairToI53Checked(offset_low, offset_high);
  try {
    if (isNaN(offset)) return 61;
    var stream = SYSCALLS.getStreamFromFD(fd);
    FS.llseek(stream, offset, whence);
    tempI64 = [stream.position >>> 0, (tempDouble = stream.position, +Math.abs(tempDouble) >= 1 ? tempDouble > 0 ? +Math.floor(tempDouble / 4294967296) >>> 0 : ~~+Math.ceil((tempDouble - +(~~tempDouble >>> 0)) / 4294967296) >>> 0 : 0)], HEAP32[newOffset >> 2] = tempI64[0], HEAP32[newOffset + 4 >> 2] = tempI64[1];
    if (stream.getdents && offset === 0 && whence === 0) stream.getdents = null;
    // reset readdir state
    return 0;
  } catch (e) {
    if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
    return e.errno;
  }
}

/** @param {number=} offset */
var doWritev = function doWritev(stream, iov, iovcnt, offset) {
  var ret = 0;
  for (var i = 0; i < iovcnt; i++) {
    var ptr = HEAPU32[iov >> 2];
    var len = HEAPU32[iov + 4 >> 2];
    iov += 8;
    var curr = FS.write(stream, HEAP8, ptr, len, offset);
    if (curr < 0) return -1;
    ret += curr;
    if (curr < len) {
      // No more space to write.
      break;
    }
    if (typeof offset != "undefined") {
      offset += curr;
    }
  }
  return ret;
};
function _fd_write(fd, iov, iovcnt, pnum) {
  try {
    var stream = SYSCALLS.getStreamFromFD(fd);
    var num = doWritev(stream, iov, iovcnt);
    HEAPU32[pnum >> 2] = num;
    return 0;
  } catch (e) {
    if (typeof FS == "undefined" || !(e.name === "ErrnoError")) throw e;
    return e.errno;
  }
}
var _getentropy = function _getentropy(buffer, size) {
  _randomFill(HEAPU8.subarray(buffer, buffer + size));
  return 0;
};
var _llvm_eh_typeid_for = function _llvm_eh_typeid_for(type) {
  return type;
};

/** @type {WebAssembly.Table} */
var wasmTable;
var getWasmTableEntry = function getWasmTableEntry(funcPtr) {
  return wasmTable.get(funcPtr);
};
FS.createPreloadedFile = FS_createPreloadedFile;
FS.staticInit();
var wasmImports = {
  /** @export */n: ___assert_fail,
  /** @export */l: ___cxa_begin_catch,
  /** @export */m: ___cxa_end_catch,
  /** @export */fa: ___cxa_find_matching_catch_17,
  /** @export */a: ___cxa_find_matching_catch_2,
  /** @export */g: ___cxa_find_matching_catch_3,
  /** @export */H: ___cxa_find_matching_catch_4,
  /** @export */ea: ___cxa_find_matching_catch_6,
  /** @export */I: ___cxa_rethrow,
  /** @export */r: ___cxa_throw,
  /** @export */ta: ___cxa_uncaught_exceptions,
  /** @export */d: ___resumeException,
  /** @export */oa: __abort_js,
  /** @export */ba: __emscripten_get_now_is_monotonic,
  /** @export */ma: __emscripten_runtime_keepalive_clear,
  /** @export */na: __setitimer_js,
  /** @export */O: __tzset_js,
  /** @export */ja: _emscripten_date_now,
  /** @export */V: _emscripten_get_now,
  /** @export */ua: _emscripten_resize_heap,
  /** @export */qa: _environ_get,
  /** @export */ra: _environ_sizes_get,
  /** @export */N: _fd_close,
  /** @export */sa: _fd_read,
  /** @export */$: _fd_seek,
  /** @export */va: _fd_write,
  /** @export */pa: _getentropy,
  /** @export */w: invoke_di,
  /** @export */ga: invoke_did,
  /** @export */D: invoke_didi,
  /** @export */E: invoke_dii,
  /** @export */C: invoke_diii,
  /** @export */K: invoke_fi,
  /** @export */ka: invoke_fii,
  /** @export */v: invoke_i,
  /** @export */e: invoke_ii,
  /** @export */ca: invoke_iid,
  /** @export */ha: invoke_iifi,
  /** @export */c: invoke_iii,
  /** @export */h: invoke_iiii,
  /** @export */da: invoke_iiiidd,
  /** @export */q: invoke_iiiii,
  /** @export */aa: invoke_iiiiid,
  /** @export */s: invoke_iiiiii,
  /** @export */t: invoke_iiiiiii,
  /** @export */G: invoke_iiiiiiii,
  /** @export */M: invoke_iiiiiiiii,
  /** @export */B: invoke_iiiiiiiiiiii,
  /** @export */R: invoke_iij,
  /** @export */Z: invoke_iiji,
  /** @export */T: invoke_iji,
  /** @export */S: invoke_ijii,
  /** @export */U: invoke_ijiij,
  /** @export */P: invoke_j,
  /** @export */X: invoke_jiii,
  /** @export */j: invoke_v,
  /** @export */k: invoke_vi,
  /** @export */z: invoke_vid,
  /** @export */b: invoke_vii,
  /** @export */F: invoke_viid,
  /** @export */ia: invoke_viidi,
  /** @export */J: invoke_viif,
  /** @export */f: invoke_viii,
  /** @export */i: invoke_viiii,
  /** @export */p: invoke_viiiii,
  /** @export */x: invoke_viiiiii,
  /** @export */u: invoke_viiiiiii,
  /** @export */L: invoke_viiiiiiiii,
  /** @export */y: invoke_viiiiiiiiii,
  /** @export */A: invoke_viiiiiiiiiiiiiii,
  /** @export */_: invoke_viij,
  /** @export */W: invoke_viiji,
  /** @export */Y: invoke_vij,
  /** @export */Q: invoke_viji,
  /** @export */o: _llvm_eh_typeid_for,
  /** @export */la: _proc_exit
};
var wasmExports = createWasm();
var _wasm_call_ctors = function ___wasm_call_ctors() {
  return (_wasm_call_ctors = wasmExports["xa"])();
};
var _openmpt_get_library_version = Module["_openmpt_get_library_version"] = function () {
  return (_openmpt_get_library_version = Module["_openmpt_get_library_version"] = wasmExports["ya"])();
};
var __ZN7openmpt19get_library_versionEv = Module["__ZN7openmpt19get_library_versionEv"] = function () {
  return (__ZN7openmpt19get_library_versionEv = Module["__ZN7openmpt19get_library_versionEv"] = wasmExports["za"])();
};
var _openmpt_get_core_version = Module["_openmpt_get_core_version"] = function () {
  return (_openmpt_get_core_version = Module["_openmpt_get_core_version"] = wasmExports["Aa"])();
};
var __ZN7openmpt16get_core_versionEv = Module["__ZN7openmpt16get_core_versionEv"] = function () {
  return (__ZN7openmpt16get_core_versionEv = Module["__ZN7openmpt16get_core_versionEv"] = wasmExports["Ba"])();
};
var _openmpt_free_string = Module["_openmpt_free_string"] = function (a0) {
  return (_openmpt_free_string = Module["_openmpt_free_string"] = wasmExports["Ca"])(a0);
};
var _free = Module["_free"] = function (a0) {
  return (_free = Module["_free"] = wasmExports["Da"])(a0);
};
var _openmpt_get_string = Module["_openmpt_get_string"] = function (a0) {
  return (_openmpt_get_string = Module["_openmpt_get_string"] = wasmExports["Ea"])(a0);
};
var __ZN7openmpt6string3getERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE = Module["__ZN7openmpt6string3getERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE"] = function (a0, a1) {
  return (__ZN7openmpt6string3getERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE = Module["__ZN7openmpt6string3getERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE"] = wasmExports["Fa"])(a0, a1);
};
var _openmpt_get_supported_extensions = Module["_openmpt_get_supported_extensions"] = function () {
  return (_openmpt_get_supported_extensions = Module["_openmpt_get_supported_extensions"] = wasmExports["Ga"])();
};
var _openmpt_is_extension_supported = Module["_openmpt_is_extension_supported"] = function (a0) {
  return (_openmpt_is_extension_supported = Module["_openmpt_is_extension_supported"] = wasmExports["Ha"])(a0);
};
var _openmpt_log_func_default = Module["_openmpt_log_func_default"] = function (a0, a1) {
  return (_openmpt_log_func_default = Module["_openmpt_log_func_default"] = wasmExports["Ia"])(a0, a1);
};
var _openmpt_log_func_silent = Module["_openmpt_log_func_silent"] = function (a0, a1) {
  return (_openmpt_log_func_silent = Module["_openmpt_log_func_silent"] = wasmExports["Ja"])(a0, a1);
};
var _openmpt_error_is_transient = Module["_openmpt_error_is_transient"] = function (a0) {
  return (_openmpt_error_is_transient = Module["_openmpt_error_is_transient"] = wasmExports["Ka"])(a0);
};
var _openmpt_error_string = Module["_openmpt_error_string"] = function (a0) {
  return (_openmpt_error_string = Module["_openmpt_error_string"] = wasmExports["La"])(a0);
};
var _openmpt_error_func_default = Module["_openmpt_error_func_default"] = function (a0, a1) {
  return (_openmpt_error_func_default = Module["_openmpt_error_func_default"] = wasmExports["Ma"])(a0, a1);
};
var _openmpt_error_func_log = Module["_openmpt_error_func_log"] = function (a0, a1) {
  return (_openmpt_error_func_log = Module["_openmpt_error_func_log"] = wasmExports["Na"])(a0, a1);
};
var _openmpt_error_func_store = Module["_openmpt_error_func_store"] = function (a0, a1) {
  return (_openmpt_error_func_store = Module["_openmpt_error_func_store"] = wasmExports["Oa"])(a0, a1);
};
var _openmpt_error_func_ignore = Module["_openmpt_error_func_ignore"] = function (a0, a1) {
  return (_openmpt_error_func_ignore = Module["_openmpt_error_func_ignore"] = wasmExports["Pa"])(a0, a1);
};
var _openmpt_error_func_errno = Module["_openmpt_error_func_errno"] = function (a0, a1) {
  return (_openmpt_error_func_errno = Module["_openmpt_error_func_errno"] = wasmExports["Qa"])(a0, a1);
};
var _openmpt_error_func_errno_userdata = Module["_openmpt_error_func_errno_userdata"] = function (a0) {
  return (_openmpt_error_func_errno_userdata = Module["_openmpt_error_func_errno_userdata"] = wasmExports["Ra"])(a0);
};
var _openmpt_could_open_probability = Module["_openmpt_could_open_probability"] = function (a0, a1, a2, a3, a4) {
  return (_openmpt_could_open_probability = Module["_openmpt_could_open_probability"] = wasmExports["Sa"])(a0, a1, a2, a3, a4);
};
var _openmpt_could_open_probability2 = Module["_openmpt_could_open_probability2"] = function (a0, a1, a2, a3, a4, a5, a6, a7, a8) {
  return (_openmpt_could_open_probability2 = Module["_openmpt_could_open_probability2"] = wasmExports["Ta"])(a0, a1, a2, a3, a4, a5, a6, a7, a8);
};
var _openmpt_could_open_propability = Module["_openmpt_could_open_propability"] = function (a0, a1, a2, a3, a4) {
  return (_openmpt_could_open_propability = Module["_openmpt_could_open_propability"] = wasmExports["Ua"])(a0, a1, a2, a3, a4);
};
var _openmpt_probe_file_header_get_recommended_size = Module["_openmpt_probe_file_header_get_recommended_size"] = function () {
  return (_openmpt_probe_file_header_get_recommended_size = Module["_openmpt_probe_file_header_get_recommended_size"] = wasmExports["Va"])();
};
var _openmpt_probe_file_header = Module["_openmpt_probe_file_header"] = function (a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11) {
  return (_openmpt_probe_file_header = Module["_openmpt_probe_file_header"] = wasmExports["Wa"])(a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11);
};
var _openmpt_probe_file_header_without_filesize = Module["_openmpt_probe_file_header_without_filesize"] = function (a0, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
  return (_openmpt_probe_file_header_without_filesize = Module["_openmpt_probe_file_header_without_filesize"] = wasmExports["Xa"])(a0, a1, a2, a3, a4, a5, a6, a7, a8, a9);
};
var _openmpt_probe_file_header_from_stream = Module["_openmpt_probe_file_header_from_stream"] = function (a0, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
  return (_openmpt_probe_file_header_from_stream = Module["_openmpt_probe_file_header_from_stream"] = wasmExports["Ya"])(a0, a1, a2, a3, a4, a5, a6, a7, a8, a9);
};
var _openmpt_module_create = Module["_openmpt_module_create"] = function (a0, a1, a2, a3, a4) {
  return (_openmpt_module_create = Module["_openmpt_module_create"] = wasmExports["Za"])(a0, a1, a2, a3, a4);
};
var _openmpt_module_create2 = Module["_openmpt_module_create2"] = function (a0, a1, a2, a3, a4, a5, a6, a7, a8) {
  return (_openmpt_module_create2 = Module["_openmpt_module_create2"] = wasmExports["_a"])(a0, a1, a2, a3, a4, a5, a6, a7, a8);
};
var _openmpt_module_create_from_memory = Module["_openmpt_module_create_from_memory"] = function (a0, a1, a2, a3, a4) {
  return (_openmpt_module_create_from_memory = Module["_openmpt_module_create_from_memory"] = wasmExports["$a"])(a0, a1, a2, a3, a4);
};
var _openmpt_module_create_from_memory2 = Module["_openmpt_module_create_from_memory2"] = function (a0, a1, a2, a3, a4, a5, a6, a7, a8) {
  return (_openmpt_module_create_from_memory2 = Module["_openmpt_module_create_from_memory2"] = wasmExports["ab"])(a0, a1, a2, a3, a4, a5, a6, a7, a8);
};
var _openmpt_module_destroy = Module["_openmpt_module_destroy"] = function (a0) {
  return (_openmpt_module_destroy = Module["_openmpt_module_destroy"] = wasmExports["bb"])(a0);
};
var _openmpt_module_set_log_func = Module["_openmpt_module_set_log_func"] = function (a0, a1, a2) {
  return (_openmpt_module_set_log_func = Module["_openmpt_module_set_log_func"] = wasmExports["cb"])(a0, a1, a2);
};
var _openmpt_module_set_error_func = Module["_openmpt_module_set_error_func"] = function (a0, a1, a2) {
  return (_openmpt_module_set_error_func = Module["_openmpt_module_set_error_func"] = wasmExports["db"])(a0, a1, a2);
};
var _openmpt_module_error_get_last = Module["_openmpt_module_error_get_last"] = function (a0) {
  return (_openmpt_module_error_get_last = Module["_openmpt_module_error_get_last"] = wasmExports["eb"])(a0);
};
var _openmpt_module_error_get_last_message = Module["_openmpt_module_error_get_last_message"] = function (a0) {
  return (_openmpt_module_error_get_last_message = Module["_openmpt_module_error_get_last_message"] = wasmExports["fb"])(a0);
};
var _openmpt_module_error_set_last = Module["_openmpt_module_error_set_last"] = function (a0, a1) {
  return (_openmpt_module_error_set_last = Module["_openmpt_module_error_set_last"] = wasmExports["gb"])(a0, a1);
};
var _openmpt_module_error_clear = Module["_openmpt_module_error_clear"] = function (a0) {
  return (_openmpt_module_error_clear = Module["_openmpt_module_error_clear"] = wasmExports["hb"])(a0);
};
var _openmpt_module_select_subsong = Module["_openmpt_module_select_subsong"] = function (a0, a1) {
  return (_openmpt_module_select_subsong = Module["_openmpt_module_select_subsong"] = wasmExports["ib"])(a0, a1);
};
var _openmpt_module_get_selected_subsong = Module["_openmpt_module_get_selected_subsong"] = function (a0) {
  return (_openmpt_module_get_selected_subsong = Module["_openmpt_module_get_selected_subsong"] = wasmExports["jb"])(a0);
};
var _openmpt_module_set_repeat_count = Module["_openmpt_module_set_repeat_count"] = function (a0, a1) {
  return (_openmpt_module_set_repeat_count = Module["_openmpt_module_set_repeat_count"] = wasmExports["kb"])(a0, a1);
};
var _openmpt_module_get_repeat_count = Module["_openmpt_module_get_repeat_count"] = function (a0) {
  return (_openmpt_module_get_repeat_count = Module["_openmpt_module_get_repeat_count"] = wasmExports["lb"])(a0);
};
var _openmpt_module_get_duration_seconds = Module["_openmpt_module_get_duration_seconds"] = function (a0) {
  return (_openmpt_module_get_duration_seconds = Module["_openmpt_module_get_duration_seconds"] = wasmExports["mb"])(a0);
};
var _openmpt_module_set_position_seconds = Module["_openmpt_module_set_position_seconds"] = function (a0, a1) {
  return (_openmpt_module_set_position_seconds = Module["_openmpt_module_set_position_seconds"] = wasmExports["nb"])(a0, a1);
};
var _openmpt_module_get_position_seconds = Module["_openmpt_module_get_position_seconds"] = function (a0) {
  return (_openmpt_module_get_position_seconds = Module["_openmpt_module_get_position_seconds"] = wasmExports["ob"])(a0);
};
var _openmpt_module_set_position_order_row = Module["_openmpt_module_set_position_order_row"] = function (a0, a1, a2) {
  return (_openmpt_module_set_position_order_row = Module["_openmpt_module_set_position_order_row"] = wasmExports["pb"])(a0, a1, a2);
};
var _openmpt_module_get_render_param = Module["_openmpt_module_get_render_param"] = function (a0, a1, a2) {
  return (_openmpt_module_get_render_param = Module["_openmpt_module_get_render_param"] = wasmExports["qb"])(a0, a1, a2);
};
var _openmpt_module_set_render_param = Module["_openmpt_module_set_render_param"] = function (a0, a1, a2) {
  return (_openmpt_module_set_render_param = Module["_openmpt_module_set_render_param"] = wasmExports["rb"])(a0, a1, a2);
};
var _openmpt_module_read_mono = Module["_openmpt_module_read_mono"] = function (a0, a1, a2, a3) {
  return (_openmpt_module_read_mono = Module["_openmpt_module_read_mono"] = wasmExports["sb"])(a0, a1, a2, a3);
};
var _openmpt_module_read_stereo = Module["_openmpt_module_read_stereo"] = function (a0, a1, a2, a3, a4) {
  return (_openmpt_module_read_stereo = Module["_openmpt_module_read_stereo"] = wasmExports["tb"])(a0, a1, a2, a3, a4);
};
var _openmpt_module_read_quad = Module["_openmpt_module_read_quad"] = function (a0, a1, a2, a3, a4, a5, a6) {
  return (_openmpt_module_read_quad = Module["_openmpt_module_read_quad"] = wasmExports["ub"])(a0, a1, a2, a3, a4, a5, a6);
};
var _openmpt_module_read_float_mono = Module["_openmpt_module_read_float_mono"] = function (a0, a1, a2, a3) {
  return (_openmpt_module_read_float_mono = Module["_openmpt_module_read_float_mono"] = wasmExports["vb"])(a0, a1, a2, a3);
};
var _openmpt_module_read_float_stereo = Module["_openmpt_module_read_float_stereo"] = function (a0, a1, a2, a3, a4) {
  return (_openmpt_module_read_float_stereo = Module["_openmpt_module_read_float_stereo"] = wasmExports["wb"])(a0, a1, a2, a3, a4);
};
var _openmpt_module_read_float_quad = Module["_openmpt_module_read_float_quad"] = function (a0, a1, a2, a3, a4, a5, a6) {
  return (_openmpt_module_read_float_quad = Module["_openmpt_module_read_float_quad"] = wasmExports["xb"])(a0, a1, a2, a3, a4, a5, a6);
};
var _openmpt_module_read_interleaved_stereo = Module["_openmpt_module_read_interleaved_stereo"] = function (a0, a1, a2, a3) {
  return (_openmpt_module_read_interleaved_stereo = Module["_openmpt_module_read_interleaved_stereo"] = wasmExports["yb"])(a0, a1, a2, a3);
};
var _openmpt_module_read_interleaved_quad = Module["_openmpt_module_read_interleaved_quad"] = function (a0, a1, a2, a3) {
  return (_openmpt_module_read_interleaved_quad = Module["_openmpt_module_read_interleaved_quad"] = wasmExports["zb"])(a0, a1, a2, a3);
};
var _openmpt_module_read_interleaved_float_stereo = Module["_openmpt_module_read_interleaved_float_stereo"] = function (a0, a1, a2, a3) {
  return (_openmpt_module_read_interleaved_float_stereo = Module["_openmpt_module_read_interleaved_float_stereo"] = wasmExports["Ab"])(a0, a1, a2, a3);
};
var _openmpt_module_read_interleaved_float_quad = Module["_openmpt_module_read_interleaved_float_quad"] = function (a0, a1, a2, a3) {
  return (_openmpt_module_read_interleaved_float_quad = Module["_openmpt_module_read_interleaved_float_quad"] = wasmExports["Bb"])(a0, a1, a2, a3);
};
var _openmpt_module_get_metadata_keys = Module["_openmpt_module_get_metadata_keys"] = function (a0) {
  return (_openmpt_module_get_metadata_keys = Module["_openmpt_module_get_metadata_keys"] = wasmExports["Cb"])(a0);
};
var _openmpt_module_get_metadata = Module["_openmpt_module_get_metadata"] = function (a0, a1) {
  return (_openmpt_module_get_metadata = Module["_openmpt_module_get_metadata"] = wasmExports["Db"])(a0, a1);
};
var _openmpt_module_get_current_estimated_bpm = Module["_openmpt_module_get_current_estimated_bpm"] = function (a0) {
  return (_openmpt_module_get_current_estimated_bpm = Module["_openmpt_module_get_current_estimated_bpm"] = wasmExports["Eb"])(a0);
};
var _openmpt_module_get_current_speed = Module["_openmpt_module_get_current_speed"] = function (a0) {
  return (_openmpt_module_get_current_speed = Module["_openmpt_module_get_current_speed"] = wasmExports["Fb"])(a0);
};
var _openmpt_module_get_current_tempo = Module["_openmpt_module_get_current_tempo"] = function (a0) {
  return (_openmpt_module_get_current_tempo = Module["_openmpt_module_get_current_tempo"] = wasmExports["Gb"])(a0);
};
var _openmpt_module_get_current_tempo2 = Module["_openmpt_module_get_current_tempo2"] = function (a0) {
  return (_openmpt_module_get_current_tempo2 = Module["_openmpt_module_get_current_tempo2"] = wasmExports["Hb"])(a0);
};
var _openmpt_module_get_current_order = Module["_openmpt_module_get_current_order"] = function (a0) {
  return (_openmpt_module_get_current_order = Module["_openmpt_module_get_current_order"] = wasmExports["Ib"])(a0);
};
var _openmpt_module_get_current_pattern = Module["_openmpt_module_get_current_pattern"] = function (a0) {
  return (_openmpt_module_get_current_pattern = Module["_openmpt_module_get_current_pattern"] = wasmExports["Jb"])(a0);
};
var _openmpt_module_get_current_row = Module["_openmpt_module_get_current_row"] = function (a0) {
  return (_openmpt_module_get_current_row = Module["_openmpt_module_get_current_row"] = wasmExports["Kb"])(a0);
};
var _openmpt_module_get_current_playing_channels = Module["_openmpt_module_get_current_playing_channels"] = function (a0) {
  return (_openmpt_module_get_current_playing_channels = Module["_openmpt_module_get_current_playing_channels"] = wasmExports["Lb"])(a0);
};
var _openmpt_module_get_current_channel_vu_mono = Module["_openmpt_module_get_current_channel_vu_mono"] = function (a0, a1) {
  return (_openmpt_module_get_current_channel_vu_mono = Module["_openmpt_module_get_current_channel_vu_mono"] = wasmExports["Mb"])(a0, a1);
};
var _openmpt_module_get_current_channel_vu_left = Module["_openmpt_module_get_current_channel_vu_left"] = function (a0, a1) {
  return (_openmpt_module_get_current_channel_vu_left = Module["_openmpt_module_get_current_channel_vu_left"] = wasmExports["Nb"])(a0, a1);
};
var _openmpt_module_get_current_channel_vu_right = Module["_openmpt_module_get_current_channel_vu_right"] = function (a0, a1) {
  return (_openmpt_module_get_current_channel_vu_right = Module["_openmpt_module_get_current_channel_vu_right"] = wasmExports["Ob"])(a0, a1);
};
var _openmpt_module_get_current_channel_vu_rear_left = Module["_openmpt_module_get_current_channel_vu_rear_left"] = function (a0, a1) {
  return (_openmpt_module_get_current_channel_vu_rear_left = Module["_openmpt_module_get_current_channel_vu_rear_left"] = wasmExports["Pb"])(a0, a1);
};
var _openmpt_module_get_current_channel_vu_rear_right = Module["_openmpt_module_get_current_channel_vu_rear_right"] = function (a0, a1) {
  return (_openmpt_module_get_current_channel_vu_rear_right = Module["_openmpt_module_get_current_channel_vu_rear_right"] = wasmExports["Qb"])(a0, a1);
};
var _openmpt_module_get_num_subsongs = Module["_openmpt_module_get_num_subsongs"] = function (a0) {
  return (_openmpt_module_get_num_subsongs = Module["_openmpt_module_get_num_subsongs"] = wasmExports["Rb"])(a0);
};
var _openmpt_module_get_num_channels = Module["_openmpt_module_get_num_channels"] = function (a0) {
  return (_openmpt_module_get_num_channels = Module["_openmpt_module_get_num_channels"] = wasmExports["Sb"])(a0);
};
var _openmpt_module_get_num_orders = Module["_openmpt_module_get_num_orders"] = function (a0) {
  return (_openmpt_module_get_num_orders = Module["_openmpt_module_get_num_orders"] = wasmExports["Tb"])(a0);
};
var _openmpt_module_get_num_patterns = Module["_openmpt_module_get_num_patterns"] = function (a0) {
  return (_openmpt_module_get_num_patterns = Module["_openmpt_module_get_num_patterns"] = wasmExports["Ub"])(a0);
};
var _openmpt_module_get_num_instruments = Module["_openmpt_module_get_num_instruments"] = function (a0) {
  return (_openmpt_module_get_num_instruments = Module["_openmpt_module_get_num_instruments"] = wasmExports["Vb"])(a0);
};
var _openmpt_module_get_num_samples = Module["_openmpt_module_get_num_samples"] = function (a0) {
  return (_openmpt_module_get_num_samples = Module["_openmpt_module_get_num_samples"] = wasmExports["Wb"])(a0);
};
var _openmpt_module_get_subsong_name = Module["_openmpt_module_get_subsong_name"] = function (a0, a1) {
  return (_openmpt_module_get_subsong_name = Module["_openmpt_module_get_subsong_name"] = wasmExports["Xb"])(a0, a1);
};
var _openmpt_module_get_channel_name = Module["_openmpt_module_get_channel_name"] = function (a0, a1) {
  return (_openmpt_module_get_channel_name = Module["_openmpt_module_get_channel_name"] = wasmExports["Yb"])(a0, a1);
};
var _openmpt_module_get_order_name = Module["_openmpt_module_get_order_name"] = function (a0, a1) {
  return (_openmpt_module_get_order_name = Module["_openmpt_module_get_order_name"] = wasmExports["Zb"])(a0, a1);
};
var _openmpt_module_get_pattern_name = Module["_openmpt_module_get_pattern_name"] = function (a0, a1) {
  return (_openmpt_module_get_pattern_name = Module["_openmpt_module_get_pattern_name"] = wasmExports["_b"])(a0, a1);
};
var _openmpt_module_get_instrument_name = Module["_openmpt_module_get_instrument_name"] = function (a0, a1) {
  return (_openmpt_module_get_instrument_name = Module["_openmpt_module_get_instrument_name"] = wasmExports["$b"])(a0, a1);
};
var _openmpt_module_get_sample_name = Module["_openmpt_module_get_sample_name"] = function (a0, a1) {
  return (_openmpt_module_get_sample_name = Module["_openmpt_module_get_sample_name"] = wasmExports["ac"])(a0, a1);
};
var _openmpt_module_get_order_pattern = Module["_openmpt_module_get_order_pattern"] = function (a0, a1) {
  return (_openmpt_module_get_order_pattern = Module["_openmpt_module_get_order_pattern"] = wasmExports["bc"])(a0, a1);
};
var _openmpt_module_get_pattern_num_rows = Module["_openmpt_module_get_pattern_num_rows"] = function (a0, a1) {
  return (_openmpt_module_get_pattern_num_rows = Module["_openmpt_module_get_pattern_num_rows"] = wasmExports["cc"])(a0, a1);
};
var _openmpt_module_get_pattern_row_channel_command = Module["_openmpt_module_get_pattern_row_channel_command"] = function (a0, a1, a2, a3, a4) {
  return (_openmpt_module_get_pattern_row_channel_command = Module["_openmpt_module_get_pattern_row_channel_command"] = wasmExports["dc"])(a0, a1, a2, a3, a4);
};
var _openmpt_module_format_pattern_row_channel_command = Module["_openmpt_module_format_pattern_row_channel_command"] = function (a0, a1, a2, a3, a4) {
  return (_openmpt_module_format_pattern_row_channel_command = Module["_openmpt_module_format_pattern_row_channel_command"] = wasmExports["ec"])(a0, a1, a2, a3, a4);
};
var _openmpt_module_highlight_pattern_row_channel_command = Module["_openmpt_module_highlight_pattern_row_channel_command"] = function (a0, a1, a2, a3, a4) {
  return (_openmpt_module_highlight_pattern_row_channel_command = Module["_openmpt_module_highlight_pattern_row_channel_command"] = wasmExports["fc"])(a0, a1, a2, a3, a4);
};
var _openmpt_module_format_pattern_row_channel = Module["_openmpt_module_format_pattern_row_channel"] = function (a0, a1, a2, a3, a4, a5) {
  return (_openmpt_module_format_pattern_row_channel = Module["_openmpt_module_format_pattern_row_channel"] = wasmExports["gc"])(a0, a1, a2, a3, a4, a5);
};
var _openmpt_module_highlight_pattern_row_channel = Module["_openmpt_module_highlight_pattern_row_channel"] = function (a0, a1, a2, a3, a4, a5) {
  return (_openmpt_module_highlight_pattern_row_channel = Module["_openmpt_module_highlight_pattern_row_channel"] = wasmExports["hc"])(a0, a1, a2, a3, a4, a5);
};
var _openmpt_module_get_ctls = Module["_openmpt_module_get_ctls"] = function (a0) {
  return (_openmpt_module_get_ctls = Module["_openmpt_module_get_ctls"] = wasmExports["ic"])(a0);
};
var _openmpt_module_ctl_get = Module["_openmpt_module_ctl_get"] = function (a0, a1) {
  return (_openmpt_module_ctl_get = Module["_openmpt_module_ctl_get"] = wasmExports["jc"])(a0, a1);
};
var _openmpt_module_ctl_get_boolean = Module["_openmpt_module_ctl_get_boolean"] = function (a0, a1) {
  return (_openmpt_module_ctl_get_boolean = Module["_openmpt_module_ctl_get_boolean"] = wasmExports["kc"])(a0, a1);
};
var _openmpt_module_ctl_get_integer = Module["_openmpt_module_ctl_get_integer"] = function (a0, a1) {
  return (_openmpt_module_ctl_get_integer = Module["_openmpt_module_ctl_get_integer"] = wasmExports["lc"])(a0, a1);
};
var _openmpt_module_ctl_get_floatingpoint = Module["_openmpt_module_ctl_get_floatingpoint"] = function (a0, a1) {
  return (_openmpt_module_ctl_get_floatingpoint = Module["_openmpt_module_ctl_get_floatingpoint"] = wasmExports["mc"])(a0, a1);
};
var _openmpt_module_ctl_get_text = Module["_openmpt_module_ctl_get_text"] = function (a0, a1) {
  return (_openmpt_module_ctl_get_text = Module["_openmpt_module_ctl_get_text"] = wasmExports["nc"])(a0, a1);
};
var _openmpt_module_ctl_set = Module["_openmpt_module_ctl_set"] = function (a0, a1, a2) {
  return (_openmpt_module_ctl_set = Module["_openmpt_module_ctl_set"] = wasmExports["oc"])(a0, a1, a2);
};
var _openmpt_module_ctl_set_boolean = Module["_openmpt_module_ctl_set_boolean"] = function (a0, a1, a2) {
  return (_openmpt_module_ctl_set_boolean = Module["_openmpt_module_ctl_set_boolean"] = wasmExports["pc"])(a0, a1, a2);
};
var _openmpt_module_ctl_set_integer = Module["_openmpt_module_ctl_set_integer"] = function (a0, a1, a2, a3) {
  return (_openmpt_module_ctl_set_integer = Module["_openmpt_module_ctl_set_integer"] = wasmExports["qc"])(a0, a1, a2, a3);
};
var _openmpt_module_ctl_set_floatingpoint = Module["_openmpt_module_ctl_set_floatingpoint"] = function (a0, a1, a2) {
  return (_openmpt_module_ctl_set_floatingpoint = Module["_openmpt_module_ctl_set_floatingpoint"] = wasmExports["rc"])(a0, a1, a2);
};
var _openmpt_module_ctl_set_text = Module["_openmpt_module_ctl_set_text"] = function (a0, a1, a2) {
  return (_openmpt_module_ctl_set_text = Module["_openmpt_module_ctl_set_text"] = wasmExports["sc"])(a0, a1, a2);
};
var _openmpt_module_ext_create = Module["_openmpt_module_ext_create"] = function (a0, a1, a2, a3, a4, a5, a6, a7, a8) {
  return (_openmpt_module_ext_create = Module["_openmpt_module_ext_create"] = wasmExports["tc"])(a0, a1, a2, a3, a4, a5, a6, a7, a8);
};
var _openmpt_module_ext_create_from_memory = Module["_openmpt_module_ext_create_from_memory"] = function (a0, a1, a2, a3, a4, a5, a6, a7, a8) {
  return (_openmpt_module_ext_create_from_memory = Module["_openmpt_module_ext_create_from_memory"] = wasmExports["uc"])(a0, a1, a2, a3, a4, a5, a6, a7, a8);
};
var _openmpt_module_ext_destroy = Module["_openmpt_module_ext_destroy"] = function (a0) {
  return (_openmpt_module_ext_destroy = Module["_openmpt_module_ext_destroy"] = wasmExports["vc"])(a0);
};
var _openmpt_module_ext_get_module = Module["_openmpt_module_ext_get_module"] = function (a0) {
  return (_openmpt_module_ext_get_module = Module["_openmpt_module_ext_get_module"] = wasmExports["wc"])(a0);
};
var _openmpt_module_ext_get_interface = Module["_openmpt_module_ext_get_interface"] = function (a0, a1, a2, a3) {
  return (_openmpt_module_ext_get_interface = Module["_openmpt_module_ext_get_interface"] = wasmExports["xc"])(a0, a1, a2, a3);
};
var __ZN7openmpt9exceptionC2ERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE = Module["__ZN7openmpt9exceptionC2ERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE"] = function (a0, a1) {
  return (__ZN7openmpt9exceptionC2ERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE = Module["__ZN7openmpt9exceptionC2ERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE"] = wasmExports["yc"])(a0, a1);
};
var __ZNK7openmpt9exception4whatEv = Module["__ZNK7openmpt9exception4whatEv"] = function (a0) {
  return (__ZNK7openmpt9exception4whatEv = Module["__ZNK7openmpt9exception4whatEv"] = wasmExports["zc"])(a0);
};
var __ZN7openmpt9exceptionD2Ev = Module["__ZN7openmpt9exceptionD2Ev"] = function (a0) {
  return (__ZN7openmpt9exceptionD2Ev = Module["__ZN7openmpt9exceptionD2Ev"] = wasmExports["Ac"])(a0);
};
var _malloc = Module["_malloc"] = function (a0) {
  return (_malloc = Module["_malloc"] = wasmExports["Bc"])(a0);
};
var __ZN7openmpt9exceptionC2ERKS0_ = Module["__ZN7openmpt9exceptionC2ERKS0_"] = function (a0, a1) {
  return (__ZN7openmpt9exceptionC2ERKS0_ = Module["__ZN7openmpt9exceptionC2ERKS0_"] = wasmExports["Cc"])(a0, a1);
};
var __ZN7openmpt9exceptionC2EOS0_ = Module["__ZN7openmpt9exceptionC2EOS0_"] = function (a0, a1) {
  return (__ZN7openmpt9exceptionC2EOS0_ = Module["__ZN7openmpt9exceptionC2EOS0_"] = wasmExports["Dc"])(a0, a1);
};
var __ZN7openmpt9exceptionaSERKS0_ = Module["__ZN7openmpt9exceptionaSERKS0_"] = function (a0, a1) {
  return (__ZN7openmpt9exceptionaSERKS0_ = Module["__ZN7openmpt9exceptionaSERKS0_"] = wasmExports["Ec"])(a0, a1);
};
var __ZN7openmpt9exceptionaSEOS0_ = Module["__ZN7openmpt9exceptionaSEOS0_"] = function (a0, a1) {
  return (__ZN7openmpt9exceptionaSEOS0_ = Module["__ZN7openmpt9exceptionaSEOS0_"] = wasmExports["Fc"])(a0, a1);
};
var __ZN7openmpt9exceptionD0Ev = Module["__ZN7openmpt9exceptionD0Ev"] = function (a0) {
  return (__ZN7openmpt9exceptionD0Ev = Module["__ZN7openmpt9exceptionD0Ev"] = wasmExports["Gc"])(a0);
};
var __ZN7openmpt24get_supported_extensionsEv = Module["__ZN7openmpt24get_supported_extensionsEv"] = function (a0) {
  return (__ZN7openmpt24get_supported_extensionsEv = Module["__ZN7openmpt24get_supported_extensionsEv"] = wasmExports["Hc"])(a0);
};
var __ZN7openmpt22is_extension_supportedERKNSt3__212basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEE = Module["__ZN7openmpt22is_extension_supportedERKNSt3__212basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEE"] = function (a0) {
  return (__ZN7openmpt22is_extension_supportedERKNSt3__212basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEE = Module["__ZN7openmpt22is_extension_supportedERKNSt3__212basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEE"] = wasmExports["Ic"])(a0);
};
var __ZN7openmpt23is_extension_supported2ENSt3__217basic_string_viewIcNS0_11char_traitsIcEEEE = Module["__ZN7openmpt23is_extension_supported2ENSt3__217basic_string_viewIcNS0_11char_traitsIcEEEE"] = function (a0) {
  return (__ZN7openmpt23is_extension_supported2ENSt3__217basic_string_viewIcNS0_11char_traitsIcEEEE = Module["__ZN7openmpt23is_extension_supported2ENSt3__217basic_string_viewIcNS0_11char_traitsIcEEEE"] = wasmExports["Jc"])(a0);
};
var __ZN7openmpt22could_open_probabilityERNSt3__213basic_istreamIcNS0_11char_traitsIcEEEEdRNS0_13basic_ostreamIcS3_EE = Module["__ZN7openmpt22could_open_probabilityERNSt3__213basic_istreamIcNS0_11char_traitsIcEEEEdRNS0_13basic_ostreamIcS3_EE"] = function (a0, a1, a2) {
  return (__ZN7openmpt22could_open_probabilityERNSt3__213basic_istreamIcNS0_11char_traitsIcEEEEdRNS0_13basic_ostreamIcS3_EE = Module["__ZN7openmpt22could_open_probabilityERNSt3__213basic_istreamIcNS0_11char_traitsIcEEEEdRNS0_13basic_ostreamIcS3_EE"] = wasmExports["Kc"])(a0, a1, a2);
};
var __ZN7openmpt22could_open_propabilityERNSt3__213basic_istreamIcNS0_11char_traitsIcEEEEdRNS0_13basic_ostreamIcS3_EE = Module["__ZN7openmpt22could_open_propabilityERNSt3__213basic_istreamIcNS0_11char_traitsIcEEEEdRNS0_13basic_ostreamIcS3_EE"] = function (a0, a1, a2) {
  return (__ZN7openmpt22could_open_propabilityERNSt3__213basic_istreamIcNS0_11char_traitsIcEEEEdRNS0_13basic_ostreamIcS3_EE = Module["__ZN7openmpt22could_open_propabilityERNSt3__213basic_istreamIcNS0_11char_traitsIcEEEEdRNS0_13basic_ostreamIcS3_EE"] = wasmExports["Lc"])(a0, a1, a2);
};
var __ZN7openmpt38probe_file_header_get_recommended_sizeEv = Module["__ZN7openmpt38probe_file_header_get_recommended_sizeEv"] = function () {
  return (__ZN7openmpt38probe_file_header_get_recommended_sizeEv = Module["__ZN7openmpt38probe_file_header_get_recommended_sizeEv"] = wasmExports["Mc"])();
};
var __ZN7openmpt17probe_file_headerEyPKSt4bytemy = Module["__ZN7openmpt17probe_file_headerEyPKSt4bytemy"] = function (a0, a1, a2, a3, a4, a5) {
  return (__ZN7openmpt17probe_file_headerEyPKSt4bytemy = Module["__ZN7openmpt17probe_file_headerEyPKSt4bytemy"] = wasmExports["Nc"])(a0, a1, a2, a3, a4, a5);
};
var __ZN7openmpt17probe_file_headerEyPKhmy = Module["__ZN7openmpt17probe_file_headerEyPKhmy"] = function (a0, a1, a2, a3, a4, a5) {
  return (__ZN7openmpt17probe_file_headerEyPKhmy = Module["__ZN7openmpt17probe_file_headerEyPKhmy"] = wasmExports["Oc"])(a0, a1, a2, a3, a4, a5);
};
var __ZN7openmpt17probe_file_headerEyPKSt4bytem = Module["__ZN7openmpt17probe_file_headerEyPKSt4bytem"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt17probe_file_headerEyPKSt4bytem = Module["__ZN7openmpt17probe_file_headerEyPKSt4bytem"] = wasmExports["Pc"])(a0, a1, a2, a3);
};
var __ZN7openmpt17probe_file_headerEyPKhm = Module["__ZN7openmpt17probe_file_headerEyPKhm"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt17probe_file_headerEyPKhm = Module["__ZN7openmpt17probe_file_headerEyPKhm"] = wasmExports["Qc"])(a0, a1, a2, a3);
};
var __ZN7openmpt17probe_file_headerEyRNSt3__213basic_istreamIcNS0_11char_traitsIcEEEE = Module["__ZN7openmpt17probe_file_headerEyRNSt3__213basic_istreamIcNS0_11char_traitsIcEEEE"] = function (a0, a1, a2) {
  return (__ZN7openmpt17probe_file_headerEyRNSt3__213basic_istreamIcNS0_11char_traitsIcEEEE = Module["__ZN7openmpt17probe_file_headerEyRNSt3__213basic_istreamIcNS0_11char_traitsIcEEEE"] = wasmExports["Rc"])(a0, a1, a2);
};
var __ZN7openmpt6moduleC2ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt6moduleC2ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6moduleC2ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt6moduleC2ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE"] = wasmExports["Sc"])(a0, a1, a2, a3);
};
var __ZN7openmpt6moduleC2ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE = Module["__ZN7openmpt6moduleC2ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6moduleC2ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE = Module["__ZN7openmpt6moduleC2ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE"] = wasmExports["Tc"])(a0, a1, a2, a3);
};
var __ZN7openmpt6moduleC2EPKSt4byteS3_RNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt6moduleC2EPKSt4byteS3_RNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6moduleC2EPKSt4byteS3_RNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt6moduleC2EPKSt4byteS3_RNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE"] = wasmExports["Uc"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6moduleC2EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt6moduleC2EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6moduleC2EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt6moduleC2EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE"] = wasmExports["Vc"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6moduleC2ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE = Module["__ZN7openmpt6moduleC2ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6moduleC2ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE = Module["__ZN7openmpt6moduleC2ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE"] = wasmExports["Wc"])(a0, a1, a2, a3);
};
var __ZN7openmpt6moduleC2EPKhS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC2EPKhS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6moduleC2EPKhS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC2EPKhS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["Xc"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6moduleC2EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC2EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6moduleC2EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC2EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["Yc"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6moduleC2ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE = Module["__ZN7openmpt6moduleC2ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6moduleC2ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE = Module["__ZN7openmpt6moduleC2ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE"] = wasmExports["Zc"])(a0, a1, a2, a3);
};
var __ZN7openmpt6moduleC2EPKcS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC2EPKcS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6moduleC2EPKcS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC2EPKcS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["_c"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6moduleC2EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC2EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6moduleC2EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC2EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["$c"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6moduleC2EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC2EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6moduleC2EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC2EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["ad"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6moduleD2Ev = Module["__ZN7openmpt6moduleD2Ev"] = function (a0) {
  return (__ZN7openmpt6moduleD2Ev = Module["__ZN7openmpt6moduleD2Ev"] = wasmExports["bd"])(a0);
};
var __ZN7openmpt6moduleD0Ev = Module["__ZN7openmpt6moduleD0Ev"] = function (a0) {
  return (__ZN7openmpt6moduleD0Ev = Module["__ZN7openmpt6moduleD0Ev"] = wasmExports["cd"])(a0);
};
var __ZN7openmpt6module14select_subsongEi = Module["__ZN7openmpt6module14select_subsongEi"] = function (a0, a1) {
  return (__ZN7openmpt6module14select_subsongEi = Module["__ZN7openmpt6module14select_subsongEi"] = wasmExports["dd"])(a0, a1);
};
var __ZNK7openmpt6module20get_selected_subsongEv = Module["__ZNK7openmpt6module20get_selected_subsongEv"] = function (a0) {
  return (__ZNK7openmpt6module20get_selected_subsongEv = Module["__ZNK7openmpt6module20get_selected_subsongEv"] = wasmExports["ed"])(a0);
};
var __ZN7openmpt6module16set_repeat_countEi = Module["__ZN7openmpt6module16set_repeat_countEi"] = function (a0, a1) {
  return (__ZN7openmpt6module16set_repeat_countEi = Module["__ZN7openmpt6module16set_repeat_countEi"] = wasmExports["fd"])(a0, a1);
};
var __ZNK7openmpt6module16get_repeat_countEv = Module["__ZNK7openmpt6module16get_repeat_countEv"] = function (a0) {
  return (__ZNK7openmpt6module16get_repeat_countEv = Module["__ZNK7openmpt6module16get_repeat_countEv"] = wasmExports["gd"])(a0);
};
var __ZNK7openmpt6module20get_duration_secondsEv = Module["__ZNK7openmpt6module20get_duration_secondsEv"] = function (a0) {
  return (__ZNK7openmpt6module20get_duration_secondsEv = Module["__ZNK7openmpt6module20get_duration_secondsEv"] = wasmExports["hd"])(a0);
};
var __ZN7openmpt6module20set_position_secondsEd = Module["__ZN7openmpt6module20set_position_secondsEd"] = function (a0, a1) {
  return (__ZN7openmpt6module20set_position_secondsEd = Module["__ZN7openmpt6module20set_position_secondsEd"] = wasmExports["id"])(a0, a1);
};
var __ZNK7openmpt6module20get_position_secondsEv = Module["__ZNK7openmpt6module20get_position_secondsEv"] = function (a0) {
  return (__ZNK7openmpt6module20get_position_secondsEv = Module["__ZNK7openmpt6module20get_position_secondsEv"] = wasmExports["jd"])(a0);
};
var __ZN7openmpt6module22set_position_order_rowEii = Module["__ZN7openmpt6module22set_position_order_rowEii"] = function (a0, a1, a2) {
  return (__ZN7openmpt6module22set_position_order_rowEii = Module["__ZN7openmpt6module22set_position_order_rowEii"] = wasmExports["kd"])(a0, a1, a2);
};
var __ZNK7openmpt6module16get_render_paramEi = Module["__ZNK7openmpt6module16get_render_paramEi"] = function (a0, a1) {
  return (__ZNK7openmpt6module16get_render_paramEi = Module["__ZNK7openmpt6module16get_render_paramEi"] = wasmExports["ld"])(a0, a1);
};
var __ZN7openmpt6module16set_render_paramEii = Module["__ZN7openmpt6module16set_render_paramEii"] = function (a0, a1, a2) {
  return (__ZN7openmpt6module16set_render_paramEii = Module["__ZN7openmpt6module16set_render_paramEii"] = wasmExports["md"])(a0, a1, a2);
};
var __ZN7openmpt6module4readEimPs = Module["__ZN7openmpt6module4readEimPs"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6module4readEimPs = Module["__ZN7openmpt6module4readEimPs"] = wasmExports["nd"])(a0, a1, a2, a3);
};
var __ZN7openmpt6module4readEimPsS1_ = Module["__ZN7openmpt6module4readEimPsS1_"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6module4readEimPsS1_ = Module["__ZN7openmpt6module4readEimPsS1_"] = wasmExports["od"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6module4readEimPsS1_S1_S1_ = Module["__ZN7openmpt6module4readEimPsS1_S1_S1_"] = function (a0, a1, a2, a3, a4, a5, a6) {
  return (__ZN7openmpt6module4readEimPsS1_S1_S1_ = Module["__ZN7openmpt6module4readEimPsS1_S1_S1_"] = wasmExports["pd"])(a0, a1, a2, a3, a4, a5, a6);
};
var __ZN7openmpt6module4readEimPf = Module["__ZN7openmpt6module4readEimPf"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6module4readEimPf = Module["__ZN7openmpt6module4readEimPf"] = wasmExports["qd"])(a0, a1, a2, a3);
};
var __ZN7openmpt6module4readEimPfS1_ = Module["__ZN7openmpt6module4readEimPfS1_"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6module4readEimPfS1_ = Module["__ZN7openmpt6module4readEimPfS1_"] = wasmExports["rd"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6module4readEimPfS1_S1_S1_ = Module["__ZN7openmpt6module4readEimPfS1_S1_S1_"] = function (a0, a1, a2, a3, a4, a5, a6) {
  return (__ZN7openmpt6module4readEimPfS1_S1_S1_ = Module["__ZN7openmpt6module4readEimPfS1_S1_S1_"] = wasmExports["sd"])(a0, a1, a2, a3, a4, a5, a6);
};
var __ZN7openmpt6module23read_interleaved_stereoEimPs = Module["__ZN7openmpt6module23read_interleaved_stereoEimPs"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6module23read_interleaved_stereoEimPs = Module["__ZN7openmpt6module23read_interleaved_stereoEimPs"] = wasmExports["td"])(a0, a1, a2, a3);
};
var __ZN7openmpt6module21read_interleaved_quadEimPs = Module["__ZN7openmpt6module21read_interleaved_quadEimPs"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6module21read_interleaved_quadEimPs = Module["__ZN7openmpt6module21read_interleaved_quadEimPs"] = wasmExports["ud"])(a0, a1, a2, a3);
};
var __ZN7openmpt6module23read_interleaved_stereoEimPf = Module["__ZN7openmpt6module23read_interleaved_stereoEimPf"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6module23read_interleaved_stereoEimPf = Module["__ZN7openmpt6module23read_interleaved_stereoEimPf"] = wasmExports["vd"])(a0, a1, a2, a3);
};
var __ZN7openmpt6module21read_interleaved_quadEimPf = Module["__ZN7openmpt6module21read_interleaved_quadEimPf"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6module21read_interleaved_quadEimPf = Module["__ZN7openmpt6module21read_interleaved_quadEimPf"] = wasmExports["wd"])(a0, a1, a2, a3);
};
var __ZNK7openmpt6module17get_metadata_keysEv = Module["__ZNK7openmpt6module17get_metadata_keysEv"] = function (a0, a1) {
  return (__ZNK7openmpt6module17get_metadata_keysEv = Module["__ZNK7openmpt6module17get_metadata_keysEv"] = wasmExports["xd"])(a0, a1);
};
var __ZNK7openmpt6module12get_metadataERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE = Module["__ZNK7openmpt6module12get_metadataERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE"] = function (a0, a1, a2) {
  return (__ZNK7openmpt6module12get_metadataERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE = Module["__ZNK7openmpt6module12get_metadataERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE"] = wasmExports["yd"])(a0, a1, a2);
};
var __ZNK7openmpt6module25get_current_estimated_bpmEv = Module["__ZNK7openmpt6module25get_current_estimated_bpmEv"] = function (a0) {
  return (__ZNK7openmpt6module25get_current_estimated_bpmEv = Module["__ZNK7openmpt6module25get_current_estimated_bpmEv"] = wasmExports["zd"])(a0);
};
var __ZNK7openmpt6module17get_current_speedEv = Module["__ZNK7openmpt6module17get_current_speedEv"] = function (a0) {
  return (__ZNK7openmpt6module17get_current_speedEv = Module["__ZNK7openmpt6module17get_current_speedEv"] = wasmExports["Ad"])(a0);
};
var __ZNK7openmpt6module17get_current_tempoEv = Module["__ZNK7openmpt6module17get_current_tempoEv"] = function (a0) {
  return (__ZNK7openmpt6module17get_current_tempoEv = Module["__ZNK7openmpt6module17get_current_tempoEv"] = wasmExports["Bd"])(a0);
};
var __ZNK7openmpt6module18get_current_tempo2Ev = Module["__ZNK7openmpt6module18get_current_tempo2Ev"] = function (a0) {
  return (__ZNK7openmpt6module18get_current_tempo2Ev = Module["__ZNK7openmpt6module18get_current_tempo2Ev"] = wasmExports["Cd"])(a0);
};
var __ZNK7openmpt6module17get_current_orderEv = Module["__ZNK7openmpt6module17get_current_orderEv"] = function (a0) {
  return (__ZNK7openmpt6module17get_current_orderEv = Module["__ZNK7openmpt6module17get_current_orderEv"] = wasmExports["Dd"])(a0);
};
var __ZNK7openmpt6module19get_current_patternEv = Module["__ZNK7openmpt6module19get_current_patternEv"] = function (a0) {
  return (__ZNK7openmpt6module19get_current_patternEv = Module["__ZNK7openmpt6module19get_current_patternEv"] = wasmExports["Ed"])(a0);
};
var __ZNK7openmpt6module15get_current_rowEv = Module["__ZNK7openmpt6module15get_current_rowEv"] = function (a0) {
  return (__ZNK7openmpt6module15get_current_rowEv = Module["__ZNK7openmpt6module15get_current_rowEv"] = wasmExports["Fd"])(a0);
};
var __ZNK7openmpt6module28get_current_playing_channelsEv = Module["__ZNK7openmpt6module28get_current_playing_channelsEv"] = function (a0) {
  return (__ZNK7openmpt6module28get_current_playing_channelsEv = Module["__ZNK7openmpt6module28get_current_playing_channelsEv"] = wasmExports["Gd"])(a0);
};
var __ZNK7openmpt6module27get_current_channel_vu_monoEi = Module["__ZNK7openmpt6module27get_current_channel_vu_monoEi"] = function (a0, a1) {
  return (__ZNK7openmpt6module27get_current_channel_vu_monoEi = Module["__ZNK7openmpt6module27get_current_channel_vu_monoEi"] = wasmExports["Hd"])(a0, a1);
};
var __ZNK7openmpt6module27get_current_channel_vu_leftEi = Module["__ZNK7openmpt6module27get_current_channel_vu_leftEi"] = function (a0, a1) {
  return (__ZNK7openmpt6module27get_current_channel_vu_leftEi = Module["__ZNK7openmpt6module27get_current_channel_vu_leftEi"] = wasmExports["Id"])(a0, a1);
};
var __ZNK7openmpt6module28get_current_channel_vu_rightEi = Module["__ZNK7openmpt6module28get_current_channel_vu_rightEi"] = function (a0, a1) {
  return (__ZNK7openmpt6module28get_current_channel_vu_rightEi = Module["__ZNK7openmpt6module28get_current_channel_vu_rightEi"] = wasmExports["Jd"])(a0, a1);
};
var __ZNK7openmpt6module32get_current_channel_vu_rear_leftEi = Module["__ZNK7openmpt6module32get_current_channel_vu_rear_leftEi"] = function (a0, a1) {
  return (__ZNK7openmpt6module32get_current_channel_vu_rear_leftEi = Module["__ZNK7openmpt6module32get_current_channel_vu_rear_leftEi"] = wasmExports["Kd"])(a0, a1);
};
var __ZNK7openmpt6module33get_current_channel_vu_rear_rightEi = Module["__ZNK7openmpt6module33get_current_channel_vu_rear_rightEi"] = function (a0, a1) {
  return (__ZNK7openmpt6module33get_current_channel_vu_rear_rightEi = Module["__ZNK7openmpt6module33get_current_channel_vu_rear_rightEi"] = wasmExports["Ld"])(a0, a1);
};
var __ZNK7openmpt6module16get_num_subsongsEv = Module["__ZNK7openmpt6module16get_num_subsongsEv"] = function (a0) {
  return (__ZNK7openmpt6module16get_num_subsongsEv = Module["__ZNK7openmpt6module16get_num_subsongsEv"] = wasmExports["Md"])(a0);
};
var __ZNK7openmpt6module16get_num_channelsEv = Module["__ZNK7openmpt6module16get_num_channelsEv"] = function (a0) {
  return (__ZNK7openmpt6module16get_num_channelsEv = Module["__ZNK7openmpt6module16get_num_channelsEv"] = wasmExports["Nd"])(a0);
};
var __ZNK7openmpt6module14get_num_ordersEv = Module["__ZNK7openmpt6module14get_num_ordersEv"] = function (a0) {
  return (__ZNK7openmpt6module14get_num_ordersEv = Module["__ZNK7openmpt6module14get_num_ordersEv"] = wasmExports["Od"])(a0);
};
var __ZNK7openmpt6module16get_num_patternsEv = Module["__ZNK7openmpt6module16get_num_patternsEv"] = function (a0) {
  return (__ZNK7openmpt6module16get_num_patternsEv = Module["__ZNK7openmpt6module16get_num_patternsEv"] = wasmExports["Pd"])(a0);
};
var __ZNK7openmpt6module19get_num_instrumentsEv = Module["__ZNK7openmpt6module19get_num_instrumentsEv"] = function (a0) {
  return (__ZNK7openmpt6module19get_num_instrumentsEv = Module["__ZNK7openmpt6module19get_num_instrumentsEv"] = wasmExports["Qd"])(a0);
};
var __ZNK7openmpt6module15get_num_samplesEv = Module["__ZNK7openmpt6module15get_num_samplesEv"] = function (a0) {
  return (__ZNK7openmpt6module15get_num_samplesEv = Module["__ZNK7openmpt6module15get_num_samplesEv"] = wasmExports["Rd"])(a0);
};
var __ZNK7openmpt6module17get_subsong_namesEv = Module["__ZNK7openmpt6module17get_subsong_namesEv"] = function (a0, a1) {
  return (__ZNK7openmpt6module17get_subsong_namesEv = Module["__ZNK7openmpt6module17get_subsong_namesEv"] = wasmExports["Sd"])(a0, a1);
};
var __ZNK7openmpt6module17get_channel_namesEv = Module["__ZNK7openmpt6module17get_channel_namesEv"] = function (a0, a1) {
  return (__ZNK7openmpt6module17get_channel_namesEv = Module["__ZNK7openmpt6module17get_channel_namesEv"] = wasmExports["Td"])(a0, a1);
};
var __ZNK7openmpt6module15get_order_namesEv = Module["__ZNK7openmpt6module15get_order_namesEv"] = function (a0, a1) {
  return (__ZNK7openmpt6module15get_order_namesEv = Module["__ZNK7openmpt6module15get_order_namesEv"] = wasmExports["Ud"])(a0, a1);
};
var __ZNK7openmpt6module17get_pattern_namesEv = Module["__ZNK7openmpt6module17get_pattern_namesEv"] = function (a0, a1) {
  return (__ZNK7openmpt6module17get_pattern_namesEv = Module["__ZNK7openmpt6module17get_pattern_namesEv"] = wasmExports["Vd"])(a0, a1);
};
var __ZNK7openmpt6module20get_instrument_namesEv = Module["__ZNK7openmpt6module20get_instrument_namesEv"] = function (a0, a1) {
  return (__ZNK7openmpt6module20get_instrument_namesEv = Module["__ZNK7openmpt6module20get_instrument_namesEv"] = wasmExports["Wd"])(a0, a1);
};
var __ZNK7openmpt6module16get_sample_namesEv = Module["__ZNK7openmpt6module16get_sample_namesEv"] = function (a0, a1) {
  return (__ZNK7openmpt6module16get_sample_namesEv = Module["__ZNK7openmpt6module16get_sample_namesEv"] = wasmExports["Xd"])(a0, a1);
};
var __ZNK7openmpt6module17get_order_patternEi = Module["__ZNK7openmpt6module17get_order_patternEi"] = function (a0, a1) {
  return (__ZNK7openmpt6module17get_order_patternEi = Module["__ZNK7openmpt6module17get_order_patternEi"] = wasmExports["Yd"])(a0, a1);
};
var __ZNK7openmpt6module20get_pattern_num_rowsEi = Module["__ZNK7openmpt6module20get_pattern_num_rowsEi"] = function (a0, a1) {
  return (__ZNK7openmpt6module20get_pattern_num_rowsEi = Module["__ZNK7openmpt6module20get_pattern_num_rowsEi"] = wasmExports["Zd"])(a0, a1);
};
var __ZNK7openmpt6module31get_pattern_row_channel_commandEiiii = Module["__ZNK7openmpt6module31get_pattern_row_channel_commandEiiii"] = function (a0, a1, a2, a3, a4) {
  return (__ZNK7openmpt6module31get_pattern_row_channel_commandEiiii = Module["__ZNK7openmpt6module31get_pattern_row_channel_commandEiiii"] = wasmExports["_d"])(a0, a1, a2, a3, a4);
};
var __ZNK7openmpt6module34format_pattern_row_channel_commandEiiii = Module["__ZNK7openmpt6module34format_pattern_row_channel_commandEiiii"] = function (a0, a1, a2, a3, a4, a5) {
  return (__ZNK7openmpt6module34format_pattern_row_channel_commandEiiii = Module["__ZNK7openmpt6module34format_pattern_row_channel_commandEiiii"] = wasmExports["$d"])(a0, a1, a2, a3, a4, a5);
};
var __ZNK7openmpt6module37highlight_pattern_row_channel_commandEiiii = Module["__ZNK7openmpt6module37highlight_pattern_row_channel_commandEiiii"] = function (a0, a1, a2, a3, a4, a5) {
  return (__ZNK7openmpt6module37highlight_pattern_row_channel_commandEiiii = Module["__ZNK7openmpt6module37highlight_pattern_row_channel_commandEiiii"] = wasmExports["ae"])(a0, a1, a2, a3, a4, a5);
};
var __ZNK7openmpt6module26format_pattern_row_channelEiiimb = Module["__ZNK7openmpt6module26format_pattern_row_channelEiiimb"] = function (a0, a1, a2, a3, a4, a5, a6) {
  return (__ZNK7openmpt6module26format_pattern_row_channelEiiimb = Module["__ZNK7openmpt6module26format_pattern_row_channelEiiimb"] = wasmExports["be"])(a0, a1, a2, a3, a4, a5, a6);
};
var __ZNK7openmpt6module29highlight_pattern_row_channelEiiimb = Module["__ZNK7openmpt6module29highlight_pattern_row_channelEiiimb"] = function (a0, a1, a2, a3, a4, a5, a6) {
  return (__ZNK7openmpt6module29highlight_pattern_row_channelEiiimb = Module["__ZNK7openmpt6module29highlight_pattern_row_channelEiiimb"] = wasmExports["ce"])(a0, a1, a2, a3, a4, a5, a6);
};
var __ZNK7openmpt6module8get_ctlsEv = Module["__ZNK7openmpt6module8get_ctlsEv"] = function (a0, a1) {
  return (__ZNK7openmpt6module8get_ctlsEv = Module["__ZNK7openmpt6module8get_ctlsEv"] = wasmExports["de"])(a0, a1);
};
var __ZNK7openmpt6module7ctl_getERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE = Module["__ZNK7openmpt6module7ctl_getERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE"] = function (a0, a1, a2) {
  return (__ZNK7openmpt6module7ctl_getERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE = Module["__ZNK7openmpt6module7ctl_getERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE"] = wasmExports["ee"])(a0, a1, a2);
};
var __ZNK7openmpt6module15ctl_get_booleanENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE = Module["__ZNK7openmpt6module15ctl_get_booleanENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE"] = function (a0, a1) {
  return (__ZNK7openmpt6module15ctl_get_booleanENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE = Module["__ZNK7openmpt6module15ctl_get_booleanENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE"] = wasmExports["fe"])(a0, a1);
};
var __ZNK7openmpt6module15ctl_get_integerENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE = Module["__ZNK7openmpt6module15ctl_get_integerENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE"] = function (a0, a1) {
  return (__ZNK7openmpt6module15ctl_get_integerENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE = Module["__ZNK7openmpt6module15ctl_get_integerENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE"] = wasmExports["ge"])(a0, a1);
};
var __ZNK7openmpt6module21ctl_get_floatingpointENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE = Module["__ZNK7openmpt6module21ctl_get_floatingpointENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE"] = function (a0, a1) {
  return (__ZNK7openmpt6module21ctl_get_floatingpointENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE = Module["__ZNK7openmpt6module21ctl_get_floatingpointENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE"] = wasmExports["he"])(a0, a1);
};
var __ZNK7openmpt6module12ctl_get_textENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE = Module["__ZNK7openmpt6module12ctl_get_textENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE"] = function (a0, a1, a2) {
  return (__ZNK7openmpt6module12ctl_get_textENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE = Module["__ZNK7openmpt6module12ctl_get_textENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEE"] = wasmExports["ie"])(a0, a1, a2);
};
var __ZN7openmpt6module7ctl_setERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEES9_ = Module["__ZN7openmpt6module7ctl_setERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEES9_"] = function (a0, a1, a2) {
  return (__ZN7openmpt6module7ctl_setERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEES9_ = Module["__ZN7openmpt6module7ctl_setERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEES9_"] = wasmExports["je"])(a0, a1, a2);
};
var __ZN7openmpt6module15ctl_set_booleanENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEEb = Module["__ZN7openmpt6module15ctl_set_booleanENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEEb"] = function (a0, a1, a2) {
  return (__ZN7openmpt6module15ctl_set_booleanENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEEb = Module["__ZN7openmpt6module15ctl_set_booleanENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEEb"] = wasmExports["ke"])(a0, a1, a2);
};
var __ZN7openmpt6module15ctl_set_integerENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEEx = Module["__ZN7openmpt6module15ctl_set_integerENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEEx"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6module15ctl_set_integerENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEEx = Module["__ZN7openmpt6module15ctl_set_integerENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEEx"] = wasmExports["le"])(a0, a1, a2, a3);
};
var __ZN7openmpt6module21ctl_set_floatingpointENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEEd = Module["__ZN7openmpt6module21ctl_set_floatingpointENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEEd"] = function (a0, a1, a2) {
  return (__ZN7openmpt6module21ctl_set_floatingpointENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEEd = Module["__ZN7openmpt6module21ctl_set_floatingpointENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEEd"] = wasmExports["me"])(a0, a1, a2);
};
var __ZN7openmpt6module12ctl_set_textENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEES5_ = Module["__ZN7openmpt6module12ctl_set_textENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEES5_"] = function (a0, a1, a2) {
  return (__ZN7openmpt6module12ctl_set_textENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEES5_ = Module["__ZN7openmpt6module12ctl_set_textENSt3__217basic_string_viewIcNS1_11char_traitsIcEEEES5_"] = wasmExports["ne"])(a0, a1, a2);
};
var __ZN7openmpt10module_extC2ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt10module_extC2ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt10module_extC2ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt10module_extC2ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE"] = wasmExports["oe"])(a0, a1, a2, a3);
};
var __ZN7openmpt10module_extC2ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE = Module["__ZN7openmpt10module_extC2ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt10module_extC2ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE = Module["__ZN7openmpt10module_extC2ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE"] = wasmExports["pe"])(a0, a1, a2, a3);
};
var __ZN7openmpt10module_extC2ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE = Module["__ZN7openmpt10module_extC2ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt10module_extC2ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE = Module["__ZN7openmpt10module_extC2ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE"] = wasmExports["qe"])(a0, a1, a2, a3);
};
var __ZN7openmpt10module_extC2ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE = Module["__ZN7openmpt10module_extC2ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt10module_extC2ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE = Module["__ZN7openmpt10module_extC2ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE"] = wasmExports["re"])(a0, a1, a2, a3);
};
var __ZN7openmpt10module_extC2EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt10module_extC2EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt10module_extC2EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt10module_extC2EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["se"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt10module_extC2EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt10module_extC2EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt10module_extC2EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt10module_extC2EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["te"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt10module_extC2EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt10module_extC2EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt10module_extC2EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt10module_extC2EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE"] = wasmExports["ue"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt10module_extC2EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt10module_extC2EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt10module_extC2EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt10module_extC2EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["ve"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt10module_extD2Ev = Module["__ZN7openmpt10module_extD2Ev"] = function (a0) {
  return (__ZN7openmpt10module_extD2Ev = Module["__ZN7openmpt10module_extD2Ev"] = wasmExports["we"])(a0);
};
var __ZN7openmpt10module_extD0Ev = Module["__ZN7openmpt10module_extD0Ev"] = function (a0) {
  return (__ZN7openmpt10module_extD0Ev = Module["__ZN7openmpt10module_extD0Ev"] = wasmExports["xe"])(a0);
};
var __ZN7openmpt10module_extC2ERKS0_ = Module["__ZN7openmpt10module_extC2ERKS0_"] = function (a0, a1) {
  return (__ZN7openmpt10module_extC2ERKS0_ = Module["__ZN7openmpt10module_extC2ERKS0_"] = wasmExports["ye"])(a0, a1);
};
var __ZN7openmpt10module_extaSERKS0_ = Module["__ZN7openmpt10module_extaSERKS0_"] = function (a0, a1) {
  return (__ZN7openmpt10module_extaSERKS0_ = Module["__ZN7openmpt10module_extaSERKS0_"] = wasmExports["ze"])(a0, a1);
};
var __ZN7openmpt10module_ext13get_interfaceERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE = Module["__ZN7openmpt10module_ext13get_interfaceERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE"] = function (a0, a1) {
  return (__ZN7openmpt10module_ext13get_interfaceERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE = Module["__ZN7openmpt10module_ext13get_interfaceERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE"] = wasmExports["Ae"])(a0, a1);
};
var __ZN7openmpt9exceptionC1ERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE = Module["__ZN7openmpt9exceptionC1ERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE"] = function (a0, a1) {
  return (__ZN7openmpt9exceptionC1ERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE = Module["__ZN7openmpt9exceptionC1ERKNSt3__212basic_stringIcNS1_11char_traitsIcEENS1_9allocatorIcEEEE"] = wasmExports["Be"])(a0, a1);
};
var __ZN7openmpt9exceptionC1ERKS0_ = Module["__ZN7openmpt9exceptionC1ERKS0_"] = function (a0, a1) {
  return (__ZN7openmpt9exceptionC1ERKS0_ = Module["__ZN7openmpt9exceptionC1ERKS0_"] = wasmExports["Ce"])(a0, a1);
};
var __ZN7openmpt9exceptionC1EOS0_ = Module["__ZN7openmpt9exceptionC1EOS0_"] = function (a0, a1) {
  return (__ZN7openmpt9exceptionC1EOS0_ = Module["__ZN7openmpt9exceptionC1EOS0_"] = wasmExports["De"])(a0, a1);
};
var __ZN7openmpt9exceptionD1Ev = Module["__ZN7openmpt9exceptionD1Ev"] = function (a0) {
  return (__ZN7openmpt9exceptionD1Ev = Module["__ZN7openmpt9exceptionD1Ev"] = wasmExports["Ee"])(a0);
};
var __ZN7openmpt6moduleC1ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt6moduleC1ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6moduleC1ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt6moduleC1ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE"] = wasmExports["Fe"])(a0, a1, a2, a3);
};
var __ZN7openmpt6moduleC1ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE = Module["__ZN7openmpt6moduleC1ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6moduleC1ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE = Module["__ZN7openmpt6moduleC1ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE"] = wasmExports["Ge"])(a0, a1, a2, a3);
};
var __ZN7openmpt6moduleC1EPKSt4byteS3_RNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt6moduleC1EPKSt4byteS3_RNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6moduleC1EPKSt4byteS3_RNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt6moduleC1EPKSt4byteS3_RNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE"] = wasmExports["He"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6moduleC1EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt6moduleC1EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6moduleC1EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt6moduleC1EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE"] = wasmExports["Ie"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6moduleC1ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE = Module["__ZN7openmpt6moduleC1ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6moduleC1ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE = Module["__ZN7openmpt6moduleC1ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE"] = wasmExports["Je"])(a0, a1, a2, a3);
};
var __ZN7openmpt6moduleC1EPKhS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC1EPKhS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6moduleC1EPKhS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC1EPKhS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["Ke"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6moduleC1EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC1EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6moduleC1EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC1EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["Le"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6moduleC1ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE = Module["__ZN7openmpt6moduleC1ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt6moduleC1ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE = Module["__ZN7openmpt6moduleC1ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE"] = wasmExports["Me"])(a0, a1, a2, a3);
};
var __ZN7openmpt6moduleC1EPKcS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC1EPKcS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6moduleC1EPKcS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC1EPKcS2_RNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["Ne"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6moduleC1EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC1EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6moduleC1EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC1EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["Oe"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6moduleC1EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC1EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt6moduleC1EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt6moduleC1EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["Pe"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt6moduleD1Ev = Module["__ZN7openmpt6moduleD1Ev"] = function (a0) {
  return (__ZN7openmpt6moduleD1Ev = Module["__ZN7openmpt6moduleD1Ev"] = wasmExports["Qe"])(a0);
};
var __ZN7openmpt10module_extC1ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt10module_extC1ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt10module_extC1ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt10module_extC1ERNSt3__213basic_istreamIcNS1_11char_traitsIcEEEERNS1_13basic_ostreamIcS4_EERKNS1_3mapINS1_12basic_stringIcS4_NS1_9allocatorIcEEEESE_NS1_4lessISE_EENSC_INS1_4pairIKSE_SE_EEEEEE"] = wasmExports["Re"])(a0, a1, a2, a3);
};
var __ZN7openmpt10module_extC1ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE = Module["__ZN7openmpt10module_extC1ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt10module_extC1ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE = Module["__ZN7openmpt10module_extC1ERKNSt3__26vectorIhNS1_9allocatorIhEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_NS3_IcEEEESG_NS1_4lessISG_EENS3_INS1_4pairIKSG_SG_EEEEEE"] = wasmExports["Se"])(a0, a1, a2, a3);
};
var __ZN7openmpt10module_extC1ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE = Module["__ZN7openmpt10module_extC1ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt10module_extC1ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE = Module["__ZN7openmpt10module_extC1ERKNSt3__26vectorIcNS1_9allocatorIcEEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSA_S4_EESF_NS1_4lessISF_EENS3_INS1_4pairIKSF_SF_EEEEEE"] = wasmExports["Te"])(a0, a1, a2, a3);
};
var __ZN7openmpt10module_extC1ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE = Module["__ZN7openmpt10module_extC1ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE"] = function (a0, a1, a2, a3) {
  return (__ZN7openmpt10module_extC1ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE = Module["__ZN7openmpt10module_extC1ERKNSt3__26vectorISt4byteNS1_9allocatorIS3_EEEERNS1_13basic_ostreamIcNS1_11char_traitsIcEEEERKNS1_3mapINS1_12basic_stringIcSB_NS4_IcEEEESH_NS1_4lessISH_EENS4_INS1_4pairIKSH_SH_EEEEEE"] = wasmExports["Ue"])(a0, a1, a2, a3);
};
var __ZN7openmpt10module_extC1EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt10module_extC1EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt10module_extC1EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt10module_extC1EPKhmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["Ve"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt10module_extC1EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt10module_extC1EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt10module_extC1EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt10module_extC1EPKcmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["We"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt10module_extC1EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt10module_extC1EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt10module_extC1EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE = Module["__ZN7openmpt10module_extC1EPKSt4bytemRNSt3__213basic_ostreamIcNS4_11char_traitsIcEEEERKNS4_3mapINS4_12basic_stringIcS7_NS4_9allocatorIcEEEESE_NS4_4lessISE_EENSC_INS4_4pairIKSE_SE_EEEEEE"] = wasmExports["Xe"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt10module_extC1EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt10module_extC1EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = function (a0, a1, a2, a3, a4) {
  return (__ZN7openmpt10module_extC1EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE = Module["__ZN7openmpt10module_extC1EPKvmRNSt3__213basic_ostreamIcNS3_11char_traitsIcEEEERKNS3_3mapINS3_12basic_stringIcS6_NS3_9allocatorIcEEEESD_NS3_4lessISD_EENSB_INS3_4pairIKSD_SD_EEEEEE"] = wasmExports["Ye"])(a0, a1, a2, a3, a4);
};
var __ZN7openmpt10module_extD1Ev = Module["__ZN7openmpt10module_extD1Ev"] = function (a0) {
  return (__ZN7openmpt10module_extD1Ev = Module["__ZN7openmpt10module_extD1Ev"] = wasmExports["Ze"])(a0);
};
var __ZN7openmpt10module_extC1ERKS0_ = Module["__ZN7openmpt10module_extC1ERKS0_"] = function (a0, a1) {
  return (__ZN7openmpt10module_extC1ERKS0_ = Module["__ZN7openmpt10module_extC1ERKS0_"] = wasmExports["_e"])(a0, a1);
};
var _emscripten_timeout = function __emscripten_timeout(a0, a1) {
  return (_emscripten_timeout = wasmExports["af"])(a0, a1);
};
var _setThrew2 = function _setThrew(a0, a1) {
  return (_setThrew2 = wasmExports["bf"])(a0, a1);
};
var _emscripten_tempret_set = function __emscripten_tempret_set(a0) {
  return (_emscripten_tempret_set = wasmExports["cf"])(a0);
};
var _emscripten_stack_restore = function __emscripten_stack_restore(a0) {
  return (_emscripten_stack_restore = wasmExports["df"])(a0);
};
var _emscripten_stack_get_current2 = function _emscripten_stack_get_current() {
  return (_emscripten_stack_get_current2 = wasmExports["ef"])();
};
var _cxa_decrement_exception_refcount = function ___cxa_decrement_exception_refcount(a0) {
  return (_cxa_decrement_exception_refcount = wasmExports["ff"])(a0);
};
var _cxa_increment_exception_refcount = function ___cxa_increment_exception_refcount(a0) {
  return (_cxa_increment_exception_refcount = wasmExports["gf"])(a0);
};
var _cxa_can_catch = function ___cxa_can_catch(a0, a1, a2) {
  return (_cxa_can_catch = wasmExports["hf"])(a0, a1, a2);
};
var _cxa_get_exception_ptr = function ___cxa_get_exception_ptr(a0) {
  return (_cxa_get_exception_ptr = wasmExports["jf"])(a0);
};
var dynCall_j = Module["dynCall_j"] = function (a0) {
  return (dynCall_j = Module["dynCall_j"] = wasmExports["kf"])(a0);
};
var dynCall_viiji = Module["dynCall_viiji"] = function (a0, a1, a2, a3, a4, a5) {
  return (dynCall_viiji = Module["dynCall_viiji"] = wasmExports["lf"])(a0, a1, a2, a3, a4, a5);
};
var dynCall_viij = Module["dynCall_viij"] = function (a0, a1, a2, a3, a4) {
  return (dynCall_viij = Module["dynCall_viij"] = wasmExports["mf"])(a0, a1, a2, a3, a4);
};
var dynCall_iiji = Module["dynCall_iiji"] = function (a0, a1, a2, a3, a4) {
  return (dynCall_iiji = Module["dynCall_iiji"] = wasmExports["nf"])(a0, a1, a2, a3, a4);
};
var dynCall_vij = Module["dynCall_vij"] = function (a0, a1, a2, a3) {
  return (dynCall_vij = Module["dynCall_vij"] = wasmExports["of"])(a0, a1, a2, a3);
};
var dynCall_viji = Module["dynCall_viji"] = function (a0, a1, a2, a3, a4) {
  return (dynCall_viji = Module["dynCall_viji"] = wasmExports["pf"])(a0, a1, a2, a3, a4);
};
var dynCall_jiii = Module["dynCall_jiii"] = function (a0, a1, a2, a3) {
  return (dynCall_jiii = Module["dynCall_jiii"] = wasmExports["qf"])(a0, a1, a2, a3);
};
var dynCall_iij = Module["dynCall_iij"] = function (a0, a1, a2, a3) {
  return (dynCall_iij = Module["dynCall_iij"] = wasmExports["rf"])(a0, a1, a2, a3);
};
var dynCall_ijiij = Module["dynCall_ijiij"] = function (a0, a1, a2, a3, a4, a5, a6) {
  return (dynCall_ijiij = Module["dynCall_ijiij"] = wasmExports["sf"])(a0, a1, a2, a3, a4, a5, a6);
};
var dynCall_iji = Module["dynCall_iji"] = function (a0, a1, a2, a3) {
  return (dynCall_iji = Module["dynCall_iji"] = wasmExports["tf"])(a0, a1, a2, a3);
};
var dynCall_ijii = Module["dynCall_ijii"] = function (a0, a1, a2, a3, a4) {
  return (dynCall_ijii = Module["dynCall_ijii"] = wasmExports["uf"])(a0, a1, a2, a3, a4);
};
function invoke_iii(index, a1, a2) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_viii(index, a1, a2, a3) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1, a2, a3);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_vii(index, a1, a2) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1, a2);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_ii(index, a1) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_iiiiiii(index, a1, a2, a3, a4, a5, a6) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2, a3, a4, a5, a6);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_vi(index, a1) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_v(index) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)();
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_iiii(index, a1, a2, a3) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2, a3);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_iiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2, a3, a4, a5, a6, a7, a8);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_viiiii(index, a1, a2, a3, a4, a5) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1, a2, a3, a4, a5);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_viiii(index, a1, a2, a3, a4) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1, a2, a3, a4);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_i(index) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)();
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_viiiiii(index, a1, a2, a3, a4, a5, a6) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1, a2, a3, a4, a5, a6);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_iiiii(index, a1, a2, a3, a4) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2, a3, a4);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_iiiiii(index, a1, a2, a3, a4, a5) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2, a3, a4, a5);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_viiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1, a2, a3, a4, a5, a6, a7, a8, a9);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_di(index, a1) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_fi(index, a1) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_vid(index, a1, a2) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1, a2);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_viiiiiii(index, a1, a2, a3, a4, a5, a6, a7) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1, a2, a3, a4, a5, a6, a7);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_viif(index, a1, a2, a3) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1, a2, a3);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_fii(index, a1, a2) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_didi(index, a1, a2, a3) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2, a3);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_diii(index, a1, a2, a3) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2, a3);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_viidi(index, a1, a2, a3, a4) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1, a2, a3, a4);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_iifi(index, a1, a2, a3) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2, a3);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_iiiiiiii(index, a1, a2, a3, a4, a5, a6, a7) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2, a3, a4, a5, a6, a7);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_did(index, a1, a2) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_viid(index, a1, a2, a3) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1, a2, a3);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_dii(index, a1, a2) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_iiiidd(index, a1, a2, a3, a4, a5) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2, a3, a4, a5);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_iid(index, a1, a2) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_iiiiid(index, a1, a2, a3, a4, a5) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2, a3, a4, a5);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_iiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11) {
  var sp = stackSave();
  try {
    return getWasmTableEntry(index)(a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_viiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1, a2, a3, a4, a5, a6, a7, a8, a9, a10);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_viiiiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15) {
  var sp = stackSave();
  try {
    getWasmTableEntry(index)(a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_viij(index, a1, a2, a3, a4) {
  var sp = stackSave();
  try {
    dynCall_viij(index, a1, a2, a3, a4);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_iiji(index, a1, a2, a3, a4) {
  var sp = stackSave();
  try {
    return dynCall_iiji(index, a1, a2, a3, a4);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_vij(index, a1, a2, a3) {
  var sp = stackSave();
  try {
    dynCall_vij(index, a1, a2, a3);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_jiii(index, a1, a2, a3) {
  var sp = stackSave();
  try {
    return dynCall_jiii(index, a1, a2, a3);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_viiji(index, a1, a2, a3, a4, a5) {
  var sp = stackSave();
  try {
    dynCall_viiji(index, a1, a2, a3, a4, a5);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_ijiij(index, a1, a2, a3, a4, a5, a6) {
  var sp = stackSave();
  try {
    return dynCall_ijiij(index, a1, a2, a3, a4, a5, a6);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_iji(index, a1, a2, a3) {
  var sp = stackSave();
  try {
    return dynCall_iji(index, a1, a2, a3);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_ijii(index, a1, a2, a3, a4) {
  var sp = stackSave();
  try {
    return dynCall_ijii(index, a1, a2, a3, a4);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_iij(index, a1, a2, a3) {
  var sp = stackSave();
  try {
    return dynCall_iij(index, a1, a2, a3);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_viji(index, a1, a2, a3, a4) {
  var sp = stackSave();
  try {
    dynCall_viji(index, a1, a2, a3, a4);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}
function invoke_j(index) {
  var sp = stackSave();
  try {
    return dynCall_j(index);
  } catch (e) {
    stackRestore(sp);
    if (e !== e + 0) throw e;
    _setThrew2(1, 0);
  }
}

// include: postamble.js
// === Auto-generated postamble setup entry stuff ===
var calledRun;
dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!calledRun) run();
  if (!calledRun) dependenciesFulfilled = runCaller;
};

// try this again later, after new deps are fulfilled
function run() {
  if (runDependencies > 0) {
    return;
  }
  preRun();
  // a preRun added a dependency, run will be called later
  if (runDependencies > 0) {
    return;
  }
  function doRun() {
    var _Module$onRuntimeInit;
    // run may have just been called through dependencies being fulfilled just in this very frame,
    // or while the async setStatus time below was happening
    if (calledRun) return;
    calledRun = true;
    Module["calledRun"] = true;
    if (ABORT) return;
    initRuntime();
    (_Module$onRuntimeInit = Module["onRuntimeInitialized"]) === null || _Module$onRuntimeInit === void 0 || _Module$onRuntimeInit.call(Module);
    postRun();
  }
  if (Module["setStatus"]) {
    Module["setStatus"]("Running...");
    setTimeout(function () {
      setTimeout(function () {
        return Module["setStatus"]("");
      }, 1);
      doRun();
    }, 1);
  } else {
    doRun();
  }
}
if (Module["preInit"]) {
  if (typeof Module["preInit"] == "function") Module["preInit"] = [Module["preInit"]];
  while (Module["preInit"].length > 0) {
    Module["preInit"].pop()();
  }
}
run();
