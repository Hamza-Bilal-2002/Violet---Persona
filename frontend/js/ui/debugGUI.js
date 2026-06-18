import GUI from 'lil-gui';
import { AVATAR_CONFIG } from '../config/avatarConfig.js';

export function setupGUI(

  expressionManager,
  animationManager,
  vrm,
  boundingSphereHelper,
  lights,
  camera,
  controls,

) {

  const gui =
    new GUI();

  // =========================
  // EXPRESSIONS
  // =========================

  setupExpressionGUI(

    gui,
    expressionManager

  );

  // =========================
  // ANIMATIONS
  // =========================

  setupAnimationGUI(

    gui,
    animationManager

  );

  // =========================
  // MESHES (Phase 4 Wave 4.1)
  // =========================
  //
  // Per-mesh visibility toggles so the user can hide arbitrary
  // parts of the VRM (clothes, accessories, hair, body sub-parts)
  // without us needing to know the model's specific naming
  // convention. Works for any VRM — just enumerate whatever the
  // exporter produced.

  setupMeshGUI(

    gui,
    vrm

  );

  // =========================
  // HIT ZONE
  // =========================
  //
  // Visualise the bounding sphere used for click-through hit-testing.
  // Toggle it on to see how tight the interactive zone is around
  // the avatar body.

  setupHitZoneGUI(

    gui,
    boundingSphereHelper

  );

  // =========================
  // LIGHTING
  // =========================

  setupLightingGUI(
    gui,
    lights
  );

  // =========================
  // CAMERA
  // =========================

  setupCameraGUI(
    gui,
    camera,
    controls
  );

  // =========================
  // AVATAR POSITION
  // =========================
  //
  // Controls marginRight and marginBottom in AVATAR_CONFIG.viewport.
  // Changes take effect on the next rendered frame (getAvatarViewport
  // reads AVATAR_CONFIG live). The text input also tracks these via
  // the RAF position loop in AvatarRuntime.

  setupPositionGUI(gui);

  // =========================
  // SAVE SETTINGS
  // =========================
  //
  // Captures the current live state of all tweakable objects and
  // ships it to the Electron main process to persist in userData.
  // Only available when running inside the Electron shell.

  if (
    typeof window !== 'undefined' &&
    window.personaShell &&
    typeof window.personaShell.saveSettings === 'function'
  ) {

    const actions = {

      saveSettings: () => {

        const v = AVATAR_CONFIG.viewport;

        const data = {

          viewport: {
            marginRight:    v.marginRight,
            marginBottom:   v.marginBottom,
            widthFraction:  v.widthFraction,
            widthMin:       v.widthMin,
            widthMax:       v.widthMax,
            heightFraction: v.heightFraction,
            heightMin:      v.heightMin,
            heightMax:      v.heightMax,
          },

          lighting: {
            ambient: {
              color:     '#' + lights.ambientLight.color.getHexString(),
              intensity: lights.ambientLight.intensity,
            },
            directional: {
              color:     '#' + lights.directionalLight.color.getHexString(),
              intensity: lights.directionalLight.intensity,
              position: {
                x: lights.directionalLight.position.x,
                y: lights.directionalLight.position.y,
                z: lights.directionalLight.position.z,
              },
            },
          },

          camera: {
            fov: camera.fov,
            position: {
              x: camera.position.x,
              y: camera.position.y,
              z: camera.position.z,
            },
          },

          controls: controls ? {
            target: {
              x: controls.target.x,
              y: controls.target.y,
              z: controls.target.z,
            },
          } : undefined,

        };

        window.personaShell.saveSettings(data)
          .then(() => console.log('[debugGUI] settings saved'))
          .catch((err) => console.error('[debugGUI] save failed', err));

      },

    };

    gui.add(actions, 'saveSettings').name('💾 Save Settings');

  }

  // Default to hidden — the polished desktop overlay should
  // not display debug controls on launch. The tray "Debug GUI"
  // toggle (Electron) or a future hotkey is the way in.

  gui.hide();

  return gui;

}

// =========================
// EXPRESSIONS GUI
// =========================

function setupExpressionGUI(

  gui,
  expressionManager

) {

  const folder =

    gui.addFolder(
      'Expressions'
    );

  const params = {

    happy: 0,
    angry: 0,
    sad: 0,
    relaxed: 0,
    surprised: 0,

    blink: 0,

    aa: 0,
    ee: 0,
    ih: 0,
    oh: 0,
    ou: 0,

  };

  Object.keys(
    params
  ).forEach((key) => {

    folder

      .add(
        params,
        key,
        0,
        1,
        0.01
      )

      .name(key)

      .onChange((value) => {

        expressionManager.set(
          key,
          value
        );

      });

  });

  folder.open();

}

// =========================
// MESHES GUI
// =========================
//
// Enumerates every Mesh / SkinnedMesh under the VRM root and
// hangs a visibility checkbox off each one. The user toggles
// whichever meshes they want to hide — typically clothing
// pieces, but works for hair, accessories, body sub-parts,
// anything the exporter chunked out.
//
// Names come from however the source tool (VRoid Studio, Blender,
// etc.) labeled the meshes — they vary wildly. The toggle UI
// surfaces them as-is rather than guessing at semantic categories.

function setupMeshGUI(gui, vrm) {

  const folder =
    gui.addFolder('Meshes');

  if (!vrm || !vrm.scene) {

    folder
      .add({ note: '(no VRM)' }, 'note')
      .disable();

    return;

  }

  const meshes = [];

  vrm.scene.traverse((obj) => {

    if (obj.isMesh || obj.isSkinnedMesh) {

      meshes.push(obj);

    }

  });

  if (!meshes.length) {

    folder
      .add({ note: '(no meshes found)' }, 'note')
      .disable();

    return;

  }

  // Stable alphabetical order so the UI doesn't reshuffle
  // between loads.

  meshes.sort(
    (a, b) =>
      (a.name || '').localeCompare(b.name || '')
  );

  console.info(
    `[debugGUI] ${meshes.length} VRM mesh(es) registered:`,
    meshes.map((m) => m.name || '(unnamed)')
  );

  for (const mesh of meshes) {

    const state = {
      visible: mesh.visible,
    };

    folder
      .add(state, 'visible')
      .name(mesh.name || '(unnamed)')
      .onChange((v) => {

        mesh.visible = v;

      });

  }

  // Collapsed by default — could be a long list, and most users
  // won't poke at this.

  folder.close();

}

// =========================
// HIT ZONE GUI
// =========================

function setupHitZoneGUI(gui, boundingSphereHelper) {

  const folder =
    gui.addFolder('Hit Zone');

  const state = {
    showSphere: false,
  };

  folder
    .add(state, 'showSphere')
    .name('Show Bounding Sphere')
    .onChange((v) => {

      if (boundingSphereHelper) {

        boundingSphereHelper.visible = v;

      }

    });

  folder.close();

}

// =========================
// LIGHTING GUI
// =========================

function setupLightingGUI(gui, lights) {

  if (!lights) return;

  const folder = gui.addFolder('Lighting');

  // ---- Ambient ----
  const amb = folder.addFolder('Ambient');
  const ambState = {
    color:     '#' + lights.ambientLight.color.getHexString(),
    intensity: lights.ambientLight.intensity,
  };
  amb.addColor(ambState, 'color')
    .name('Color')
    .onChange((v) => lights.ambientLight.color.set(v));
  amb.add(ambState, 'intensity', 0, 3, 0.05)
    .name('Intensity')
    .onChange((v) => { lights.ambientLight.intensity = v; });
  amb.close();

  // ---- Key (directional) ----
  const key = folder.addFolder('Key Light');
  const keyState = {
    color:     '#' + lights.directionalLight.color.getHexString(),
    intensity: lights.directionalLight.intensity,
    x:         lights.directionalLight.position.x,
    y:         lights.directionalLight.position.y,
    z:         lights.directionalLight.position.z,
  };
  key.addColor(keyState, 'color')
    .name('Color')
    .onChange((v) => lights.directionalLight.color.set(v));
  key.add(keyState, 'intensity', 0, 3, 0.05)
    .name('Intensity')
    .onChange((v) => { lights.directionalLight.intensity = v; });
  key.add(keyState, 'x', -10, 10, 0.1)
    .name('Pos X')
    .onChange((v) => { lights.directionalLight.position.x = v; });
  key.add(keyState, 'y', -10, 10, 0.1)
    .name('Pos Y')
    .onChange((v) => { lights.directionalLight.position.y = v; });
  key.add(keyState, 'z', -10, 10, 0.1)
    .name('Pos Z')
    .onChange((v) => { lights.directionalLight.position.z = v; });
  key.close();

  // ---- Rim ----
  if (lights.rimLight) {
    const rim = folder.addFolder('Rim Light');
    const rimState = {
      color:     '#' + lights.rimLight.color.getHexString(),
      intensity: lights.rimLight.intensity,
      x:         lights.rimLight.position.x,
      y:         lights.rimLight.position.y,
      z:         lights.rimLight.position.z,
    };
    rim.addColor(rimState, 'color')
      .name('Color')
      .onChange((v) => lights.rimLight.color.set(v));
    rim.add(rimState, 'intensity', 0, 3, 0.05)
      .name('Intensity')
      .onChange((v) => { lights.rimLight.intensity = v; });
    rim.add(rimState, 'x', -10, 10, 0.1)
      .name('Pos X')
      .onChange((v) => { lights.rimLight.position.x = v; });
    rim.add(rimState, 'y', -10, 10, 0.1)
      .name('Pos Y')
      .onChange((v) => { lights.rimLight.position.y = v; });
    rim.add(rimState, 'z', -10, 10, 0.1)
      .name('Pos Z')
      .onChange((v) => { lights.rimLight.position.z = v; });
    rim.close();
  }

  folder.close();

}

// =========================
// CAMERA GUI
// =========================

function setupCameraGUI(gui, camera, controls) {

  if (!camera) return;

  const folder = gui.addFolder('Camera');

  const state = {
    fov:     camera.fov,
    posX:    camera.position.x,
    posY:    camera.position.y,
    posZ:    camera.position.z,
    targetX: controls?.target.x ?? 0,
    targetY: controls?.target.y ?? 1.2,
    targetZ: controls?.target.z ?? 0,
  };

  folder.add(state, 'fov', 10, 90, 1)
    .name('FOV')
    .onChange((v) => {
      camera.fov = v;
      camera.updateProjectionMatrix();
    });

  folder.add(state, 'posX', -5, 5, 0.05)
    .name('Pos X')
    .onChange((v) => { camera.position.x = v; });

  folder.add(state, 'posY', 0, 5, 0.05)
    .name('Pos Y')
    .onChange((v) => { camera.position.y = v; });

  folder.add(state, 'posZ', 0.5, 10, 0.05)
    .name('Pos Z')
    .onChange((v) => { camera.position.z = v; });

  folder.add(state, 'targetX', -3, 3, 0.05)
    .name('Target X')
    .onChange((v) => { if (controls) controls.target.x = v; });

  folder.add(state, 'targetY', 0, 3, 0.05)
    .name('Target Y')
    .onChange((v) => { if (controls) controls.target.y = v; });

  folder.add(state, 'targetZ', -3, 3, 0.05)
    .name('Target Z')
    .onChange((v) => { if (controls) controls.target.z = v; });

  folder.close();

}

// =========================
// ANIMATION GUI
// =========================

function setupAnimationGUI(

  gui,
  animationManager

) {

  const folder =

    gui.addFolder(
      'Animations'
    );

  const animationNames =

    Object.keys(
      animationManager.actions
    );

  const state = {

    animation:
      'idle',

    play: () => {

      animationManager.play(

        state.animation

      );

    }

  };

  // =========================
  // DROPDOWN
  // =========================

  folder

    .add(

      state,
      'animation',
      animationNames

    )

    .name(
      'Current Animation'
    );

  // =========================
  // PLAY BUTTON
  // =========================

  folder

    .add(
      state,
      'play'
    )

    .name(
      'Play Animation'
    );

  folder.open();

}

// =========================
// POSITION GUI
// =========================
//
// Controls the avatar's on-screen placement by mutating
// AVATAR_CONFIG.viewport directly. getAvatarViewport() reads that
// object every frame, so changes take effect immediately.
// The text input position tracks the same values via its RAF loop.

function setupPositionGUI(gui) {

  const v = AVATAR_CONFIG.viewport;

  const folder = gui.addFolder('Position');

  const state = {
    marginRight:  v.marginRight,
    marginBottom: v.marginBottom,
  };

  folder.add(state, 'marginRight', 0, 1200, 1)
    .name('Offset Right')
    .onChange((val) => { AVATAR_CONFIG.viewport.marginRight = val; });

  folder.add(state, 'marginBottom', 0, 200, 1)
    .name('Offset Bottom')
    .onChange((val) => { AVATAR_CONFIG.viewport.marginBottom = val; });

  folder.close();

}