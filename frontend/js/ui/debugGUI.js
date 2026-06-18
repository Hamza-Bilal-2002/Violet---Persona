import GUI from 'lil-gui';

export function setupGUI(

  expressionManager,
  animationManager,
  vrm,
  boundingSphereHelper

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