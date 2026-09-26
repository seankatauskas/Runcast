Pod::Spec.new do |s|
  s.name = 'MutationStorage'
  s.version = '1.0.0'
  s.summary = 'Durable, backup-excluded offline mutation storage'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Runcast'
  s.homepage = 'https://runcast.app'
  s.platforms = { :ios => '16.4' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.swift_version = '5.9'
  s.source_files = '**/*.{h,m,mm,swift}'
end
