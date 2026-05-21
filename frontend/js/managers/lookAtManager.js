import * as THREE from 'three';

/**
 * LookAtManager
 *
 * Drives the VRM's head and eye look direction. When the avatar is
 * idle (no transient animation playing), the head and eyes track the
 * mouse cursor. When a non-idle animation is playing (talking,
 * waving, reacting, etc.), the look target smoothly returns to a
 * forward neutral position so the animation's head motion is not
 * overridden by cursor tracking.
 *
 * Architecture:
 *   - Owns one Object3D placed in world space — the look target.
 *   - Assigns that target to vrm.lookAt.target.
 *   - On mousemove, projects the cursor through the camera onto a
 *     plane at a fixed distance and stores that as the DESIRED
 *     target position.
 *   - update(delta) lerps the actual target toward the desired
 *     position, frame-rate-independent.
 *   - Polls animationManager.currentNonIdle each frame to choose
 *     between cursor mode (desired = projected) and neutral mode
 *     (desired = forward).
 */

export class LookAtManager {

  constructor({
    vrm,
    camera,
    animationManager,
    options = {},
  }) {

    this.vrm =
      vrm;

    this.camera =
      camera;

    this.animationManager =
      animationManager;

    // higher = snappier head tracking. 0.15 gives a calm,
    // human-feeling delay. tune in updateLoop calls per frame.

    this.smoothing =
      options.smoothing ?? 0.15;

    // distance from the camera at which the look target sits.
    // closer = more sensitive head movement per cursor pixel.

    this.distance =
      options.distance ?? 2.0;

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
        'LookAtManager: vrm.lookAt missing — tracking disabled'
      );

    }

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
  // MOUSE -> RAY -> WORLD
  // ======================

  _onMouseMove(event) {

    this._ndc.x =
      (event.clientX / window.innerWidth) *
      2 -
      1;

    this._ndc.y =
      -(event.clientY / window.innerHeight) *
      2 +
      1;

    this._raycaster.setFromCamera(
      this._ndc,
      this.camera
    );

    // place the desired target at a fixed distance along
    // the cursor ray. this is camera-relative, so as the
    // camera orbits, the head still tracks correctly.

    this._desiredPosition
      .copy(this._raycaster.ray.origin)
      .add(

        this._raycaster.ray.direction
          .clone()
          .multiplyScalar(this.distance)

      );

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
    // no transient animation is playing. otherwise return
    // smoothly to forward so animations drive the head.

    const isIdleState =
      !this.animationManager ||
      this.animationManager.currentNonIdle === null;

    this.enabled =
      isIdleState;

    const desired =
      this.enabled
        ? this._desiredPosition
        : this._neutralPosition;

    // frame-rate-independent lerp. alpha approaches 1 as delta
    // grows; at 60fps and smoothing=0.15, alpha ~= 0.15 per frame.

    const alpha =
      1 -
      Math.pow(
        1 - this.smoothing,
        delta * 60
      );

    this.target.position.lerp(
      desired,
      alpha
    );

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
      this.vrm &&
      this.vrm.lookAt &&
      this.vrm.lookAt.target === this.target
    ) {

      this.vrm.lookAt.target = null;

    }

  }

}
