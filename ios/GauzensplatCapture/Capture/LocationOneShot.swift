import Foundation
import CoreLocation

/// Self-contained ONE-SHOT location + reverse-geocode helper for GPS capture
/// tagging. Purely additive: everything fails open — if authorization is denied,
/// location is unavailable, or the fix times out, `fetch` returns nils and the
/// caller records normally. No long-lived singleton: each `fetch` spins up its
/// own `CLLocationManager`, resolves exactly once, and is released, so nothing
/// keeps a location session running after the fix.
///
/// Usage:
///   let (coord, name) = await LocationOneShot.fetch(timeout: 1.0)
enum LocationOneShot {

    /// Prompt for WhenInUse authorization without waiting for a fix. Call this at
    /// screen appear so the permission dialog shows early; the actual coordinate
    /// is fetched later at record start via `fetch`.
    static func requestAuthorization() {
        // A short-lived manager is enough to raise the prompt; iOS retains the
        // authorization decision process even after this instance is released.
        let mgr = CLLocationManager()
        let status = mgr.authorizationStatus
        if status == .notDetermined {
            mgr.requestWhenInUseAuthorization()
        }
        // Intentionally not stored: prompting does not require a running session.
        _ = mgr
    }

    /// Best-effort single location fix + reverse geocode.
    /// - Returns coordinates when a fix arrives within `timeout`; nil otherwise.
    ///   A place name is returned when reverse geocoding succeeds, but coords are
    ///   still returned even if the name lookup fails. Never blocks longer than
    ///   ~`timeout` + a short geocode budget.
    static func fetch(timeout: TimeInterval = 1.0) async -> (CLLocationCoordinate2D?, String?) {
        let status = CLLocationManager().authorizationStatus
        if status == .denied || status == .restricted {
            return (nil, nil)   // fail open, never block recording
        }

        guard let location = await requestOneLocation(timeout: timeout) else {
            return (nil, nil)
        }
        let name = await reverseGeocode(location, timeout: timeout)
        return (location.coordinate, name)
    }

    // MARK: - one location fix

    private static func requestOneLocation(timeout: TimeInterval) async -> CLLocation? {
        await withCheckedContinuation { continuation in
            let delegate = OneShotDelegate(timeout: timeout) { location in
                continuation.resume(returning: location)
            }
            delegate.start()
        }
    }

    /// Delegate that requests a single location and self-retains until it resolves
    /// (fix, error, or timeout), then releases — so no location session lingers.
    private final class OneShotDelegate: NSObject, CLLocationManagerDelegate {
        private let manager = CLLocationManager()
        private var completion: ((CLLocation?) -> Void)?
        private var selfRef: OneShotDelegate?
        private let timeout: TimeInterval

        init(timeout: TimeInterval, completion: @escaping (CLLocation?) -> Void) {
            self.timeout = timeout
            self.completion = completion
        }

        func start() {
            selfRef = self               // keep alive across the async callback
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
            manager.requestLocation()
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
                self?.finish(nil)        // timed out; fail open
            }
        }

        private func finish(_ location: CLLocation?) {
            guard let done = completion else { return }
            completion = nil
            manager.delegate = nil
            done(location)
            selfRef = nil                // release; nothing keeps the session alive
        }

        func locationManager(_ manager: CLLocationManager,
                             didUpdateLocations locations: [CLLocation]) {
            finish(locations.last)
        }

        func locationManager(_ manager: CLLocationManager,
                             didFailWithError error: Error) {
            finish(nil)
        }
    }

    // MARK: - reverse geocode (best effort)

    private static func reverseGeocode(_ location: CLLocation,
                                       timeout: TimeInterval) async -> String? {
        await withTaskGroup(of: String?.self) { group in
            group.addTask {
                await withCheckedContinuation { (continuation: CheckedContinuation<String?, Never>) in
                    CLGeocoder().reverseGeocodeLocation(location) { placemarks, _ in
                        let p = placemarks?.first
                        continuation.resume(returning: p?.name ?? p?.locality ?? p?.administrativeArea)
                    }
                }
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }
}
