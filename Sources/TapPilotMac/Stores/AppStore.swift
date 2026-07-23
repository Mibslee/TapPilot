import AppKit
import Darwin
import Foundation

@MainActor
final class AppStore: ObservableObject {
    static let shared = AppStore()

    @Published private(set) var serviceState: ServiceState = .starting
    @Published private(set) var runtime: BridgeRuntimeStatus?
    @Published private(set) var tailscaleIP: String?
    @Published private(set) var copiedValue: String?
    @Published private(set) var isResettingPairing = false
    @Published private(set) var pairingResetError: String?
    @Published private(set) var codexRestartRequired = false
    @Published private(set) var sharedDaemonSetupError: String?

    private let controller = BridgeProcessController()
    private var pollingTask: Task<Void, Never>?
    private var recoveryTask: Task<Void, Never>?
    private var shouldKeepServiceRunning = true

    var localURL: String { runtime?.localUrl ?? "http://127.0.0.1:8788" }
    var tailscaleURL: String? {
        runtime?.tailscaleUrl ?? tailscaleIP.map { "http://\($0):8788" }
    }
    var ownsService: Bool { controller.ownsRunningProcess }

    private init() {
        controller.onUnexpectedTermination = { [weak self] in
            self?.scheduleRecovery()
        }
        pollingTask = Task { [weak self] in
            guard let self else { return }
            await self.startIfNeeded()
            while !Task.isCancelled {
                await self.refresh()
                if self.shouldKeepServiceRunning, case .stopped = self.serviceState {
                    await self.startIfNeeded()
                }
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    func startIfNeeded() async {
        shouldKeepServiceRunning = true
        configureSharedCodexDaemon()
        tailscaleIP = TailscaleDetector.currentIPv4()
        if await isHealthy() {
            await refresh()
            return
        }
        serviceState = .starting
        do {
            try controller.start(tailscaleHost: tailscaleIP)
            for _ in 0..<24 {
                try? await Task.sleep(for: .milliseconds(250))
                if await isHealthy() {
                    await refresh()
                    return
                }
            }
            serviceState = .failed("Bridge 启动超时")
        } catch {
            serviceState = .failed(error.localizedDescription)
        }
    }

    func restart() async {
        shouldKeepServiceRunning = true
        controller.stop()
        try? await Task.sleep(for: .milliseconds(600))
        runtime = nil
        await startIfNeeded()
    }

    func stopOwnedService() {
        shouldKeepServiceRunning = false
        controller.stop()
        runtime = nil
        serviceState = .stopped
    }

    func resetPairing() async {
        guard let status = runtime, processExists(status.pid) else {
            pairingResetError = "Bridge 当前未运行。"
            return
        }
        let previousCode = status.pairingCode
        isResettingPairing = true
        pairingResetError = nil
        defer { isResettingPairing = false }

        guard Darwin.kill(status.pid, SIGHUP) == 0 else {
            pairingResetError = "无法通知 Bridge 刷新配对凭据。"
            return
        }
        for _ in 0..<20 {
            try? await Task.sleep(for: .milliseconds(150))
            await refresh()
            if let currentCode = runtime?.pairingCode, currentCode != previousCode { return }
        }
        pairingResetError = "Bridge 未在预期时间内返回新配对码。"
    }

    func clearPairingResetError() {
        pairingResetError = nil
    }

    func copy(_ value: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
        copiedValue = value
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.5))
            if self?.copiedValue == value { self?.copiedValue = nil }
        }
    }

    func open(_ value: String) {
        guard let url = URL(string: value) else { return }
        NSWorkspace.shared.open(url)
    }

    func quit() {
        shutdown()
        NSApp.terminate(nil)
    }

    func shutdown() {
        shouldKeepServiceRunning = false
        pollingTask?.cancel()
        recoveryTask?.cancel()
        controller.stop()
    }

    private func scheduleRecovery() {
        guard shouldKeepServiceRunning, recoveryTask == nil else { return }
        runtime = nil
        serviceState = .starting
        recoveryTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard let self, !Task.isCancelled else { return }
            await self.startIfNeeded()
            self.recoveryTask = nil
        }
    }

    private func refresh() async {
        refreshCodexRestartRequirement()
        tailscaleIP = TailscaleDetector.currentIPv4()
        guard await isHealthy(), let status = loadRuntimeStatus(), processExists(status.pid) else {
            runtime = nil
            if case .starting = serviceState { return }
            serviceState = controller.ownsRunningProcess ? .starting : .stopped
            return
        }
        runtime = status
        serviceState = .running
    }

    private func isHealthy() async -> Bool {
        guard let url = URL(string: "http://127.0.0.1:8788/api/health") else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 0.8
        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }

    private func loadRuntimeStatus() -> BridgeRuntimeStatus? {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/TapPilot/runtime.json")
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(BridgeRuntimeStatus.self, from: data)
    }

    private func processExists(_ pid: Int32) -> Bool {
        kill(pid, 0) == 0 || errno == EPERM
    }

    private func configureSharedCodexDaemon() {
        let defaults = UserDefaults.standard
        let configurationKey = "codexSharedDaemonConfigured"
        let pendingPIDKey = "codexSharedDaemonPendingPID"
        let wasConfigured = defaults.bool(forKey: configurationKey)
        do {
            try controller.configureCodexSharedDaemon()
            sharedDaemonSetupError = nil
            defaults.set(true, forKey: configurationKey)
            if !wasConfigured, let pid = runningCodexPID() {
                defaults.set(pid, forKey: pendingPIDKey)
            }
        } catch {
            sharedDaemonSetupError = error.localizedDescription
        }
        refreshCodexRestartRequirement()
    }

    private func refreshCodexRestartRequirement() {
        let defaults = UserDefaults.standard
        let pendingPIDKey = "codexSharedDaemonPendingPID"
        let pendingPID = Int32(defaults.integer(forKey: pendingPIDKey))
        guard pendingPID > 0 else {
            codexRestartRequired = false
            return
        }
        if runningCodexPID() == pendingPID {
            codexRestartRequired = true
        } else {
            defaults.removeObject(forKey: pendingPIDKey)
            codexRestartRequired = false
        }
    }

    private func runningCodexPID() -> Int32? {
        NSRunningApplication.runningApplications(withBundleIdentifier: "com.openai.codex")
            .first?
            .processIdentifier
    }
}
