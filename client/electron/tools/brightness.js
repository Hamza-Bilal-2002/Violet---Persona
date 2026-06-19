// brightness tool — get / set / nudge screen brightness via WMI.
//
// Uses PowerShell + WMI (root/WMI namespace) which targets the
// laptop's built-in display. External monitors connected via HDMI/DP
// are not controlled by WMI — they'd need DDC/CI, which is a
// separate rabbit hole. For a laptop this is exactly right.
//
// WMI classes used:
//   WmiMonitorBrightness        — read CurrentBrightness (0-100)
//   WmiMonitorBrightnessMethods — WmiSetBrightness(timeout, level)
//     timeout=1 means "persistent until changed"

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const DEFAULT_STEP = 10;  // percentage points for up/down

async function _getBrightness() {
  const ps =
    `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness`;
  const { stdout } = await execAsync(
    `powershell -NoProfile -NonInteractive -Command "${ps}"`,
    { windowsHide: true, timeout: 5000 }
  );
  const level = parseInt(stdout.trim(), 10);
  if (!Number.isFinite(level)) throw new Error('Could not read current brightness');
  return level;
}

async function _setBrightness(level) {
  const clamped = Math.max(0, Math.min(100, Math.round(level)));
  const ps =
    `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods)` +
    `.WmiSetBrightness(1, ${clamped})`;
  await execAsync(
    `powershell -NoProfile -NonInteractive -Command "${ps}"`,
    { windowsHide: true, timeout: 5000 }
  );
  return clamped;
}

async function brightness(args) {

  const action = (args && args.action) ? args.action.toLowerCase().trim() : '';

  if (!action) {
    throw new Error('action is required ("get", "set", "up", or "down")');
  }

  if (action === 'get') {
    const level = await _getBrightness();
    return { brightness: level };
  }

  if (action === 'set') {
    const raw = Number(args && args.level);
    if (!Number.isFinite(raw)) {
      throw new Error('level (0-100) is required for action "set"');
    }
    const applied = await _setBrightness(raw);
    return { brightness: applied };
  }

  if (action === 'up' || action === 'down') {
    const step = Number.isFinite(Number(args && args.step))
      ? Math.max(1, Math.min(50, Math.round(Number(args.step))))
      : DEFAULT_STEP;

    const current = await _getBrightness();
    const target  = action === 'up' ? current + step : current - step;
    const applied = await _setBrightness(target);
    return { brightness: applied };
  }

  throw new Error(`unknown action: "${action}" (use "get", "set", "up", or "down")`);

}

module.exports = brightness;
