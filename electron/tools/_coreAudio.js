// Shared Windows Core Audio COM interop helper.
//
// First call compiles the C# to a DLL in %TEMP% (2-4s, once ever).
// Every subsequent call — including across app restarts — skips
// compilation and just loads the pre-compiled DLL (~100ms).
//
// AudioHelper static methods exposed:
//   SetVolume(percent)   — master output 0-100
//   GetVolume()          — returns current output level
//   SetMicMute(bool)     — mutes/unmutes capture endpoint
//   GetMicMute()         — returns capture mute state
//
// Vtable slot stubs (IUnknown methods are implicit in C# COM interop):
//   IAudioEndpointVolume:
//     f g h i           → 4 stubs → SetMasterVolumeLevelScalar (slot 4)
//     j                 → 1 stub  → GetMasterVolumeLevelScalar (slot 6)
//     k l m n           → 4 stubs → SetMute (slot 11), GetMute (slot 12)
//   IMMDeviceEnumerator:
//     f                 → 1 stub  → GetDefaultAudioEndpoint (slot 1)
//   IMMDevice:
//     Activate          → slot 0  (no stubs needed)

'use strict';

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');

const execAsync = promisify(exec);

// Version suffix: increment whenever the C# source below changes.
const DLL_PATH = path.join(os.tmpdir(), 'persona_audio_v1.dll');

// Raw C# source — no PowerShell wrapper (added dynamically in _ensureDll).
const AUDIO_CS = `\
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int f(); int g(); int h(); int i();
    int SetMasterVolumeLevelScalar(float level, Guid ctx);
    int j();
    int GetMasterVolumeLevelScalar(out float level);
    int k(); int l(); int m(); int n();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, int pActivationParams, out IAudioEndpointVolume aev);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int f();
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject {}
public static class AudioHelper {
    static IAudioEndpointVolume Endpoint(int flow) {
        var en = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
        IMMDevice dev; en.GetDefaultAudioEndpoint(flow, 1, out dev);
        IAudioEndpointVolume vol; var g = typeof(IAudioEndpointVolume).GUID;
        dev.Activate(ref g, 23, 0, out vol); return vol;
    }
    public static void SetVolume(double pct) {
        var g = Guid.Empty; Endpoint(0).SetMasterVolumeLevelScalar((float)(pct/100.0), g);
    }
    public static double GetVolume() {
        float v; Endpoint(0).GetMasterVolumeLevelScalar(out v); return Math.Round(v * 100.0);
    }
    public static void SetMicMute(bool mute) {
        var g = Guid.Empty; Endpoint(1).SetMute(mute, g);
    }
    public static bool GetMicMute() {
        bool m; Endpoint(1).GetMute(out m); return m;
    }
}`;

// Encode a multi-line PS script as UTF-16LE base64 for -EncodedCommand.
// Sidesteps every quoting/escaping issue with inline C# and here-strings.
function encodePs(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

// In-process sentinel — avoids repeated fs.existsSync calls after first
// successful compilation (Electron's main process is long-lived).
let _dllReady = false;
let _dllPromise = null;

function _ensureDll() {
  if (_dllReady) return Promise.resolve();
  if (_dllPromise) return _dllPromise;

  _dllPromise = (async () => {
    if (!fs.existsSync(DLL_PATH)) {
      // Compile once, write to disk. Forward slashes work on Windows
      // and avoid backslash escaping inside the PS single-quoted string.
      const dllFwd = DLL_PATH.replace(/\\/g, '/');
      const compileScript =
        `Add-Type -TypeDefinition @"\n${AUDIO_CS}\n"@ ` +
        `-OutputAssembly '${dllFwd}' -Language CSharp`;
      await execAsync(
        `powershell -NoProfile -NonInteractive -EncodedCommand ${encodePs(compileScript)}`,
        { windowsHide: true, timeout: 15000 }
      );
    }
    _dllReady = true;
  })();

  // Allow retry on failure (clear the cached promise so the next call
  // re-enters _ensureDll and tries again).
  _dllPromise.catch(() => { _dllPromise = null; });

  return _dllPromise;
}

async function runPs(script) {
  await _ensureDll();

  // Load pre-compiled DLL (fast, ~100ms) then run the caller's script.
  const dllFwd = DLL_PATH.replace(/\\/g, '/');
  const full = `Add-Type -Path '${dllFwd}'\n${script}`;
  return execAsync(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encodePs(full)}`,
    { windowsHide: true, timeout: 10000 }
  );
}

module.exports = { runPs };
