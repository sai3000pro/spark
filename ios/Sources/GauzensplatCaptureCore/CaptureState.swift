import Foundation

/// Recording session state machine.
///
///     idle -> preparing -> recording -> stopping -> completed
///                    \-> failed                 \-> failed
///
/// Illegal actions (double START, STOP while idle, EXPORT before completion,
/// preparation failure) are rejected via `throws` rather than corrupting state.
public enum CaptureState: String, Equatable {
    case idle
    case preparing
    case recording
    case stopping
    case completed
    case failed
}

public enum CaptureAction {
    case start
    case preparationSucceeded
    case preparationFailed
    case stop
    case finalizeSucceeded
    case fail
    case reset
}

public enum CaptureStateError: Error, Equatable {
    case illegalTransition(from: CaptureState, action: String)
    case exportBeforeCompletion(CaptureState)
}

public struct CaptureStateMachine {
    public private(set) var state: CaptureState = .idle

    public init(state: CaptureState = .idle) { self.state = state }

    @discardableResult
    public mutating func apply(_ action: CaptureAction) throws -> CaptureState {
        switch (state, action) {
        case (.idle, .start):                       state = .preparing
        case (.preparing, .preparationSucceeded):   state = .recording
        case (.preparing, .preparationFailed):      state = .failed
        case (.recording, .stop):                   state = .stopping
        case (.recording, .fail):                   state = .failed
        case (.stopping, .finalizeSucceeded):       state = .completed
        case (.stopping, .fail):                    state = .failed
        case (_, .reset) where state == .completed || state == .failed:
            state = .idle
        default:
            throw CaptureStateError.illegalTransition(from: state, action: "\(action)")
        }
        return state
    }

    /// EXPORT is only valid once a session is completed.
    public func assertCanExport() throws {
        guard state == .completed else {
            throw CaptureStateError.exportBeforeCompletion(state)
        }
    }

    public var isRecording: Bool { state == .recording }
    public var acceptsFrames: Bool { state == .recording }
}
