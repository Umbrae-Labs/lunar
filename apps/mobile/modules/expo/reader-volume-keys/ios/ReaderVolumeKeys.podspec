Pod::Spec.new do |spec|
  spec.name = 'ReaderVolumeKeys'
  spec.version = '1.0.0'
  spec.summary = 'Volume key page turning for Lunar'
  spec.homepage = 'https://github.com/Saramanda9988/lunar'
  spec.license = { :type => 'MIT' }
  spec.authors = { 'Lunar' => 'https://github.com/Saramanda9988/lunar' }
  spec.platforms = { :ios => '16.4' }
  spec.source = { :path => '.' }
  spec.static_framework = true
  spec.swift_version = '5.9'
  spec.source_files = '**/*.swift'
  spec.frameworks = 'AVFoundation', 'MediaPlayer'
  spec.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  spec.dependency 'ExpoModulesCore'
end
