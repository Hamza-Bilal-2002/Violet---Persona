import {
  GLTFLoader
} from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  VRMLoaderPlugin,
  VRMUtils,
} from '@pixiv/three-vrm';

// ======================
// LOAD VRM
// ======================

export async function loadVRM(
  scene,
  modelPath
) {

  const loader =
    new GLTFLoader();

  // ======================
  // VRM PLUGIN
  // ======================

  loader.register(

    (parser) => {

      return new VRMLoaderPlugin(
        parser
      );

    }

  );

  // ======================
  // LOAD MODEL
  // ======================

  const gltf =
    await loader.loadAsync(
      modelPath
    );

  const vrm =
    gltf.userData.vrm;

  // ======================
  // VRM 0.0 FIX
  // ======================

  VRMUtils.rotateVRM0(
    vrm
  );

  // ======================
  // OPTIMIZATION
  // ======================

  vrm.scene.traverse(

    (obj) => {

      if (obj.isMesh) {

        obj.frustumCulled =
          false;

        obj.castShadow =
          true;

        obj.receiveShadow =
          true;

      }

    }

  );

  // ======================
  // ADD TO SCENE
  // ======================

  scene.add(
    vrm.scene
  );

  console.log(
    'VRM Loaded Successfully'
  );

  return vrm;

}