import Foundation
import GauzensplatCaptureCore

/// Verifies REAL two-way communication with the laptop server via the
/// `GET /health` round-trip — which proves the phone reaches the server AND
/// that the protocol version matches. This is a bounded HTTP request (5 s
/// timeout) so the UI can never hang. RTT / clock-offset are measured later,
/// during the live-mirror WebSocket session, not here.
struct ConnectionTester {

    struct Result {
        let ok: Bool
        let rttMs: Double?
        let offsetMs: Double?
        let protocolVersion: Int?
        let message: String
    }

    private static let session: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 5
        cfg.timeoutIntervalForResource = 6
        cfg.waitsForConnectivity = false
        return URLSession(configuration: cfg)
    }()

    static func test(serverURL: URL) async -> Result {
        let healthURL = serverURL.appendingPathComponent("health")
        do {
            let (data, resp) = try await session.data(from: healthURL)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  obj["status"] as? String == "ok" else {
                return Result(ok: false, rttMs: nil, offsetMs: nil, protocolVersion: nil,
                              message: "reached server but /health was not ok")
            }
            let pv = (obj["protocol_version"] as? NSNumber)?.intValue
            if let pv, pv != NetworkProtocol.version {
                return Result(ok: false, rttMs: nil, offsetMs: nil, protocolVersion: pv,
                              message: "protocol mismatch: server \(pv), app \(NetworkProtocol.version)")
            }
            return Result(ok: true, rttMs: nil, offsetMs: nil, protocolVersion: pv,
                          message: "CONNECTED")
        } catch let e as URLError where e.code == .timedOut {
            return Result(ok: false, rttMs: nil, offsetMs: nil, protocolVersion: nil,
                          message: "timed out — check the IP and that phone + Mac share Wi-Fi")
        } catch {
            return Result(ok: false, rttMs: nil, offsetMs: nil, protocolVersion: nil,
                          message: "cannot reach server: \(error.localizedDescription)")
        }
    }
}
