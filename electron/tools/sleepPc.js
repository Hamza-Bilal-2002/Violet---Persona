// sleep_pc tool — suspend the PC to S3 sleep.
//
// rundll32 against powrprof.dll's SetSuspendState entry point.
// Signature: SetSuspendState(bHibernate, bForce, bWakeupEventsDisabled).
//   0,1,0 = sleep (not hibernate), force suspend, allow wake events.
//
// Quirk: on systems where hibernation is enabled (powercfg -h on),
// Windows may interpret this as hibernate regardless of the first
// argument. The user can `powercfg -h off` from an elevated prompt
// to make this reliably sleep — out of scope to handle from here.
//
// Marked deferred in tools/index.js so it fires after the avatar
// finishes speaking.

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync =
  promisify(exec);

async function sleepPc() {

  try {

    await execAsync(
      'rundll32.exe powrprof.dll,SetSuspendState 0,1,0',
      {
        windowsHide: true,
        timeout: 3000,
      }
    );

  } catch (err) {

    const reason =
      err && err.message
        ? err.message
        : String(err);

    throw new Error(
      `sleep failed: ${reason}`
    );

  }

  return {
    sleeping:
      true,
  };

}

module.exports = sleepPc;
