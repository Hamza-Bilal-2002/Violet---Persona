import * as THREE from 'three';

import { FBXLoader }
from 'three/examples/jsm/loaders/FBXLoader.js';

import { mixamoVRMBoneMap }
from '../boneMap.js';

export class AnimationManager {

  constructor(vrm) {

    this.vrm =
      vrm;

    this.mixer =
      new THREE.AnimationMixer(
        vrm.scene
      );

    this.actions = {};

    this.currentAction =
      null;

    // tracks which non-idle action is "live"
    // (playing or looping). Used to start the
    // cooldown when that action gets superseded
    // by another play() before it ends naturally.

    this.currentNonIdle =
      null;

    // ======================
    // COOLDOWNS
    // ======================

    // cooldown timestamps: when did each animation
    // become re-playable. set on END or SUPERSEDE,
    // not on play-start (Approach A).

    this.cooldowns =
      new Map();

    // per-animation cooldown duration overrides.
    // populated by loadAnimation() from config.
    // missing entry -> use defaultCooldown.

    this.cooldownDurations =
      new Map();

    this.defaultCooldown =
      5000;

    // ======================
    // AUTO RETURN TO IDLE
    // ======================

    this.mixer.addEventListener(
      'finished',
      (event) => {

        const finishedAction =
          event.action;

        const finishedName =
          Object.keys(
            this.actions
          ).find(

            (key) =>

              this.actions[key] ===
              finishedAction

          );

        if (
          finishedName === 'idle'
        ) {

          return;

        }

        console.log(
          `Animation finished: ${finishedName}`
        );

        // start cooldown NOW that the clip
        // actually ended (not when it began).

        this._startCooldown(
          finishedName
        );

        this.currentAction =
          null;

        if (
          this.currentNonIdle ===
          finishedName
        ) {

          this.currentNonIdle =
            null;

        }

        this.play(
          'idle',
          {
            loop: true,
            fade: 0.4,
          }
        );

      }
    );

  }

  // ======================
  // COOLDOWN HELPER
  // ======================

  _startCooldown(name) {

    if (!name) {

      return;

    }

    const duration =

      this.cooldownDurations
        .get(name) ??
      this.defaultCooldown;

    // duration <= 0 means "never blocked"
    // (talking is configured this way so
    // it can re-trigger across dialogue turns).

    if (duration <= 0) {

      return;

    }

    this.cooldowns.set(

      name,

      Date.now() + duration

    );

  }

  // ======================
  // LOAD ANIMATION
  // ======================

  async loadAnimation(
    name,
    url,
    options = {}
  ) {

    console.log(
      `Loading animation: ${name}`
    );

    // store per-animation cooldown override
    // if provided in config. 0 means "never
    // blocked", positive number = ms.

    if (
      typeof options.cooldown === 'number'
    ) {

      this.cooldownDurations.set(
        name,
        options.cooldown
      );

    }

    const loader =
      new FBXLoader();

    const asset =
      await loader.loadAsync(
        url
      );

    const clip =

      THREE.AnimationClip
        .findByName(
          asset.animations,
          'mixamo.com'
        )

      ||

      asset.animations[0];

    if (!clip) {

      console.warn(
        `No clip found for ${name}`
      );

      return null;

    }

    const tracks = [];

    const restRotationInverse =
      new THREE.Quaternion();

    const parentRestWorldRotation =
      new THREE.Quaternion();

    const _quatA =
      new THREE.Quaternion();

    // ======================
    // HIPS SCALE
    // ======================

    const motionHips =

      asset.getObjectByName(
        'mixamorigHips'
      )

      ||

      asset.getObjectByName(
        'mixamorig:Hips'
      );

    let hipsPositionScale =
      1.0;

    if (motionHips) {

      const motionHipsHeight =
        motionHips.position.y;

      const vrmHipsHeight =

        this.vrm.humanoid
          .normalizedRestPose
          .hips.position[1];

      hipsPositionScale =

        vrmHipsHeight /
        motionHipsHeight;

    }

    // ======================
    // PROCESS TRACKS
    // ======================

    clip.tracks.forEach(
      (track) => {

        const trackSplitted =
          track.name.split('.');

        let mixamoRigName =
          trackSplitted[0];

        const propertyName =
          trackSplitted[1];

        mixamoRigName =

          mixamoRigName

            .replace(
              'mixamorig:',
              'mixamorig'
            )

            .replace(
              'Armature|',
              ''
            );

        const vrmBoneName =

          mixamoVRMBoneMap[
            mixamoRigName
          ];

        if (!vrmBoneName) {

          return;

        }

        const vrmNode =

          this.vrm.humanoid
            ?.getNormalizedBoneNode(
              vrmBoneName
            );

        const vrmNodeName =
          vrmNode?.name;

        if (!vrmNodeName) {

          return;

        }

        const mixamoRigNode =

          asset.getObjectByName(
            trackSplitted[0]
          );

        if (!mixamoRigNode) {

          return;

        }

        mixamoRigNode
          .getWorldQuaternion(
            restRotationInverse
          );

        restRotationInverse
          .invert();

        mixamoRigNode.parent
          ?.getWorldQuaternion(
            parentRestWorldRotation
          );

        // ======================
        // ROTATION TRACKS
        // ======================

        if (

          track instanceof
          THREE.QuaternionKeyframeTrack

        ) {

          for (
            let i = 0;
            i < track.values.length;
            i += 4
          ) {

            const flatQuaternion =
              track.values.slice(
                i,
                i + 4
              );

            _quatA.fromArray(
              flatQuaternion
            );

            _quatA

              .premultiply(
                parentRestWorldRotation
              )

              .multiply(
                restRotationInverse
              );

            _quatA.toArray(
              flatQuaternion
            );

            flatQuaternion.forEach(
              (v, index) => {

                track.values[
                  index + i
                ] = v;

              }
            );

          }

          tracks.push(

            new THREE.QuaternionKeyframeTrack(

              `${vrmNodeName}.${propertyName}`,

              track.times,

              track.values.map(
                (v, i) => (

                  this.vrm.meta
                    ?.metaVersion === '0'
                  &&
                  i % 2 === 0

                    ? -v
                    : v

                )
              )

            )

          );

        }

        // ======================
        // POSITION TRACKS
        // ======================

        else if (

          track instanceof
          THREE.VectorKeyframeTrack

        ) {

          const value =
            track.values.map(

              (v, i) => (

                (
                  this.vrm.meta
                    ?.metaVersion === '0'
                  &&
                  i % 3 !== 1
                )

                  ? -v
                  : v

              ) * hipsPositionScale

            );

          tracks.push(

            new THREE.VectorKeyframeTrack(

              `${vrmNodeName}.${propertyName}`,

              track.times,

              value

            )

          );

        }

      }
    );

    // ======================
    // FINAL CLIP
    // ======================

    const finalClip =
      new THREE.AnimationClip(
        name,
        clip.duration,
        tracks
      );

    const action =
      this.mixer.clipAction(
        finalClip
      );

    action.enabled =
      true;

    this.actions[name] =
      action;

    console.log(
      `Animation loaded: ${name}`
    );

    return action;

  }

  // ======================
  // PLAY
  // ======================

  play(
    name,
    options = {}
  ) {

    // ======================
    // SAME ANIMATION
    // ======================

    if (
      this.currentAction === name
    ) {

      return false;

    }

    // ======================
    // COOLDOWN CHECK
    // ======================

    if (
      name !== 'idle'
    ) {

      const cooldownEnd =
        this.cooldowns.get(
          name
        );

      if (
        cooldownEnd &&
        Date.now() <
        cooldownEnd
      ) {

        console.log(
          `Animation "${name}" is on cooldown`
        );

        return false;

      }

    }

    const action =
      this.actions[name];

    if (!action) {

      console.warn(
        `Animation not found: ${name}`
      );

      return false;

    }

    const {

      fade = 0.6,

      loop =
        name === 'idle',

    } = options;

    console.log(
      `Playing animation: ${name}`
    );

    // ======================
    // SUPERSEDE PREVIOUS
    // ======================

    // if a non-idle animation is currently
    // live and we're switching to something
    // else, retire it: start its cooldown NOW
    // (it would otherwise never start, since
    // loop:true clips don't emit 'finished'
    // and faded-out actions don't either).

    if (
      this.currentNonIdle &&
      this.currentNonIdle !== name
    ) {

      this._startCooldown(
        this.currentNonIdle
      );

    }

    // ======================
    // FADE OUT OTHERS
    // ======================

    Object.entries(
      this.actions
    ).forEach(

      ([key, otherAction]) => {

        if (key !== name) {

          otherAction.fadeOut(
            fade
          );

        }

      }

    );

    // ======================
    // RESET
    // ======================

    action.reset();

    // ======================
    // LOOP SETTINGS
    // ======================

    if (loop) {

      action.setLoop(
        THREE.LoopRepeat,
        Infinity
      );

      action.clampWhenFinished =
        false;

    }

    else {

      action.setLoop(
        THREE.LoopOnce,
        1
      );

      action.clampWhenFinished =
        true;

    }

    // ======================
    // PLAY
    // ======================

    action.enabled =
      true;

    action
      .setEffectiveWeight(1)
      .setEffectiveTimeScale(1);

    action
      .fadeIn(fade)
      .play();

    this.currentAction =
      name;

    // track the "live" non-idle animation so
    // we know what to retire on the next play().

    this.currentNonIdle =
      name === 'idle'
        ? null
        : name;

    return true;

  }

  // ======================
  // STOP
  // ======================

  stop(name) {

    const action =
      this.actions[name];

    if (!action) {

      return;

    }

    action.stop();

  }

  // ======================
  // FORCE CLEAR COOLDOWN
  // ======================

  clearCooldown(name) {

    this.cooldowns.delete(
      name
    );

  }

  // ======================
  // UPDATE
  // ======================

  update(delta) {

    if (!this.mixer) {

      return;

    }

    this.mixer.update(
      delta
    );

  }

}