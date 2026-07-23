import AppKit
import SwiftUI

enum TapPilotArtwork {
    static let menuIconPointSize = NSSize(width: 19, height: 18)

    static let menuIcon: NSImage? = {
        guard let url = Bundle.main.url(forResource: "TapPilotMenuIcon", withExtension: "png"),
              let image = NSImage(contentsOf: url) else { return nil }
        // MenuBarExtra may size its status item from NSImage's intrinsic point size
        // before SwiftUI applies the label frame. Keep the Retina bitmap, but give
        // AppKit the compact logical size expected by the macOS menu bar.
        image.size = menuIconPointSize
        image.isTemplate = true
        return image
    }()
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
    }

    func applicationWillTerminate(_ notification: Notification) {
        MainActor.assumeIsolated {
            AppStore.shared.shutdown()
        }
    }
}

@main
struct TapPilotMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var store = AppStore.shared

    var body: some Scene {
        MenuBarExtra {
            StatusPanelView()
                .environmentObject(store)
        } label: {
            Group {
                if let icon = TapPilotArtwork.menuIcon {
                    Image(nsImage: icon)
                        .resizable()
                        .renderingMode(.template)
                        .scaledToFit()
                } else {
                    Image(systemName: "macbook.and.iphone")
                }
            }
            .frame(width: TapPilotArtwork.menuIconPointSize.width,
                   height: TapPilotArtwork.menuIconPointSize.height)
            .opacity(store.serviceState == .running ? 1 : 0.62)
            .accessibilityLabel("TapPilot：\(store.serviceState.title)")
        }
        .menuBarExtraStyle(.window)
    }
}
