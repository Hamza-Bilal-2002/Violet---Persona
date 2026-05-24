// Tool dispatcher for Phase 3 PC task automation.
//
// The renderer relays tool_call frames here via IPC; we look up the
// handler by name, run it with the model-supplied args, and return
// {result} on success or {error} on failure. The renderer ships the
// outcome back over the WebSocket as a tool_result frame so the
// backend can resume the Gemini loop.
//
// DEFERRED TOOLS
//   Some tools (lock_pc, sleep_pc) interrupt the user's experience
//   the moment they fire — locking the screen mid-sentence eats the
//   avatar's reply. Those tools are marked `deferred: true` in
//   REGISTRY. For deferred tools, execute() doesn't actually run the
//   side-effect — it stashes the prepared invocation in a single
//   pending slot, returns success to Gemini immediately so the
//   reply text flows, and waits for the renderer to call
//   flushDeferred() when dialogue ends. cancelDeferred() drops the
//   pending action when a new conversation starts.
//
//   Most-recent-wins: a second deferred tool call replaces the
//   first. That keeps the design tiny without surprising the user
//   (whoever spoke last gets the action).
//
// Adding a tool:
//   1. Append a FunctionDeclaration in backend/app/tools.py
//   2. Implement the handler here as ./tools/<name>.js exporting
//      `async (args) => result`
//   3. Register it in REGISTRY with optional deferred:true

const openUrl = require('./openUrl');
const openApp = require('./openApp');
const systemVolume = require('./systemVolume');
const lockPc = require('./lockPc');
const sleepPc = require('./sleepPc');

const REGISTRY = {

  open_url: {
    handler:
      openUrl,
  },

  open_app: {
    handler:
      openApp,
  },

  system_volume: {
    handler:
      systemVolume,
  },

  lock_pc: {
    handler:
      lockPc,
    deferred:
      true,
  },

  sleep_pc: {
    handler:
      sleepPc,
    deferred:
      true,
  },

};

// Single-slot pending queue for deferred tools. A second deferred
// call overwrites it (most-recent-wins). Held as a closure over the
// args so the renderer's flush IPC doesn't need to pass anything.

let pendingDeferred =
  null;

async function execute(name, args) {

  const entry =
    REGISTRY[name];

  if (!entry) {

    return {
      error:
        `unknown tool: ${name}`,
    };

  }

  // Deferred path: don't run the side-effect now. Store the
  // closure, return success synthetically so Gemini's reply text
  // gets generated and spoken. The renderer flushes us when the
  // dialogue finishes (or cancels us if a new conversation starts).

  if (entry.deferred) {

    const finalArgs =
      args || {};

    pendingDeferred = {
      name,
      fn:
        () => entry.handler(finalArgs),
    };

    console.log(
      `[tools] deferred ${name} — will fire after dialogue ends`
    );

    return {
      result: {
        deferred:
          true,
        name,
      },
    };

  }

  // Immediate path: same as before.

  try {

    const result =
      await entry.handler(args || {});

    return {
      result,
    };

  } catch (err) {

    const message =
      err && err.message
        ? err.message
        : String(err);

    return {
      error:
        message,
    };

  }

}

async function flushDeferred() {

  if (!pendingDeferred) {

    return;

  }

  const { name, fn } =
    pendingDeferred;

  pendingDeferred =
    null;

  console.log(
    `[tools] flushing deferred ${name}`
  );

  try {

    await fn();

  } catch (err) {

    console.warn(
      `[tools] deferred ${name} failed:`,
      err && err.message ? err.message : err
    );

  }

}

function cancelDeferred() {

  if (!pendingDeferred) {

    return;

  }

  console.log(
    `[tools] cancelling deferred ${pendingDeferred.name}`
  );

  pendingDeferred =
    null;

}

module.exports = {
  execute,
  flushDeferred,
  cancelDeferred,
};
