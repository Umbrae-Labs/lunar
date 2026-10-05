const { getDefaultConfig } = require('expo/metro-config');
const { withUniwindConfig } = require('uniwind/metro');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

const uniwindConfig = withUniwindConfig(config, {
  cssEntryFile: './src/global.css',
  dtsFile: './src/uniwind-types.d.ts',
});

// Uniwind's own component proxy must resolve the real React Native package.
const uniwindResolver = uniwindConfig.resolver.resolveRequest;
uniwindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === 'react-native' &&
    context.originModulePath.includes(`${path.sep}uniwind${path.sep}`)
  ) {
    return context.resolveRequest(context, moduleName, platform);
  }
  return uniwindResolver(context, moduleName, platform);
};

module.exports = uniwindConfig;
