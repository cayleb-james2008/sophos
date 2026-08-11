// no-window-preload.cjs
// ---------------------------------------------------------------------------
// Preload module loaded via `node --require` before the daemon CLI so the
// daemon's own child processes (Python kernels, shell commands, tool
// processes spawned through `child_process`) default to `windowsHide: true`.
//
// The Rust shell sets CREATE_NO_WINDOW on the daemon process itself, but that
// flag does NOT propagate to grandchildren. Without this preload, every
// `child_process.spawn()` the daemon makes (with no windowsHide option) flashes
// a console window on Windows.
//
// This module only changes the DEFAULT: if a caller explicitly passes
// `windowsHide: false`, that still wins. The patch sets windowsHide: true only
// when the options object has no `windowsHide` field (or it's undefined).
//
// On non-Windows (`process.platform !== 'win32'`) this is a no-op.
//
// Must be CommonJS (.cjs): `--require` only loads CommonJS modules.
// ---------------------------------------------------------------------------

'use strict';

module.exports = {};

// No-op on non-Windows platforms.
if (process.platform !== 'win32') {
  module.exports = {};
  return;
}

const cp = require('child_process');

// Default `windowsHide: true` into an options object when the caller did not
// specify it. Returns a shallow copy so the caller's object is never mutated;
// returns the original when windowsHide is explicitly present.
function hideWhenUnspecified(options) {
  if (options === undefined || options === null) {
    return { windowsHide: true };
  }
  if (options.windowsHide !== undefined) {
    return options; // explicit value wins (including explicit `false`)
  }
  return Object.assign({}, options, { windowsHide: true });
}

// --- spawn / spawnSync -----------------------------------------------------
// Signatures:
//   spawn(command[, args][, options])
//   spawnSync(command[, args][, options])
// When `args` is omitted the 2nd argument is the options object.
function wrapSpawn(orig) {
  return function (command, args, options) {
    if (args === undefined || args === null) {
      // (cmd) or (cmd, undefined, opts): when the caller passed an options
      // object in the 3rd position, honor it (Node treats a non-array 2nd arg
      // as options). Never force windowsHide:true over an explicit value.
      if (options !== undefined && options !== null) {
        return orig.call(this, command, hideWhenUnspecified(options));
      }
      return orig.call(this, command, { windowsHide: true });
    }
    if (typeof args === 'object' && !Array.isArray(args)) {
      // 2nd arg is actually the options object.
      return orig.call(this, command, hideWhenUnspecified(args));
    }
    // 2nd arg is the args array; options is the 3rd argument.
    return orig.call(this, command, args, hideWhenUnspecified(options));
  };
}

cp.spawn = wrapSpawn(cp.spawn);
cp.spawnSync = wrapSpawn(cp.spawnSync);

// --- execSync / execFileSync ----------------------------------------------
//   execSync(command[, options])
function wrapExecSync(orig) {
  return function (command, options) {
    return orig.call(this, command, hideWhenUnspecified(options));
  };
}

cp.execSync = wrapExecSync(cp.execSync);

//   execFileSync(file[, args][, options])
// When the 2nd arg is not an array it is the options object.
function wrapExecFileSync(orig) {
  return function (file, arg2, arg3) {
    if (Array.isArray(arg2)) {
      return orig.call(this, file, arg2, hideWhenUnspecified(arg3));
    }
    return orig.call(this, file, hideWhenUnspecified(arg2));
  };
}

cp.execFileSync = wrapExecFileSync(cp.execFileSync);

// --- exec / execFile (callback forms) --------------------------------------
//   exec(command[, options][, callback])
//   execFile(file[, args][, options][, callback])
// The options object may appear at a later position; callbacks are functions.
function wrapExec(orig) {
  return function (command, options, callback) {
    if (typeof options === 'function') {
      // exec(command, callback)
      return orig.call(this, command, { windowsHide: true }, options);
    }
    return orig.call(this, command, hideWhenUnspecified(options), callback);
  };
}

cp.exec = wrapExec(cp.exec);

function wrapExecFile(orig) {
  return function (file, arg2, arg3, arg4) {
    if (Array.isArray(arg2)) {
      // execFile(file, args, ...)
      if (typeof arg3 === 'function') {
        // execFile(file, args, callback)
        return orig.call(this, file, arg2, { windowsHide: true }, arg3);
      }
      return orig.call(this, file, arg2, hideWhenUnspecified(arg3), arg4);
    }
    if (typeof arg2 === 'function') {
      // execFile(file, callback)
      return orig.call(this, file, { windowsHide: true }, arg2);
    }
    // execFile(file, options[, callback])
    return orig.call(this, file, hideWhenUnspecified(arg2), arg3);
  };
}

cp.execFile = wrapExecFile(cp.execFile);

module.exports = {
  hidden: true,
};
