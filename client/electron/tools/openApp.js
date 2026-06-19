// open_app tool — launch a desktop application by name.
//
// Implementation strategy: shell out to cmd's `start` builtin, which
// is Windows' own app launcher and understands:
//   - the App Paths registry key (chrome, code, etc.)
//   - Store-app URI handlers (spotify, discord, etc.)
//   - bare exe names on PATH (notepad, calc)
// — the same lookup a Run-dialog entry would use.
//
// Security: the name string comes from Gemini, which may have been
// influenced by user voice input. Anything that ends up inside a
// cmd command line is an injection risk, so we apply a strict
// allowlist (letters, digits, space, period, hyphen, underscore)
// before interpolating. Anything else is rejected outright.

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync =
  promisify(exec);

// Allowed in app names: word chars + space + . _ -
// Real app names ("Google Chrome", "VS Code", "Steam") all fit.

const NAME_PATTERN =
  /^[a-zA-Z0-9 ._-]+$/;

const NAME_MAX_LEN =
  64;

async function openApp(args) {

  const rawName =
    args && typeof args.name === 'string'
      ? args.name.trim()
      : '';

  if (!rawName) {

    throw new Error(
      'name is required and must be a non-empty string'
    );

  }

  if (!NAME_PATTERN.test(rawName)) {

    throw new Error(
      `app name contains disallowed characters: "${rawName}" ` +
      `(letters, digits, spaces, periods, hyphens, underscores only)`
    );

  }

  if (rawName.length > NAME_MAX_LEN) {

    throw new Error(
      `app name is too long (max ${NAME_MAX_LEN} chars)`
    );

  }

  // The empty "" before the quoted name is the window title slot
  // — without it, `start "spotify"` would just set the cmd window
  // title to "spotify" rather than launching it. windowsHide
  // suppresses the cmd flash. start exits immediately after
  // handing off, so the 5s timeout is generous.

  const command =
    `start "" "${rawName}"`;

  try {

    await execAsync(
      command,
      {
        windowsHide: true,
        timeout: 5000,
      }
    );

  } catch (err) {

    const reason =
      err && err.message
        ? err.message
        : String(err);

    throw new Error(
      `could not open "${rawName}": ${reason}`
    );

  }

  return {
    opened:
      rawName,
  };

}

module.exports = openApp;
