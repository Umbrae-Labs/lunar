const { withGradleProperties } = require('expo/config-plugins');

function positiveInteger(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

module.exports = function withAndroidBuildMemory(config) {
  // Opt in from the Linux build script; retain Expo defaults for local development.
  if (!process.env.LUNAR_ANDROID_GRADLE_HEAP_MB) return config;

  const heap = positiveInteger('LUNAR_ANDROID_GRADLE_HEAP_MB');
  const kotlinHeap = positiveInteger('LUNAR_ANDROID_KOTLIN_HEAP_MB', '2048');
  const workers = positiveInteger('LUNAR_ANDROID_GRADLE_WORKERS', '4');
  const properties = {
    'org.gradle.jvmargs': `-Xmx${heap}m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8`,
    'org.gradle.workers.max': workers,
    'org.gradle.parallel': 'true',
    // Kotlin otherwise inherits the enlarged Gradle heap limit.
    'kotlin.daemon.jvmargs': `-Xmx${kotlinHeap}m -XX:MaxMetaspaceSize=512m`,
  };

  return withGradleProperties(config, (mod) => {
    mod.modResults = mod.modResults.filter(
      (entry) => entry.type !== 'property' || !Object.hasOwn(properties, entry.key),
    );
    for (const [key, value] of Object.entries(properties)) {
      mod.modResults.push({ type: 'property', key, value });
    }
    return mod;
  });
};
