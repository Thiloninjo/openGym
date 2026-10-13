# Thilos Fork: trägt beim Codemagic-Build den Pausen-Baustein ins Xcode-Projekt ein (es gibt keinen
# Mac, auf dem man das in Xcode klicken könnte). Fügt der App RestActivityPlugin.swift/.m und die
# gemeinsamen Attribute hinzu und legt die Widget-Erweiterung RestWidget an (Live-Aktivität).
# Aufruf: ruby thilo/ios/add-rest-widget.rb frontend/ios/App/App.xcodeproj <app-bundle-id>
require 'xcodeproj'

proj_path, bundle_id = ARGV
abort 'Aufruf: add-rest-widget.rb <App.xcodeproj> <bundle-id>' unless proj_path && bundle_id
project = Xcodeproj::Project.open(proj_path)
if project.targets.any? { |t| t.name == 'RestWidget' }
  puts 'RestWidget ist schon eingetragen'
  exit 0
end
app = project.targets.find { |t| t.name == 'App' } or abort 'Target App fehlt'
app_cfg = app.build_configurations.first.build_settings

# Dateien der App
app_group = project.main_group.children.find { |g| g.respond_to?(:path) && g.path == 'App' } or abort 'Gruppe App fehlt'
%w[RestActivityPlugin.swift RestActivityPlugin.m].each do |f|
  app.add_file_references([app_group.new_reference(f)])
end

# Widget-Erweiterung
widget = project.new_target(:app_extension, 'RestWidget', :ios, '16.2')
group = project.main_group.new_group('RestWidget', 'RestWidget')
attrs = group.new_reference('RestActivityAttributes.swift')
widget.add_file_references([group.new_reference('RestWidget.swift'), attrs])
group.new_reference('Info.plist')
app.add_file_references([attrs])
%w[WidgetKit SwiftUI ActivityKit].each { |fw| widget.add_system_framework(fw) }

widget.build_configurations.each do |c|
  s = c.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = "#{bundle_id}.RestWidget"
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['INFOPLIST_FILE'] = 'RestWidget/Info.plist'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['SWIFT_VERSION'] = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '16.2'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['MARKETING_VERSION'] = app_cfg['MARKETING_VERSION'] || '1.0'
  s['CURRENT_PROJECT_VERSION'] = app_cfg['CURRENT_PROJECT_VERSION'] || '1'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['SKIP_INSTALL'] = 'YES'
  s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks']
end

app.add_dependency(widget)
embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
embed.dst_subfolder_spec = '13'
embed.add_file_reference(widget.product_reference, true).settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save
puts "RestWidget eingetragen (#{bundle_id}.RestWidget)"
