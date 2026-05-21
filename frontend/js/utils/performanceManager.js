export function optimizeRenderer(
  renderer
) {

  // ======================
  // PIXEL RATIO
  // ======================

  renderer.setPixelRatio(

    Math.min(

      window.devicePixelRatio,
      1.5

    )

  );

  // ======================
  // PERFORMANCE
  // ======================

  renderer.powerPreference =
    'high-performance';

  renderer.shadowMap.enabled =
    false;

  // ======================
  // COLOR SPACE
  // ======================

  renderer.outputColorSpace =
    'srgb';

  // ======================
  // OPTIONAL OPTIMIZATIONS
  // ======================

  renderer.sortObjects =
    true;

  renderer.info.autoReset =
    true;

  // ======================
  // LOG
  // ======================

  console.log(
    'Renderer optimized'
  );

}