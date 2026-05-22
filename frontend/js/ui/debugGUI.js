import GUI from 'lil-gui';

export function setupGUI(

  expressionManager,
  animationManager

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