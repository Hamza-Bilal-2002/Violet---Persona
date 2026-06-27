// Persona desktop shell — docker compose bootstrap.
//
// On app launch we fire-and-forget `docker compose up -d` from the
// server/ directory (where docker-compose.yml lives) so the user
// doesn't have to remember to bring up the backend stack separately.
// Idempotent: if the containers are already running, `up -d` is a
// no-op.
//
// Best-effort by design. We don't block window creation on this
// completing — the renderer's BackendClient + WakeWordClient both
// have their own reconnect logic, so they'll find the services
// whenever they come online. If Docker Desktop isn't running, we
// log a warning and the user can start it manually; the rest of the
// app still works (just without backend/voice services).

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Where the docker-compose.yml lives. In a dev checkout the compose
// stack sits in server/ two levels up from client/electron/. In a
// PACKAGED build there is no server/ tree beside the app (the .exe
// ships the overlay client only — the backend is a separate Docker
// install), so that relative guess would point at a path that doesn't
// exist. PERSONA_SERVER_DIR lets the user point the shell at wherever
// they keep the compose stack; otherwise we fall back to the dev path.
const PROJECT_ROOT =
  process.env.PERSONA_SERVER_DIR ||
  path.resolve(__dirname, '..', '..', 'server');

function startBackendContainers() {

  // Don't fire `docker compose up` against a cwd that has no compose
  // file — that just spawns a guaranteed-failure process and logs
  // noise. Common in a packaged install with no co-located server/.
  // The renderer's clients reconnect on their own, so skipping here
  // simply means the user brings the backend up themselves.
  const hasCompose =
    fs.existsSync(path.join(PROJECT_ROOT, 'docker-compose.yml')) ||
    fs.existsSync(path.join(PROJECT_ROOT, 'compose.yaml'));

  if (!hasCompose) {
    console.warn(
      `[shell] no compose file at ${PROJECT_ROOT} — skipping backend ` +
      `auto-start. ${app.isPackaged ? 'Set PERSONA_SERVER_DIR to your ' +
      'server/ folder, or start the backend manually.' : ''}`
    );
    return;
  }

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
