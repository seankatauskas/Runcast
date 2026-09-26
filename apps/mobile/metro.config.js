const { getSentryExpoConfig } = require('@sentry/react-native/metro');

const config = getSentryExpoConfig(__dirname, {
  annotateReactComponents: false,
  autoWrapExpoRouterErrorBoundary: false,
  includeWebReplay: false,
  includeWebFeedback: false,
});

// expo-sqlite uses a WASM worker on web. Metro does not include `.wasm` in its
// asset extensions by default, so the worker cannot be bundled without this.
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}

module.exports = config;
