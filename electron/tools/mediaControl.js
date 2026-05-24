// media_control tool — system media keys for any media app.
//
// Same SendKeys-via-PowerShell trick as system_volume, but with
// the media VK codes:
//   0xB3 (179) — VK_MEDIA_PLAY_PAUSE
//   0xB0 (176) — VK_MEDIA_NEXT_TRACK
//   0xB1 (177) — VK_MEDIA_PREV_TRACK
//   0xB2 (178) — VK_MEDIA_STOP
//
// Media keys are system-wide on Windows — they don't require the
// target app to have keyboard focus. Spotify, the active browser
// tab, VLC, Windows Media Player all listen for these and the
// "currently playing" app wins.

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync =
  promisify(exec);

const KEY_CODES = {

  play_pause:
    179,  // VK_MEDIA_PLAY_PAUSE (0xB3)

  next:
    176,  // VK_MEDIA_NEXT_TRACK (0xB0)

  previous:
    177,  // VK_MEDIA_PREV_TRACK (0xB1)

  stop:
    178,  // VK_MEDIA_STOP       (0xB2)

};

async function mediaControl(args) {

  const action =
    args && typeof args.action === 'string'
      ? args.action.toLowerCase().trim()
      : '';

  if (!action) {

    throw new Error(
      'action is required ' +
      '("play_pause", "next", "previous", or "stop")'
    );

  }

  const code =
    KEY_CODES[action];

  if (code === undefined) {

    throw new Error(
      `unknown action: "${action}" ` +
      `(use "play_pause", "next", "previous", or "stop")`
    );

  }

  // Single key press is enough — media keys aren't held.

  const psScript =
    `$w = New-Object -ComObject WScript.Shell; ` +
    `$w.SendKeys([char]${code})`;

  const command =
    `powershell -NoProfile -NonInteractive -Command "${psScript}"`;

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
      `media control failed: ${reason}`
    );

  }

  return {
    action,
  };

}

module.exports = mediaControl;
