#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Thilos Fork: bindet RestActivityPlugin (Swift) in Capacitors Plugin-Verzeichnis ein.
CAP_PLUGIN(RestActivityPlugin, "RestActivity",
           CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(hold, CAPPluginReturnPromise);
           CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
)
