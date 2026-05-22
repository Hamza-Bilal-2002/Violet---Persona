// Persona desktop shell — docker compose bootstrap.
//
// On app launch we fire-and-forget `docker compose up -d` from the
// project root so the user doesn't have to remember to bring up the
// backend stack separately. Idempotent: if the containers are
// already running, `up -d` is a no-op.
//
// Best-effort by design. We don't block window creation on this
// completing — the renderer's BackendClient + WakeWordClient both
// have their own reconnect logic, so they'll find the services
// whenever they come online. If Docker Desktop isn't running, we
// log a warning and the user can start it manually; the rest of the
// app still works (just without backend/voice services).

const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT =
  path.resolve(__dirname, '..');

function startBackendContainers() {

  console.log(
    `[shell] starting backend stack: docker compose up -d ` +
    `(cwd=${PROJECT_ROOT})`
  );

  let proc;

  try {

    // shell:true on Windows so `docker` resolves through PATH the
    // same way it would in PowerShell or cmd. The compose plugin
    // is invoked as a subcommand of the docker CLI ("docker
    // compose ..."), which is the modern form — the standalone
    // "docker-compose" binary is the deprecated path.

    proc =
      spawn(
        'docker',
        ['compose', 'up', '-d'],
        {
          cwd: PROJECT_ROOT,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

  } catch (err) {

    console.warn(
      '[shell] could not spawn docker compose:',
      err && err.message
    );

    return;

  }

  proc.stdout.on(
    'data',
    (data) => {

      const lines =
        data.toString().split(/\r?\n/);

      for (const line of lines) {

        if (line.trim()) {

          console.log('[docker]', line.trim());

        }

      }

    }
  );

  proc.stderr.on(
    'data',
    (data) => {

      const lines =
        data.toString().split(/\r?\n/);

      for (const line of lines) {

        if (line.trim()) {

          // docker compose writes progress + warnings to stderr by
          // convention. Don't escalate to console.error; that's
          // reserved for genuine spawn failures.

          console.log('[docker]', line.trim());

        }

      }

    }
  );

  proc.on(
    'error',
    (err) => {

      console.warn(
        '[shell] docker compose spawn error:',
        err && err.message,
        '(is Docker Desktop running and on PATH?)'
      );

    }
  );

  proc.on(
    'exit',
    (code) => {

      if (code === 0) {

        console.log(
          '[shell] docker compose up -d succeeded'
        );

      } else {

        console.warn(
          `[shell] docker compose up -d exited with code ${code} ` +
          `— backend services may be unavailable until brought up ` +
          `manually`
        );

      }

    }
  );

}

module.exports = {
  startBackendContainers,
};
