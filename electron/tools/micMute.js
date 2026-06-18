// mic_mute tool — mute / unmute / toggle the default capture device.
//
// Uses the Windows Core Audio API (IAudioEndpointVolume on the
// capture endpoint, dataFlow=1) via PowerShell inline C#.
// This affects the system-level mute state of the default microphone —
// the same toggle you'd find in Windows sound settings or the
// taskbar volume mixer.

'use strict';

const { runPs } = require('./_coreAudio');

async function micMute(args) {

  const action = (args && args.action)
    ? args.action.toLowerCase().trim()
    : '';

  if (!action) {
    throw new Error('action is required ("get", "mute", "unmute", or "toggle")');
  }

  if (action === 'get') {
    const { stdout } = await runPs('[AudioHelper]::GetMicMute()');
    const muted = stdout.trim().toLowerCase() === 'true';
    return { muted };
  }

  if (action === 'mute') {
    await runPs('[AudioHelper]::SetMicMute($true)');
    return { muted: true };
  }

  if (action === 'unmute') {
    await runPs('[AudioHelper]::SetMicMute($false)');
    return { muted: false };
  }

  if (action === 'toggle') {
    const { stdout } = await runPs(
      '$m = [AudioHelper]::GetMicMute(); [AudioHelper]::SetMicMute(-not $m); (-not $m).ToString()'
    );
    const muted = stdout.trim().toLowerCase() === 'true';
    return { muted };
  }

  throw new Error(`unknown action: "${action}" (use "get", "mute", "unmute", or "toggle")`);

}

module.exports = micMute;
