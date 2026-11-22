const path = require('node:path');
const { withGradleProperties, withPodfile } = require('expo/config-plugins');

/**
 * Compiles the reader's page compositor into react-native-skia's native
 * library, through the picture-extension hook of the project's Skia patch:
 * Android reads the `rnskiaPictureExtensionDir` Gradle property, iOS the
 * RNSKIA_PICTURE_EXTENSION_DIR environment variable while pods are installed.
 */
const EXTENSION_PATH = ['modules', 'reader-composer', 'cpp'];
const GRADLE_PROPERTY = 'rnskiaPictureExtensionDir';
const PODFILE_MARKER = '# lunar: reader composer';

function withAndroidReaderComposer(config) {
  return withGradleProperties(config, (mod) => {
    const extensionDir = path.join(mod.modRequest.projectRoot, ...EXTENSION_PATH);
    mod.modResults = mod.modResults.filter((entry) => entry.type !== 'property' || entry.key !== GRADLE_PROPERTY);
    // Gradle properties treat backslashes as escapes; CMake accepts forward slashes everywhere.
    mod.modResults.push({ type: 'property', key: GRADLE_PROPERTY, value: extensionDir.replaceAll('\\', '/') });
    return mod;
  });
}

function withIosReaderComposer(config) {
  return withPodfile(config, (mod) => {
    const contents = mod.modResults.contents;
    if (!contents.includes(PODFILE_MARKER)) {
      // The podspec is evaluated when pods are installed, after this line runs.
      const segments = EXTENSION_PATH.map((segment) => `'${segment}'`).join(', ');
      const line = `ENV['RNSKIA_PICTURE_EXTENSION_DIR'] = File.join(__dir__, '..', ${segments}) ${PODFILE_MARKER}`;
      mod.modResults.contents = `${line}\n${contents}`;
    }
    return mod;
  });
}

module.exports = function withReaderComposer(config) {
  return withIosReaderComposer(withAndroidReaderComposer(config));
};
