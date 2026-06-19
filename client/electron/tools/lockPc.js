// lock_pc tool — invoke the Windows lock screen.
//
// rundll32 against user32.dll's LockWorkStation entry point is the
// canonical Windows lock command — same thing Win+L does. Returns
// immediately after the lock screen appears; the actual session
// stays alive and apps keep running.
//
// No arguments and no user input is interpolated into the command,
// so there's no injection surface.

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync =
  promisify(exec);

async function lockPc() {

  try {

    await execAsync(
      'rundll32.exe user32.dll,LockWorkStation',
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
      `lock failed: ${reason}`
    );

  }

  return {
    locked:
      true,
  };

}

module.exports = lockPc;
