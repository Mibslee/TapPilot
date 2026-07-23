import XCTest
@testable import TapPilotMac

final class TailscaleDetectorTests: XCTestCase {
    func testMenuBarArtworkUsesCompactLogicalSize() {
        XCTAssertEqual(TapPilotArtwork.menuIconPointSize.width, 19)
        XCTAssertEqual(TapPilotArtwork.menuIconPointSize.height, 18)
    }

    func testRecognizesCGNATRangeUsedByTailscale() {
        XCTAssertTrue(TailscaleDetector.isTailscaleIPv4("100.64.0.1"))
        XCTAssertTrue(TailscaleDetector.isTailscaleIPv4("100.117.71.31"))
        XCTAssertTrue(TailscaleDetector.isTailscaleIPv4("100.127.255.254"))
    }

    func testRejectsAddressesOutsideTailscaleRange() {
        XCTAssertFalse(TailscaleDetector.isTailscaleIPv4("100.63.255.255"))
        XCTAssertFalse(TailscaleDetector.isTailscaleIPv4("192.168.1.10"))
        XCTAssertFalse(TailscaleDetector.isTailscaleIPv4("not-an-address"))
    }
}
