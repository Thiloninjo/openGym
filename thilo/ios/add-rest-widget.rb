# Thilos Fork: trägt beim Codemagic-Build die Fork-Bausteine ins Xcode-Projekt ein (es gibt keinen
# Mac, auf dem man das in Xcode klicken könnte). Das eingecheckte project.pbxproj bleibt wie im
# Original; jeder Schritt hier prüft selbst, ob er schon erledigt ist, und lässt sich wiederholen.
#  - App: ThiloBridgeViewController (meldet die lokalen Plugins an), TrainingLivePlugin, TrainingAudio
#    und die gemeinsamen Attribute der Live-Aktivität.
#  - PrintPlugin.m fliegt aus dem Build: PrintPlugin.swift erfüllt CAPBridgedPlugin selbst, die
#    CAP_PLUGIN-Kategorie würde dieselben Methoden noch einmal setzen.
#  - Widget-Erweiterung RestWidget (Live-Aktivität des Trainings).
# Aufruf: ruby thilo/ios/add-rest-widget.rb frontend/ios/App/App.xcodeproj <app-bundle-id>
require 'xcodeproj'

APP_FILES = %w[ThiloBridgeViewController.swift TrainingLivePlugin.swift TrainingAudio.swift].freeze
DROPPED_APP_FILES = %w[PrintPlugin.m RestActivityPlugin.swift RestActivityPlugin.m].freeze

proj_path, bundle_id = ARGV
abort 'Aufruf: add-rest-widget.rb <App.xcodeproj> <bundle-id>' unless proj_path && bundle_id
project = Xcodeproj::Project.open(proj_path)
app = project.targets.find { |t| t.name == 'App' } or abort 'Target App fehlt'
app_cfg = app.build_configurations.first.build_settings
app_group = project.main_group.children.find { |g| g.respond_to?(:path) && g.path == 'App' } or abort 'Gruppe App fehlt'

def ref_in(group, name)
  group.files.find { |f| f.path == name }
end

def in_sources?(target, ref)
  target.source_build_phase.files_references.include?(ref)
end

def add_source(target, group, name)
  ref = ref_in(group, name) || group.new_reference(name)
  target.add_file_references([ref]) unless in_sources?(target, ref)
  ref
end

# Dateien der App
APP_FILES.each do |f|
  abort "#{f} fehlt im Repo" unless File.exist?(File.join(File.dirname(proj_path), 'App', f))
  add_source(app, app_group, f)
  puts "App: #{f}"
end
DROPPED_APP_FILES.each do |f|
  ref = ref_in(app_group, f) or next
  app.source_build_phase.remove_file_reference(ref)
  ref.remove_from_project
  puts "App: #{f} aus dem Build genommen"
end

# Widget-Erweiterung
group = project.main_group.children.find { |g| g.respond_to?(:path) && g.path == 'RestWidget' } ||
        project.main_group.new_group('RestWidget', 'RestWidget')
widget = project.targets.find { |t| t.name == 'RestWidget' }
unless widget
  widget = project.new_target(:app_extension, 'RestWidget', :ios, '16.2')
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
  puts "RestWidget angelegt (#{bundle_id}.RestWidget)"
end
add_source(widget, group, 'RestWidget.swift')
attrs = add_source(widget, group, 'RestActivityAttributes.swift')
app.add_file_references([attrs]) unless in_sources?(app, attrs)
group.new_reference('Info.plist') unless ref_in(group, 'Info.plist')

project.save
puts 'Xcode-Projekt aktualisiert'
