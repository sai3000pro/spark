import XCTest
@testable import GauzensplatCaptureCore

final class StateMachineTests: XCTestCase {

    func testHappyPath() throws {
        var sm = CaptureStateMachine()
        XCTAssertEqual(sm.state, .idle)
        try sm.apply(.start);                 XCTAssertEqual(sm.state, .preparing)
        try sm.apply(.preparationSucceeded);  XCTAssertEqual(sm.state, .recording)
        try sm.apply(.stop);                  XCTAssertEqual(sm.state, .stopping)
        try sm.apply(.finalizeSucceeded);     XCTAssertEqual(sm.state, .completed)
        try sm.assertCanExport()
        try sm.apply(.reset);                 XCTAssertEqual(sm.state, .idle)
    }

    func testDoubleStartRejected() throws {
        var sm = CaptureStateMachine()
        try sm.apply(.start)
        XCTAssertThrowsError(try sm.apply(.start))
    }

    func testStopWhileIdleRejected() {
        var sm = CaptureStateMachine()
        XCTAssertThrowsError(try sm.apply(.stop))
    }

    func testExportBeforeCompletionRejected() throws {
        var sm = CaptureStateMachine()
        XCTAssertThrowsError(try sm.assertCanExport())
        try sm.apply(.start)
        try sm.apply(.preparationSucceeded)
        XCTAssertThrowsError(try sm.assertCanExport())  // still recording
    }

    func testPreparationFailure() throws {
        var sm = CaptureStateMachine()
        try sm.apply(.start)
        try sm.apply(.preparationFailed)
        XCTAssertEqual(sm.state, .failed)
        try sm.apply(.reset)
        XCTAssertEqual(sm.state, .idle)
    }

    func testFailureDuringRecording() throws {
        var sm = CaptureStateMachine()
        try sm.apply(.start)
        try sm.apply(.preparationSucceeded)
        try sm.apply(.fail)
        XCTAssertEqual(sm.state, .failed)
    }

    func testDoubleStopRejected() throws {
        var sm = CaptureStateMachine()
        try sm.apply(.start)
        try sm.apply(.preparationSucceeded)
        try sm.apply(.stop)
        XCTAssertThrowsError(try sm.apply(.stop))
    }
}
