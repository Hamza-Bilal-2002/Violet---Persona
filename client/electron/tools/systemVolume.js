// system_volume tool — raise / lower / mute / set the master volume.
//
// up / down / mute use WScript.Shell SendKeys (virtual key codes):
//   0xAF (175) — Volume Up
//   0xAE (174) — Volume Down
//   0xAD (173) — Volume Mute (toggle)
// SendKeys is fast (~150ms) and requires no native modules.
//
// set uses the Windows Core Audio API via PowerShell inline C#
// (_coreAudio.js) to land on an exact percentage, since SendKeys
// can only nudge by ~2% increments.

const { exec } = require('child_process');
const { promisify } = require('util');
const { runPs } = require('./_coreAudio');

const execAsync =
  promisify(exec);

const KEY_CODES = {

  up:
    175,  // VK_VOLUME_UP   (0xAF)

  down:
    174,  // VK_VOLUME_DOWN (0xAE)

  mute:
    173,  // VK_VOLUME_MUTE (0xAD)

};

const DEFAULT_STEPS =
  3;

const MAX_STEPS =
  50;

async function systemVolume(args) {

  const action =
    args && typeof args.action === 'string'
      ? args.action.toLowerCase().trim()
      : '';

  if (!action) {

    throw new Error(
      'action is required ("up", "down", "mute", or "set")'
    );

  }

  // Exact percentage — use Core Audio API instead of SendKeys.
  if (action === 'set') {
    const raw = Number(args && args.level);
    if (!Number.isFinite(raw)) {
      throw new Error('level (0-100) is required for action "set"');
    }
    const level = Math.max(0, Math.min(100, Math.round(raw)));
    await runPs(`[AudioHelper]::SetVolume(${level})`);
    return { action: 'set', level };
  }

  const code =
    KEY_CODES[action];

  if (code === undefined) {

    throw new Error(
      `unknown action: "${action}" ` +
      `(use "up", "down", or "mute")`
    );

  }

  // mute is a single toggle. up/down take a steps count; clamp it
  // to [1, MAX_STEPS] so a malformed value can't loop forever.

  let steps;

  if (action === 'mute') {

    steps =
      1;

  } else {

    const rawSteps =
      Number.parseInt(args && args.steps, 10);

    steps =
      Number.isFinite(rawSteps)
        ? Math.min(Math.max(rawSteps, 1), MAX_STEPS)
        : DEFAULT_STEPS;

  }

  // SendKeys via WScript.Shell. The loop runs inside PowerShell so
  // we pay the PS startup cost (~150 ms) once regardless of step
  // count. Start-Sleep -Milliseconds 10 between presses gives
  // Windows time to register each as a distinct event — without
  // it, rapid sends can be coalesced and only one tick happens.

  const psScript =
    `$w = New-Object -ComObject WScript.Shell; ` +
    `for ($i = 0; $i -lt ${steps}; $i++) { ` +
    `  $w.SendKeys([char]${code}); ` +
    `  Start-Sleep -Milliseconds 10 ` +
    `}`;

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
      `volume change failed: ${reason}`
    );

  }

  return {
    action,
    steps,
  };

}

module.exports = systemVolume;
