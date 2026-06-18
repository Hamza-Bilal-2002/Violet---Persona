// Shared Windows Core Audio COM interop helper.
//
// Passes PowerShell scripts via -EncodedCommand (UTF-16LE base64) to
// avoid all quoting problems with inline C#. The Add-Type block
// defines a minimal vtable-compatible interface set so we can call
// the four methods we actually need:
//   AudioHelper.SetVolume(percent)   — master output 0-100
//   AudioHelper.GetVolume()          — returns current output level
//   AudioHelper.SetMicMute(bool)     — mutes/unmutes capture endpoint
//   AudioHelper.GetMicMute()         — returns capture mute state
//
// Vtable slot counts (IUnknown methods are implicit in C# COM interop):
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

const execAsync = promisify(exec);

const AUDIO_TYPE = `
Add-Type -TypeDefinition @"
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
}
"@ -Language CSharp
`;

// Encode a multi-line PS script as UTF-16LE base64 for -EncodedCommand.
// This sidesteps every quoting and escaping issue when the script
// contains C# here-strings, double quotes, backslashes, etc.

function encodePs(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function runPs(script) {
  const encoded = encodePs(AUDIO_TYPE + '\n' + script);
  return execAsync(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { windowsHide: true, timeout: 10000 }
  );
}

module.exports = { runPs };
