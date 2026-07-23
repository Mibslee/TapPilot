import Foundation

struct BridgeRuntimeStatus: Codable, Equatable {
    struct ConnectedDevice: Codable, Equatable, Identifiable {
        let id: String
        let label: String
        let platform: String
        let route: String
        let connectedAt: String
    }

    let pid: Int32
    let host: String
    let port: Int
    let pairingCode: String
    let startedAt: String
    let codexConnected: Bool
    let codexConnectionMode: String?
    let localUrl: String
    let tailscaleHost: String?
    let tailscaleUrl: String?
    let tailscaleListening: Bool?
    let connectedDevices: [ConnectedDevice]?

    var startDate: Date? {
        ISO8601DateFormatter().date(from: startedAt)
    }

    var usesSharedCodexDaemon: Bool {
        codexConnectionMode == "sharedDaemon"
    }
}

enum ServiceState: Equatable {
    case starting
    case running
    case stopped
    case failed(String)

    var title: String {
        switch self {
        case .starting: "正在启动"
        case .running: "服务运行中"
        case .stopped: "服务已停止"
        case .failed: "启动异常"
        }
    }

    var symbol: String {
        switch self {
        case .starting: "circle.dotted"
        case .running: "checkmark.circle.fill"
        case .stopped: "pause.circle.fill"
        case .failed: "exclamationmark.triangle.fill"
        }
    }
}
