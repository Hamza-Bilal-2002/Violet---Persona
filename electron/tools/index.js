// Tool dispatcher for Phase 3 PC task automation.
//
// The renderer relays tool_call frames here via IPC; we look up the
// handler by name, run it with the model-supplied args, and return
// {result} on success or {error} on failure. The renderer ships the
// outcome back over the WebSocket as a tool_result frame so the
// backend can resume the Gemini loop.
//
// Adding a tool:
//   1. Append a FunctionDeclaration in backend/app/tools.py
//   2. Implement the handler here as ./tools/<name>.js exporting
//      `async (args) => result`
//   3. Register it in REGISTRY below

const openUrl = require('./openUrl');

const REGISTRY = {

  open_url:
    openUrl,

};

async function execute(name, args) {

  const handler =
    REGISTRY[name];

  if (!handler) {

    return {
      error:
        `unknown tool: ${name}`,
    };

  }

  try {

    const result =
      await handler(args || {});

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

module.exports = {
  execute,
};
