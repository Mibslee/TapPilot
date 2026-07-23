// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "TapPilot",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "TapPilot", targets: ["TapPilotMac"]),
    ],
    targets: [
        .executableTarget(name: "TapPilotMac"),
        .testTarget(name: "TapPilotMacTests", dependencies: ["TapPilotMac"]),
    ]
)
