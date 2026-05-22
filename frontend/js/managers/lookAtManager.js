import * as THREE from 'three';

/**
 * LookAtManager
 *
 * Drives the VRM's head and eye look direction. When the avatar is
 * idle (no transient animation playing), the head and eyes track the
 * mouse cursor. When a non-idle animation is playing (talking,
 * waving, reacting, etc.), cursor tracking yields entirely so the
 * animation owns the head bone.
 *
 * Why we drive the head bone directly:
 *   VRM 1.0 models commonly ship with `lookAt.applier.type ===
 *   'expression'`, which means `vrm.lookAt.target` only moves the
 *   EYES (via blendshapes) and never rotates the head bone. The
 *   user expects the head to physically turn toward the cursor, so
 *   we set the head bone's local rotation ourselves in addition to
 *   the standard lookAt target (the latter still benefits eyes).
 *
 * Per-frame order contract (see runtime/updateLoop.js):
 *   controls -> animationManager -> vrm -> lookAtManager -> ...
 *
 *   We must run AFTER vrm.update so that the animation mixer's
 *   write to the head bone is in place — then we overwrite it with
 *   our lerped Euler. If we ran before vrm.update, the mixer would
 *   clobber us every frame and the head would never move.
 */

export class LookAtManager {

  constructor({
    vrm,
    camera,
    scene,
    animationManager,
    options = {},
  }) {

    this.vrm =
      vrm;

    this.camera =
      camera;

    this.scene =
      scene;

    this.animationManager =
      animationManager;

    // higher = snappier head tracking. 0.25 gives a visibly
    // responsive but still smooth follow at 60fps.

    this.smoothing =
      options.smoothing ?? 0.25;

    // distance from the camera at which the look target sits.
    // closer = more sensitive head movement per cursor pixel.

    this.distance =
      options.distance ?? 2.0;

    // max head rotation (radians) at the screen edges. ~26°
    // yaw, ~17° pitch is roughly what feels natural without
    // breaking the neck mesh.

    this.maxYawRad =
      options.maxYawRad ?? 0.45;

    this.maxPitchRad =
      options.maxPitchRad ?? 0.30;

    // How far the cursor must travel from the avatar's screen
    // center (in CSS pixels) to drive the head to maxYaw /
    // maxPitch. Tune for screen size: ~700 / 500 is a sensible
    // default for ~1920x1080 — cursor needs roughly half the
    // screen distance from the avatar to reach full deflection.
    // Smaller value = more sensitive (head reacts to small cursor
    // moves); larger value = less sensitive.

    this.sensitivityX =
      options.sensitivityX ?? 700;

    this.sensitivityY =
      options.sensitivityY ?? 500;

    // ======================
    // STATE
    // ======================

    this.enabled =
      true;

    this.target =
      new THREE.Object3D();

    // start the target at a sensible forward position so the
    // first frame doesn't snap from origin.

    this.target.position.set(
      0,
      1.4,
      this.distance
    );

    this._desiredPosition =
      new THREE.Vector3(
        0,
        1.4,
        this.distance
      );

    this._neutralPosition =
      new THREE.Vector3(
        0,
        1.4,
        this.distance
      );

    this._raycaster =
      new THREE.Raycaster();

    this._ndc =
      new THREE.Vector2();

    // desired head Euler — set from mousemove. lerped toward
    // by `_currentHeadYaw` / `_currentHeadPitch` each frame.

    this._desiredYaw =
      0;

    this._desiredPitch =
      0;

    this._currentHeadYaw =
      0;

    this._currentHeadPitch =
      0;

    // diagnostic throttle for the per-frame desired-angles log.

    this._diagFrameCount =
      0;

    // ======================
    // BIND TO VRM
    // ======================

    if (
      vrm &&
      vrm.lookAt
    ) {

      vrm.lookAt.target =
        this.target;

    } else {

      console.warn(
        'LookAtManager: vrm.lookAt missing — eye tracking disabled'
      );

    }

    // Attach the target to the scene so its world matrix is
    // updated by three.js each frame. Without a parent in the
    // scene graph, vrm.lookAt would read a stale matrix and
    // eye direction would lag or freeze.

    if (
      this.scene &&
      !this.target.parent
    ) {

      this.scene.add(
        this.target
      );

    }

    // Cache the head bone reference.
    //
    // We use the RAW bone, not the normalized one. Three-vrm
    // propagates normalized -> raw inside vrm.update; our
    // LookAtManager runs AFTER vrm.update (per updateLoop), so
    // writes to the normalized head are dropped — there's no
    // propagation pass left this frame. Writing directly to the
    // raw bone is the only path that affects rendering this
    // frame.
    //
    // Side effect: raw bones carry the model's authored rest
    // rotation, so we can't just write Euler(yaw, pitch) — we
    // must compose with the rest quaternion (captured at
    // construction). See update() below.

    this.headBone =
      (
        vrm &&
        vrm.humanoid &&
        typeof vrm.humanoid.getRawBoneNode === 'function'
      )
        ? vrm.humanoid.getRawBoneNode('head')
        : null;

    if (!this.headBone) {

      console.warn(
        'LookAtManager: head bone not found — head rotation disabled'
      );

    }

    // Capture the head's rest orientation. We multiply this with
    // our cursor-driven offset quaternion each frame so the head
    // ends up at "rest * offset" rather than overwriting the
    // authored pose with raw Euler values.

    this._headRestQuat =
      this.headBone
        ? this.headBone.quaternion.clone()
        : null;

    // Scratch quaternion + euler reused per-frame to avoid GC.

    this._tmpEuler =
      new THREE.Euler(0, 0, 0, 'YXZ');

    this._tmpQuat =
      new THREE.Quaternion();

    // Phase 2.A: scratch vectors for world-space -> head-parent
    // local-space conversion. The head Euler is now derived from
    // the actual direction from the head bone to the lookAt target
    // (in head-bone-parent's local frame), so the head turns toward
    // the cursor in the world regardless of where the avatar lives
    // on screen. Previously the Euler was computed from window NDC,
    // which assumed the avatar lived at the window center — that
    // assumption broke when the avatar moved to a bottom-right
    // viewport.

    this._scratchVecA =
      new THREE.Vector3();

    this._scratchVecB =
      new THREE.Vector3();

    // One-time diagnostic. Helps us tell from the console
    // which lookAt applier the model uses and confirms the
    // head bone was found.

    console.info(
      '[LookAt] head bone:',
      this.headBone ? this.headBone.name : '(none)',
      'lookAt applier:',
      vrm && vrm.lookAt && vrm.lookAt.applier
        ? vrm.lookAt.applier.constructor.name
        : '(none)'
    );

    // ======================
    // INPUT
    // ======================

    this._onMouseMove =
      this._onMouseMove.bind(this);

    window.addEventListener(
      'mousemove',
      this._onMouseMove,
      { passive: true }
    );

  }

  // ======================
  // MOUSE
  // ======================

  _onMouseMove(event) {

    // Just record the latest cursor position. The math that uses
    // it lives in update() because it needs the per-frame viewport
    // to know where the avatar is on screen.

    this._lastCursorX =
      event.clientX;

    this._lastCursorY =
      event.clientY;

  }

  // ======================
  // PER-FRAME
  // ======================

  update(delta, viewport) {

    if (
      !this.target ||
      !this.vrm ||
      !this.vrm.lookAt
    ) {

      return;

    }

    // gate by animation state: only follow the cursor when
    // no transient animation is playing. otherwise let the
    // animation own the head.

    const isIdleState =
      !this.animationManager ||
      this.animationManager.currentNonIdle === null;

    this.enabled =
      isIdleState;

    // frame-rate-independent lerp.

    const alpha =
      1 -
      Math.pow(
        1 - this.smoothing,
        delta * 60
      );

    // ---- 1) DERIVE YAW / PITCH FROM CURSOR OFFSET ----
    //
    // Map cursor offset from the avatar's SCREEN CENTER (not the
    // window center) to a linear yaw/pitch. This is the same
    // simple math that worked perfectly when the window itself
    // WAS the avatar's frame in Phase 1 — we just compute the
    // origin from the viewport now.
    //
    // sensitivityX / sensitivityY define how far from the avatar
    // (in CSS pixels) the cursor must travel to reach maxYaw /
    // maxPitch. Beyond that, the head saturates at the clamp.

    let avatarCx;
    let avatarCy;

    if (
      viewport &&
      viewport.width > 0 &&
      viewport.height > 0
    ) {

      // viewport.x / .y use WebGL bottom-left origin; convert to
      // CSS coords (top-left origin) for cursor math.

      avatarCx =
        viewport.x + viewport.width / 2;

      avatarCy =
        window.innerHeight -
        (viewport.y + viewport.height / 2);

    } else {

      // browser dev fallback: assume avatar fills the window.

      avatarCx =
        window.innerWidth / 2;

      avatarCy =
        window.innerHeight / 2;

    }

    const dx =
      (this._lastCursorX ?? avatarCx) - avatarCx;

    const dy =
      (this._lastCursorY ?? avatarCy) - avatarCy;

    const nx =
      Math.max(
        -1,
        Math.min(1, dx / this.sensitivityX)
      );

    const ny =
      -Math.max(
        -1,
        Math.min(1, dy / this.sensitivityY)
      );

    if (this.enabled) {

      this._desiredYaw =
        nx * this.maxYawRad;

      this._desiredPitch =
        ny * this.maxPitchRad;

    } else {

      this._desiredYaw =
        0;

      this._desiredPitch =
        0;

    }

    this._currentHeadYaw +=
      (this._desiredYaw - this._currentHeadYaw) *
      alpha;

    this._currentHeadPitch +=
      (this._desiredPitch - this._currentHeadPitch) *
      alpha;

    // ---- 2) BUILD WORLD-SPACE LOOKAT TARGET FOR EYES ----
    //
    // Place the target a fixed distance in front of the head, in
    // the direction defined by the same yaw/pitch we'll apply to
    // the head bone. Eyes and head now share one source of truth,
    // and the target always sits in a sensible world position
    // regardless of where on screen the cursor is.

    if (
      this.headBone &&
      this._headRestQuat
    ) {

      const cy =
        Math.cos(this._currentHeadYaw);

      const sy =
        Math.sin(this._currentHeadYaw);

      const cp =
        Math.cos(this._currentHeadPitch);

      const sp =
        Math.sin(this._currentHeadPitch);

      this._scratchVecA.set(
        sy * cp * this.distance,
        sp * this.distance,
        cy * cp * this.distance
      );

      // Temporarily put the head at its rest orientation so
      // localToWorld uses the rest frame (otherwise our previous
      // frame's offset would compound into the target position).

      const savedQuat =
        this._tmpQuat.copy(
          this.headBone.quaternion
        );

      this.headBone.quaternion.copy(
        this._headRestQuat
      );

      this.headBone.updateWorldMatrix(
        true,
        false
      );

      this._desiredPosition.copy(
        this._scratchVecA
      );

      this.headBone.localToWorld(
        this._desiredPosition
      );

      this.headBone.quaternion.copy(
        savedQuat
      );

    }

    this.target.position.lerp(
      this._desiredPosition,
      alpha
    );

    // ---- 3) APPLY HEAD ROTATION ----
    //
    // Compose: final = rest * offset. The rest quaternion captures
    // the model's authored head orientation; multiplying our
    // cursor-derived offset on top keeps the head in a valid pose.
    // YXZ Euler order keeps yaw (around Y) the outermost rotation
    // so left/right tracking feels intuitive even when there is
    // some pitch.
    //
    // Overwrites whatever the idle clip wrote — acceptable; the
    // small idle head sway loses to cursor tracking when idle, and
    // when non-idle the animation owns the head (we set yaw=pitch=0
    // above and lerp toward it).

    if (
      this.headBone &&
      this._headRestQuat
    ) {

      this._tmpEuler.set(
        this._currentHeadPitch,
        this._currentHeadYaw,
        0,
        'YXZ'
      );

      this._tmpQuat.setFromEuler(
        this._tmpEuler
      );

      this.headBone.quaternion
        .copy(this._headRestQuat)
        .multiply(this._tmpQuat);

      // throttled diagnostic.

      this._diagFrameCount =
        (this._diagFrameCount || 0) + 1;

      if (
        this._diagFrameCount % 120 === 0
      ) {

        console.debug(
          '[LookAt] yaw/pitch (rad):',
          this._currentHeadYaw.toFixed(3),
          this._currentHeadPitch.toFixed(3)
        );

      }

    }

  }

  // ======================
  // CLEANUP
  // ======================

  dispose() {

    window.removeEventListener(
      'mousemove',
      this._onMouseMove
    );

    if (
      this.scene &&
      this.target &&
      this.target.parent === this.scene
    ) {

      this.scene.remove(
        this.target
      );

    }

    if (
      this.vrm &&
      this.vrm.lookAt &&
      this.vrm.lookAt.target === this.target
    ) {

      this.vrm.lookAt.target = null;

    }

  }

}
