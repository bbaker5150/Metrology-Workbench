// Vite's dynamic-import helper probes <link> support even with modulePreload
// disabled. Firepit forbids creating that element. This build has no external
// chunks or styles to preload, so retain only asynchronous module evaluation
// and Vite's public preload-error event contract.
const PRELOAD_HELPER_ID = '\0vite/preload-helper.js';
const helperSource = `
export function __vitePreload(baseModule) {
  return Promise.resolve().then(baseModule).catch(error => {
    const event = new Event('vite:preloadError', { cancelable: true });
    event.payload = error;
    window.dispatchEvent(event);
    if (!event.defaultPrevented) throw error;
  });
}
`;

export function singlefileNoPreload() {
  let helperLoaded = false;
  return {
    name: 'singlefile-no-preload',
    apply: 'build',
    enforce: 'pre',
    buildStart() { helperLoaded = false; },
    configResolved(config) {
      const output = config.build.rollupOptions.output;
      const outputs = Array.isArray(output) ? output : [output];
      if (config.build.modulePreload !== false || config.build.cssCodeSplit !== false ||
          !outputs.length || outputs.some(value => value?.inlineDynamicImports !== true)) {
        throw new Error('singlefile-no-preload requires modulePreload:false, cssCodeSplit:false and inlineDynamicImports:true.');
      }
    },
    resolveId(id) {
      if (id === PRELOAD_HELPER_ID) return id;
    },
    load(id) {
      if (id === PRELOAD_HELPER_ID) {
        helperLoaded = true;
        return { code: helperSource, moduleSideEffects: false };
      }
    },
    generateBundle: {
      // Run after the HTML inliner. Fail closed if a future configuration leaves
      // JS/CSS dependencies that the local-only helper would otherwise skip.
      order: 'post',
      handler(_options, bundle) {
        if (!helperLoaded) {
          this.error('singlefile-no-preload did not intercept the Vite import helper. Review Vite compatibility before shipping this app.');
        }
        const external = Object.values(bundle).filter(file =>
          file.type === 'chunk' || /\.(?:[cm]?js|css)$/i.test(file.fileName));
        const html = Object.values(bundle).filter(file => /\.html?$/i.test(file.fileName));
        if (external.length || !html.length || html.some(file =>
          /<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel\s*=\s*["'](?:stylesheet|modulepreload)["']/i.test(String(file.source)))) {
          this.error('singlefile-no-preload requires all JavaScript and CSS to be inlined in the final HTML.');
        }
      },
    },
  };
}
