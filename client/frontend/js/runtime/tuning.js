// Avatar tuning bridge.
//
// Replaces the old in-overlay lil-gui debug bar. The controls now live in
// the Electron Settings window (a normal, clickable BrowserWindow), which
// drives the live three.js objects through main-process IPC. This module
// is the renderer side of that bridge:
//
//   snapshot()      → current values, sent to the Settings window so its
//                     sliders open at the right position.
//   apply({path,value}) → mutate the live object for one control change.
//   buildSaveData() → the persisted shape for violet-settings.json.
//
// Only user-meaningful tuning is exposed (lighting, camera, on-screen
// position, mesh visibility). The old expression/animation/hit-zone
// developer toys are gone with the debug bar.

import { AVATAR_CONFIG } from '../config/avatarConfig.js';

export function createTuning({ vrm, lights, camera, controls }) {

  // Map mesh name -> object for O(1) visibility application.
  const meshByName = new Map();
  if (vrm && vrm.scene) {
    vrm.scene.traverse((obj) => {
      if (obj.isMesh || obj.isSkinnedMesh) {
        meshByName.set(obj.name || '(unnamed)', obj);
      }
    });
  }

  const hex = (c) => '#' + c.getHexString();

  function snapshot() {
    const l = lights || {};
    const amb = l.ambientLight;
    const key = l.directionalLight;
    const rim = l.rimLight;

    const meshes = [...meshByName.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, obj]) => ({ name, visible: obj.visible }));

    return {
      lighting: {
        ambient: amb ? { color: hex(amb.color), intensity: amb.intensity } : null,
        key:     key ? {
          color: hex(key.color), intensity: key.intensity,
          x: key.position.x, y: key.position.y, z: key.position.z,
        } : null,
        rim:     rim ? {
          color: hex(rim.color), intensity: rim.intensity,
          x: rim.position.x, y: rim.position.y, z: rim.position.z,
        } : null,
      },
      camera: camera ? {
        fov:     camera.fov,
        posX:    camera.position.x,
        posY:    camera.position.y,
        posZ:    camera.position.z,
        targetX: controls?.target.x ?? 0,
        targetY: controls?.target.y ?? 1.2,
        targetZ: controls?.target.z ?? 0,
      } : null,
      position: {
        marginRight:  AVATAR_CONFIG.viewport.marginRight,
        marginBottom: AVATAR_CONFIG.viewport.marginBottom,
        textInputX:   AVATAR_CONFIG.textInput.offsetX,
        textInputY:   AVATAR_CONFIG.textInput.offsetY,
      },
      meshes,
    };
  }

  function apply(change) {
    if (!change || typeof change.path !== 'string') return;
    const { path, value } = change;
    const l = lights || {};

    // ── Mesh visibility ──
    if (path.startsWith('mesh:')) {
      const obj = meshByName.get(path.slice(5));
      if (obj) obj.visible = !!value;
      return;
    }

    switch (path) {
      // ── Lighting ──
      case 'lighting.ambient.color':     l.ambientLight?.color.set(value); break;
      case 'lighting.ambient.intensity': if (l.ambientLight) l.ambientLight.intensity = value; break;

      case 'lighting.key.color':     l.directionalLight?.color.set(value); break;
      case 'lighting.key.intensity': if (l.directionalLight) l.directionalLight.intensity = value; break;
      case 'lighting.key.x':         if (l.directionalLight) l.directionalLight.position.x = value; break;
      case 'lighting.key.y':         if (l.directionalLight) l.directionalLight.position.y = value; break;
      case 'lighting.key.z':         if (l.directionalLight) l.directionalLight.position.z = value; break;

      case 'lighting.rim.color':     l.rimLight?.color.set(value); break;
      case 'lighting.rim.intensity': if (l.rimLight) l.rimLight.intensity = value; break;
      case 'lighting.rim.x':         if (l.rimLight) l.rimLight.position.x = value; break;
      case 'lighting.rim.y':         if (l.rimLight) l.rimLight.position.y = value; break;
      case 'lighting.rim.z':         if (l.rimLight) l.rimLight.position.z = value; break;

      // ── Camera ──
      case 'camera.fov':
        if (camera) { camera.fov = value; camera.updateProjectionMatrix(); }
        break;
      case 'camera.posX': if (camera) camera.position.x = value; break;
      case 'camera.posY': if (camera) camera.position.y = value; break;
      case 'camera.posZ': if (camera) camera.position.z = value; break;
      case 'camera.targetX': if (controls) controls.target.x = value; break;
      case 'camera.targetY': if (controls) controls.target.y = value; break;
      case 'camera.targetZ': if (controls) controls.target.z = value; break;

      // ── On-screen position ──
      case 'position.marginRight':  AVATAR_CONFIG.viewport.marginRight  = value; break;
      case 'position.marginBottom': AVATAR_CONFIG.viewport.marginBottom = value; break;
      case 'position.textInputX':   AVATAR_CONFIG.textInput.offsetX      = value; break;
      case 'position.textInputY':   AVATAR_CONFIG.textInput.offsetY      = value; break;

      default: break;
    }
  }

  function buildSaveData() {
    const v  = AVATAR_CONFIG.viewport;
    const ti = AVATAR_CONFIG.textInput;
    const l  = lights || {};

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
      textInput: { offsetX: ti.offsetX, offsetY: ti.offsetY },
    };

    if (l.ambientLight && l.directionalLight) {
      data.lighting = {
        ambient: {
          color:     hex(l.ambientLight.color),
          intensity: l.ambientLight.intensity,
        },
        directional: {
          color:     hex(l.directionalLight.color),
          intensity: l.directionalLight.intensity,
          position: {
            x: l.directionalLight.position.x,
            y: l.directionalLight.position.y,
            z: l.directionalLight.position.z,
          },
        },
      };
    }

    if (camera) {
      data.camera = {
        fov: camera.fov,
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      };
    }

    if (controls) {
      data.controls = {
        target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      };
    }

    return data;
  }

  function save() {
    if (
      typeof window !== 'undefined' &&
      window.personaShell &&
      typeof window.personaShell.saveSettings === 'function'
    ) {
      window.personaShell.saveSettings(buildSaveData())
        .then(() => console.log('[tuning] settings saved'))
        .catch((err) => console.error('[tuning] save failed', err));
    }
  }

  return { snapshot, apply, save };
}
