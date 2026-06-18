import * as THREE from 'three';

const clock =
  new THREE.Clock();

export function startUpdateLoop({

  renderer,
  scene,
  camera,
  controls,
  animationManager,
  vrm,
  lipSyncManager,
  dialogueManager,
  lookAtManager,
  getAvatarViewport,
  onFrame,

}) {

  function animate() {

    requestAnimationFrame(
      animate
    );

    // ======================
    // SKIP-WHEN-HIDDEN
    // ======================
    //
    // When the BrowserWindow is hidden (tray "Hide", OS minimize,
    // or full occlusion), Chromium fires visibilitychange and sets
    // document.hidden=true. We do zero per-frame work in that
    // state: no animation advance, no VRM evaluate, no GPU draw.
    //
    // rAF stays armed so we resume cleanly on visibility change.
    // We still drain clock.getDelta() so the first visible frame
    // doesn't get the entire hidden interval dumped on it (which
    // would jump-cut every animation forward).

    if (document.hidden) {

      clock.getDelta();

      return;

    }

    const delta =
      clock.getDelta();

    // ======================
    // CONTROLS
    // ======================

    controls.update();

    // ======================
    // ANIMATIONS
    // ======================

    if (
      animationManager
    ) {

      animationManager.update(
        delta
      );

    }

    // ======================
    // VRM UPDATE
    // ======================

    if (vrm) {

      vrm.update(
        delta
      );

    }

    // ======================
    // LOOK AT
    // ======================

    // MUST run AFTER vrm.update. The animation mixer (in
    // animationManager.update via vrm.update's downstream
    // bone evaluation) writes the head bone every frame. If
    // we set our cursor-driven head rotation before that, the
    // mixer immediately overwrites us and the head appears
    // frozen relative to the cursor. Running last on the
    // head-affecting chain (before render) lets our write
    // stick for the frame.

    if (lookAtManager) {

      // Pass the avatar's viewport so LookAtManager can compute
      // cursor offset from the avatar's actual screen center
      // (instead of the window center, which doesn't apply when
      // the avatar lives in a sub-region of the canvas).
      // viewport is in CSS pixels with WebGL bottom-left origin.

      lookAtManager.update(
        delta,
        getAvatarViewport
          ? getAvatarViewport(
              renderer.domElement.clientWidth,
              renderer.domElement.clientHeight
            )
          : null
      );

    }

    // ======================
    // LIP SYNC
    // ======================

    // runs after vrm.update so expression
    // weights aren't overwritten this frame

    if (lipSyncManager) {

      lipSyncManager.update(
        delta
      );

    }

    // ======================
    // EXPRESSION VARIATION
    // ======================

    // Runs after lip-sync so the amplitude read by
    // dialogueManager.update() reflects this frame's
    // freshly-smoothed value, not last frame's.

    if (dialogueManager) {

      dialogueManager.update(
        delta
      );

    }

    // ======================
    // RENDER (viewport-clipped)
    // ======================

    // Phase 2.A: the canvas covers the entire OS work area, but
    // the avatar only occupies a sub-region of it (bottom-right).
    // We clear the whole canvas to transparent each frame, then
    // scissor + viewport the avatar's box so only that region
    // gets drawn into. The rest of the framebuffer stays at
    // alpha=0 and the Electron compositor passes clicks through.
    //
    // Three.js's setViewport/setScissor accept values in
    // CSS-pixel-equivalent units and INTERNALLY multiply by
    // _pixelRatio before calling gl.viewport. So we MUST pass
    // CSS-pixel sizes here — using framebuffer pixels would
    // cause three to multiply by DPR a second time and push the
    // viewport off-canvas on any high-DPR display (the symptom
    // was the avatar being mostly clipped to the right edge).

    const canvasW =
      renderer.domElement.clientWidth;

    const canvasH =
      renderer.domElement.clientHeight;

    // Default viewport: full canvas. Used in the browser dev case
    // where no viewport function is supplied (the avatar fills the
    // window like Phase 1's small overlay used to).

    const vp =
      typeof getAvatarViewport === 'function'
        ? getAvatarViewport(canvasW, canvasH)
        : {
            x: 0,
            y: 0,
            width: canvasW,
            height: canvasH,
          };

    // 1) Clear the entire canvas to transparent.

    renderer.setScissorTest(false);

    renderer.setViewport(
      0,
      0,
      canvasW,
      canvasH
    );

    renderer.clear();

    // 2) Restrict drawing to the avatar sub-region and render.

    renderer.setScissorTest(true);

    renderer.setScissor(
      vp.x,
      vp.y,
      vp.width,
      vp.height
    );

    renderer.setViewport(
      vp.x,
      vp.y,
      vp.width,
      vp.height
    );

    // Keep the camera aspect matched to the viewport, not the
    // window. Otherwise the avatar would render squashed/stretched
    // because the projection still assumes a window-shaped frame.

    if (vp.height > 0) {

      const aspect =
        vp.width / vp.height;

      if (
        Math.abs(camera.aspect - aspect) > 0.001
      ) {

        camera.aspect =
          aspect;

        camera.updateProjectionMatrix();

      }

    }

    renderer.render(
      scene,
      camera
    );

    // ======================
    // POST-FRAME HOOK
    // ======================

    // Runs after render so any post-frame work (e.g., Electron
    // click-through hit-testing in AvatarRuntime) sees the latest
    // camera/viewport state for this frame.

    if (
      typeof onFrame === 'function'
    ) {

      onFrame(
        {
          canvasW,
          canvasH,
          viewport: vp,
        }
      );

    }

  }

  animate();

}
