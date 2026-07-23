import AppKit
import SwiftUI

struct StatusPanelView: View {
    @EnvironmentObject private var store: AppStore
    @State private var showsPairingResetConfirmation = false

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().opacity(0.7)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    statusCard
                    addresses
                    connectedDevicesCard
                    pairingCard
                }
                .padding(16)
            }
            Divider().opacity(0.7)
            footer
        }
        .frame(width: 390, height: 590)
        .background(.regularMaterial)
        .confirmationDialog(
            "刷新配对并断开所有设备？",
            isPresented: $showsPairingResetConfirmation,
            titleVisibility: .visible
        ) {
            Button("刷新并断开已配对设备", role: .destructive) {
                Task { await store.resetPairing() }
            }
            Button("取消", role: .cancel) {}
        } message: {
            Text("所有手机需要使用新配对码重新连接。")
        }
        .alert(
            "未能刷新配对",
            isPresented: Binding(
                get: { store.pairingResetError != nil },
                set: { if !$0 { store.clearPairingResetError() } }
            )
        ) {
            Button("好") { store.clearPairingResetError() }
        } message: {
            Text(store.pairingResetError ?? "未知错误")
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(LinearGradient(colors: [.accentColor, .accentColor.opacity(0.62)], startPoint: .topLeading, endPoint: .bottomTrailing))
                Group {
                    if let icon = TapPilotArtwork.menuIcon {
                        Image(nsImage: icon)
                            .resizable()
                            .renderingMode(.template)
                            .scaledToFit()
                    } else {
                        Image(systemName: "macbook.and.iphone")
                            .font(.system(size: 18, weight: .semibold))
                    }
                }
                .foregroundStyle(.white)
                .padding(7)
            }
            .frame(width: 42, height: 42)

            VStack(alignment: .leading, spacing: 2) {
                Text("TapPilot")
                    .font(.headline)
                Text("Mac 控制中枢")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Label(store.serviceState.title, systemImage: store.serviceState.symbol)
                .font(.caption.weight(.medium))
                .foregroundStyle(statusColor)
        }
        .padding(16)
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("运行状态")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            statusLine("TapPilot Bridge", online: store.runtime != nil)
            statusLine("Codex App Server", online: store.runtime?.codexConnected == true)
            statusLine(
                "桌面实时同步",
                online: store.runtime?.usesSharedCodexDaemon == true && !store.codexRestartRequired,
                detail: desktopSyncDetail
            )
            statusLine("Tailscale", online: store.tailscaleIP != nil, detail: store.tailscaleIP ?? "未检测到")
        }
        .padding(14)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(.separator.opacity(0.6), lineWidth: 0.5)
        }
    }

    private var addresses: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("访问地址")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
            AddressRowView(
                title: "本机访问",
                subtitle: "Bridge 启动后可用",
                symbol: "desktopcomputer",
                url: store.localURL,
                available: store.runtime != nil
            )
            AddressRowView(
                title: "Tailscale 访问",
                subtitle: "连接 Tailscale 后自动显示",
                symbol: "network",
                url: store.tailscaleURL,
                available: store.runtime?.tailscaleListening == true
            )
        }
    }

    private var pairingCard: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("本次配对码")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(store.runtime?.pairingCode ?? "— — — — — —")
                    .font(.system(.title3, design: .monospaced, weight: .semibold))
                    .tracking(2)
            }
            Spacer()
            if let code = store.runtime?.pairingCode {
                Button {
                    store.copy(code)
                } label: {
                    Label("复制", systemImage: store.copiedValue == code ? "checkmark" : "doc.on.doc")
                }
                    .controlSize(.small)
                Button {
                    showsPairingResetConfirmation = true
                } label: {
                    Image(systemName: store.isResettingPairing ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                }
                    .controlSize(.small)
                    .disabled(store.isResettingPairing)
                    .help("刷新并断开已配对设备")
                    .accessibilityLabel("刷新配对并断开所有设备")
            }
        }
        .padding(14)
        .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var connectedDevicesCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("当前接入设备")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)
                Spacer()
                Text("\(store.runtime?.connectedDevices?.count ?? 0) 台")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let devices = store.runtime?.connectedDevices, !devices.isEmpty {
                ForEach(devices) { device in
                    HStack(spacing: 10) {
                        Image(systemName: deviceSymbol(device.platform))
                            .frame(width: 22)
                            .foregroundStyle(.tint)
                        Text(device.label)
                            .font(.subheadline)
                        Spacer()
                        Text(device.route)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                Label("暂无手机在线访问", systemImage: "lock.shield")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(.separator.opacity(0.6), lineWidth: 0.5)
        }
    }

    private func deviceSymbol(_ platform: String) -> String {
        switch platform {
        case "phone": "iphone"
        case "tablet": "ipad"
        case "computer": "desktopcomputer"
        default: "network"
        }
    }

    private var footer: some View {
        HStack(spacing: 10) {
            brandWordmark
            Spacer()
            if store.runtime == nil {
                Button("启动") { Task { await store.startIfNeeded() } }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
            } else if store.ownsService {
                Button("重启") { Task { await store.restart() } }
                    .controlSize(.small)
                Button("停止") { store.stopOwnedService() }
                    .controlSize(.small)
            }
            Button {
                store.quit()
            } label: {
                Image(systemName: "power")
            }
            .buttonStyle(.borderless)
            .help("退出 TapPilot")
        }
        .padding(.horizontal, 16)
        .frame(height: 54)
    }

    @ViewBuilder
    private var brandWordmark: some View {
        if let url = Bundle.main.url(forResource: "ShaneStudio-wordmark", withExtension: "png"),
           let image = NSImage(contentsOf: url) {
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(width: 124, height: 31)
                .opacity(0.9)
        } else {
            Text("ShaneStudio")
                .font(.caption2.weight(.medium))
                .foregroundStyle(.tertiary)
        }
    }

    private func statusLine(_ title: String, online: Bool, detail: String? = nil) -> some View {
        HStack {
            Circle()
                .fill(online ? Color.green : Color.secondary.opacity(0.45))
                .frame(width: 7, height: 7)
            Text(title).font(.subheadline)
            Spacer()
            Text(detail ?? (online ? "在线" : "未连接"))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var statusColor: Color {
        switch store.serviceState {
        case .running: .green
        case .failed: .orange
        case .starting: .accentColor
        case .stopped: .secondary
        }
    }

    private var desktopSyncDetail: String {
        if let error = store.sharedDaemonSetupError { return error }
        if store.codexRestartRequired { return "请重启一次 Codex" }
        return store.runtime?.usesSharedCodexDaemon == true ? "已启用" : "正在准备"
    }
}
