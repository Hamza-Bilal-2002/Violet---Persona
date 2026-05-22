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
  // MOUSE -> NDC -> RAY + ANGLES
  // ======================

  _onMouseMove(event) {

    const ndcX =
      (event.clientX / window.innerWidth) *
      2 -
      1;

    const ndcY =
      -(event.clientY / window.innerHeight) *
      2 +
      1;

    this._ndc.x =
      ndcX;

    this._ndc.y =
      ndcY;

    // ---- target position (for vrm.lookAt eyes) ----

    this._raycaster.setFromCamera(
      this._ndc,
      this.camera
    );

    // place the desired target at a fixed distance along
    // the cursor ray. this is camera-relative, so as the
    // camera orbits, the eyes still track correctly.

    this._desiredPosition
      .copy(this._raycaster.ray.origin)
      .add(

        this._raycaster.ray.direction
          .clone()
          .multiplyScalar(this.distance)

      );

    // NOTE (Phase 2.A): the head Euler used to be derived from NDC
    // here, but that assumed the avatar lived at the window center.
    // With the avatar moved to a bottom-right viewport, the head
    // Euler is now computed in update() from the world-space
    // direction between the head bone and the actual lookAt target.
    // The target itself (above) is still placed correctly because
    // the raycaster uses the camera's projection.

  }

  // ======================
  // PER-FRAME
  // ======================

  update(delta) {

    if (
      !this.target ||
      !this.vrm ||
      !this.vrm.lookAt
    ) {

      return;

    }

    // gate by animation state: only follow the cursor when
    // no transient animation is playing. otherwise let the
    // animation own the head — we touch nothing.

    const isIdleState =
      !this.animationManager ||
      this.animationManager.currentNonIdle === null;

    this.enabled =
      isIdleState;

    // frame-rate-independent lerp. alpha approaches 1 as delta
    // grows; at 60fps and smoothing=0.25, alpha ~= 0.25 per frame.

    const alpha =
      1 -
      Math.pow(
        1 - this.smoothing,
        delta * 60
      );

    // ---- lookAt target (eyes) ----

    const desiredTargetPos =
      this.enabled
        ? this._desiredPosition
        : this._neutralPosition;

    this.target.position.lerp(
      desiredTargetPos,
      alpha
    );

    // ---- head bone (raw-bone rotation override when idle) ----

    if (
      this.headBone &&
      this._headRestQuat
    ) {

      if (this.enabled) {

        // Phase 2.A: derive desired yaw/pitch from the WORLD-space
        // direction between the head bone and the lookAt target,
        // transformed into the head bone's parent's local frame.
        // This works regardless of where the avatar lives on the
        // screen — the eyes and head share a single source of truth
        // (the target position), instead of the head reading window
        // NDC and the eyes reading world coordinates.

        const headParent =
          this.headBone.parent;

        if (headParent) {

          // Make sure the head parent's world matrix is current
          // for the conversion. vrm.update has already run this
          // frame, but the lerped target.position was just updated
          // above — its world matrix is also stale relative to
          // this frame's reads, but for a parented Object3D in the
          // scene, world position == local position relative to the
          // scene root, and we only need the head parent's matrix.

          headParent.updateWorldMatrix(
            true,
            false
          );

          // Convert the target world position into the head bone's
          // parent's local space. `worldToLocal` MUTATES its
          // argument, so we copy the target position into a scratch
          // vector first.

          const localTarget =
            this._scratchVecB.copy(
              this.target.position
            );

          headParent.worldToLocal(
            localTarget
          );

          // Direction from the head bone to the target, in the
          // parent's local frame. The head bone's local position
          // is already expressed in this same frame.

          const localDir =
            this._scratchVecA
              .copy(localTarget)
              .sub(this.headBone.position);

          // Yaw around the parent's local Y axis (left/right turn).
          // Pitch around X is negated because positive pitch (look
          // up) corresponds to a negative Y-direction sign when we
          // project onto the XZ plane.

          const desiredYaw =
            Math.atan2(localDir.x, localDir.z);

          const horizLen =
            Math.sqrt(
              localDir.x * localDir.x +
              localDir.z * localDir.z
            );

          const desiredPitch =
            -Math.atan2(localDir.y, horizLen);

          // Clamp to the configured limits so extreme cursor
          // positions don't snap the neck.

          this._desiredYaw =
            Math.max(
              -this.maxYawRad,
              Math.min(this.maxYawRad, desiredYaw)
            );

          this._desiredPitch =
            Math.max(
              -this.maxPitchRad,
              Math.min(this.maxPitchRad, desiredPitch)
            );

        }

        this._currentHeadYaw +=
          (this._desiredYaw - this._currentHeadYaw) *
          alpha;

        this._currentHeadPitch +=
          (this._desiredPitch - this._currentHeadPitch) *
          alpha;

        // Compose: final = rest * offset.
        // YXZ keeps yaw (around Y) the outermost rotation, so
        // looking left/right behaves intuitively even when
        // there is some pitch. The rest quaternion captures the
        // model's authored head orientation; multiplying our
        // cursor-derived offset on top keeps the head in a
        // valid pose. Overwrites whatever the idle clip wrote —
        // acceptable in v1; the small idle head sway loses to
        // cursor tracking when idle.

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

        // throttled diagnostic. once every ~120 frames is
        // enough to confirm angles are sensible without
        // spamming.

        this._diagFrameCount++;

        if (
          this._diagFrameCount % 120 === 0
        ) {

          console.debug(
            '[LookAt] desired yaw/pitch:',
            this._desiredYaw.toFixed(3),
            this._desiredPitch.toFixed(3)
          );

        }

      } else {

        // non-idle: let the animation own the head. Also
        // decay our cached current angles back toward zero
        // so when we resume control, there is no snap from
        // a stale value.

        this._currentHeadYaw +=
          (0 - this._currentHeadYaw) *
          alpha;

        this._currentHeadPitch +=
          (0 - this._currentHeadPitch) *
          alpha;

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
