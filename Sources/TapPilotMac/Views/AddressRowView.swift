import SwiftUI

struct AddressRowView: View {
    @EnvironmentObject private var store: AppStore
    let title: String
    let subtitle: String
    let symbol: String
    let url: String?
    let available: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(available ? Color.accentColor : .secondary)
                .frame(width: 30, height: 30)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 9, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(url ?? subtitle)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let url {
                Button {
                    store.copy(url)
                } label: {
                    Image(systemName: store.copiedValue == url ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(.borderless)
                .help("复制地址")
                .accessibilityLabel("复制\(title)")

                Button {
                    store.open(url)
                } label: {
                    Image(systemName: "arrow.up.forward.square")
                }
                .buttonStyle(.borderless)
                .disabled(!available)
                .help("在浏览器中打开")
                .accessibilityLabel("打开\(title)")
            }
        }
        .padding(11)
        .background(.quinary, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
