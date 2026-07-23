import Foundation

enum BridgeLaunchError: LocalizedError {
    case runtimeMissing
    case nodeMissing
    case sharedDaemonSetupFailed(String)

    var errorDescription: String? {
        switch self {
        case .runtimeMissing: "找不到 TapPilot Bridge，请重新构建 App。"
        case .nodeMissing: "找不到 Node.js，请先安装 Node.js 22 或更高版本。"
        case .sharedDaemonSetupFailed(let detail): "无法启用 Codex 桌面实时同步：\(detail)"
        }
    }
}

@MainActor
final class BridgeProcessController {
    private(set) var process: Process?
    private var logHandle: FileHandle?
    private var stopRequested = false
    var onUnexpectedTermination: (() -> Void)?

    var ownsRunningProcess: Bool { process?.isRunning == true }

    func configureCodexSharedDaemon() throws {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        child.arguments = ["setenv", "CODEX_APP_SERVER_USE_LOCAL_DAEMON", "1"]
        let errorPipe = Pipe()
        child.standardOutput = FileHandle.nullDevice
        child.standardError = errorPipe
        try child.run()
        child.waitUntilExit()
        guard child.terminationStatus == 0 else {
            let detail = String(data: errorPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            throw BridgeLaunchError.sharedDaemonSetupFailed(detail ?? "launchctl 返回异常")
        }
    }

    func start(tailscaleHost: String?) throws {
        guard !ownsRunningProcess else { return }
        guard let runtimeRoot = runtimeRoot(),
              FileManager.default.fileExists(atPath: runtimeRoot.appendingPathComponent("bridge/index.mjs").path) else {
            throw BridgeLaunchError.runtimeMissing
        }
        guard let nodeURL = nodeExecutable() else { throw BridgeLaunchError.nodeMissing }

        let logsDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/TapPilot", isDirectory: true)
        try FileManager.default.createDirectory(at: logsDirectory, withIntermediateDirectories: true)
        let logURL = logsDirectory.appendingPathComponent("bridge.log")
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }
        let handle = try FileHandle(forWritingTo: logURL)
        try handle.seekToEnd()

        let child = Process()
        stopRequested = false
        child.executableURL = nodeURL
        child.arguments = [runtimeRoot.appendingPathComponent("bridge/index.mjs").path]
        child.currentDirectoryURL = runtimeRoot
        var environment = ProcessInfo.processInfo.environment
        environment["TAPPILOT_HOST"] = "127.0.0.1"
        environment["TAPPILOT_PORT"] = "8788"
        if let tailscaleHost { environment["TAPPILOT_TAILSCALE_HOST"] = tailscaleHost }
        child.environment = environment
        child.standardOutput = handle
        child.standardError = handle
        child.terminationHandler = { [weak self] terminated in
            Task { @MainActor in
                guard self?.process === terminated else { return }
                let shouldNotify = self?.stopRequested == false
                self?.process = nil
                try? self?.logHandle?.close()
                self?.logHandle = nil
                if shouldNotify { self?.onUnexpectedTermination?() }
            }
        }
        try child.run()
        process = child
        logHandle = handle
    }

    func stop() {
        guard let process, process.isRunning else { return }
        stopRequested = true
        process.terminate()
    }

    private func runtimeRoot() -> URL? {
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("TapPilotRuntime"),
           FileManager.default.fileExists(atPath: bundled.path) {
            return bundled
        }
        let current = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let candidates = [current.appendingPathComponent("dist"), current]
        return candidates.first { FileManager.default.fileExists(atPath: $0.appendingPathComponent("bridge/index.mjs").path) }
    }

    private func nodeExecutable() -> URL? {
        let candidates = [
            ProcessInfo.processInfo.environment["TAPPILOT_NODE"],
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ].compactMap { $0 }
        return candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }).map(URL.init(fileURLWithPath:))
    }
}
