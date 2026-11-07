import Foundation
import Dispatch
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

public enum JSONValue: Codable, Equatable, Sendable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    public subscript(_ key: String) -> JSONValue {
        if case .object(let v) = self { return v[key] ?? .null }; return .null
    }
    public var text: String { if case .string(let v) = self { return v }; return "" }
    public var rows: [JSONValue]? { if case .array(let v) = self { return v }; return nil }
    public var isTrue: Bool { self == .bool(true) }
    public var positiveID: Double? {
        if case .number(let v) = self, v > 0, v <= 9007199254740991, v.rounded() == v { return v }; return nil
    }
    public var formatted: String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return (try? String(decoding: encoder.encode(self), as: UTF8.self)) ?? "Unavailable"
    }
}
public struct WorkbenchError: LocalizedError, Equatable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// Discovery, auth, environment validation and report ACLs remain owned by PUI.
public struct PuiBridge {
    public static let models: Set<String> = ["plans.list", "plans.get", "advRoster.list", "reports.list",
        "reports.get", "goals.list", "goals.detail", "planSessions.list", "operator.identity",
        "accounts.pool", "accounts.sessionOverride"]
    public let executable: URL
    public init(executable: URL) { self.executable = executable }
    public func read(_ name: String, args: [String: JSONValue] = [:], environment: JSONValue = .null,
                     timeout: TimeInterval = 22) async throws -> JSONValue {
        guard Self.models.contains(name) else { throw WorkbenchError("Unsupported native read model") }
        return try await invoke("native-read", body: .object(["name": .string(name),
            "args": .object(args), "environment": environment]), timeout: timeout)
    }
    public func account(_ action: String, accountID: String?, environment: JSONValue) async throws -> JSONValue {
        guard environment != .null, ["default", "force", "exclude", "auto"].contains(action),
              (action == "auto" ? accountID == nil : !(accountID ?? "").isEmpty) else {
            throw WorkbenchError("Select an environment and exact account control")
        }
        return try await invoke("native-account", body: .object(["environment": environment,
            "action": .string(action), "accountId": accountID.map(JSONValue.string) ?? .null]))
    }
    public func goal(_ action: String, detail: JSONValue, confirmed: Bool, environment: JSONValue) async throws -> JSONValue {
        guard confirmed, environment != .null, !detail["goal"]["id"].text.isEmpty,
              ["pause", "resume", "start", "reopen", "achieve", "kill"].contains(action) else {
            throw WorkbenchError("Select a goal and confirm its control")
        }
        return try await invoke("native-goal", body: .object(["environment": environment,
            "goalId": detail["goal"]["id"], "action": .string(action), "confirmed": .bool(true),
            "expectedStatus": detail["goal"]["status"], "expectedEffectiveStatus": detail["effectiveStatus"],
            "expectedHolderLiveness": detail["holderLiveness"]]))
    }
    private func invoke(_ command: String, body: JSONValue, timeout: TimeInterval = 22) async throws -> JSONValue {
        let request = try JSONEncoder().encode(body)
        guard executable.isFileURL, executable.path.hasPrefix("/"),
              FileManager.default.isExecutableFile(atPath: executable.path) else {
            throw WorkbenchError("Select an installed PUI executable")
        }
        guard request.count <= 64 * 1024, timeout > 0, timeout.isFinite else {
            throw WorkbenchError("Native panel request exceeds its limit")
        }
        let result = try await BoundedNativeProcess.run(executable: executable, arguments: [command], input: request, timeout: timeout)
        guard result.status == 0 else {
            // Diagnostics can contain private transport details.
            throw WorkbenchError("PUI could not read the selected operator (exit \(result.status))")
        }
        let payload = try JSONDecoder().decode(JSONValue.self, from: result.output)
        guard payload["ok"] != .bool(false), payload["rows"].rows != nil,
              [.null, .bool(false), .string("")].contains(payload["error"]) else {
            throw WorkbenchError("The operator returned an unavailable or invalid row envelope")
        }
        return payload
    }
}

// The resident installer uses the same deadline/cancellation/pipe safeguards as
// PUI; launchctl never gets a separate unbounded process implementation.
struct NativeProcessOutput: Sendable {
    let status: Int32
    let output: Data
    let diagnostic: Data
}
enum BoundedNativeProcess {
    static func run(executable: URL, arguments: [String], input: Data = Data(), timeout: TimeInterval = 10) async throws -> NativeProcessOutput {
        guard executable.isFileURL, executable.path.hasPrefix("/"), timeout > 0, timeout.isFinite else {
            throw WorkbenchError("Invalid native command")
        }
        let invocation = PuiInvocation(executable: executable, arguments: arguments, request: input, timeout: timeout)
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { invocation.start($0) }
        }, onCancel: { invocation.cancel() })
    }
}

/// Concurrent bounded pipe IO. The deadline covers stdin, child exit AND EOF,
/// including a descendant retaining an output pipe. No shell is involved.
private final class PuiInvocation: @unchecked Sendable {
    private let queue = DispatchQueue(label: "ai.papercusp.workbench.pui")
    private let process = Process()
    private let request: Data
    private let timeout: TimeInterval
    private var continuation: CheckedContinuation<NativeProcessOutput, Error>?
    private var channels: [DispatchIO] = []
    private var timer: DispatchSourceTimer?
    private var output = Data(), diagnostic = Data()
    private var inputDone = false, outputDone = false, diagnosticDone = false, exited = false
    private var finished = false, cancelled = false, launched = false
    init(executable: URL, arguments: [String], request: Data, timeout: TimeInterval) {
        process.executableURL = executable; process.arguments = arguments
        self.request = request; self.timeout = timeout
    }
    func cancel() { queue.async { self.cancelled = true; self.finish(.failure(CancellationError())) } }
    func start(_ continuation: CheckedContinuation<NativeProcessOutput, Error>) {
        queue.async {
            self.continuation = continuation
            if self.cancelled { self.finish(.failure(CancellationError())); return }
            let input = Pipe(), output = Pipe(), diagnostic = Pipe()
            self.process.standardInput = input; self.process.standardOutput = output; self.process.standardError = diagnostic
            self.process.terminationHandler = { _ in self.queue.async { self.exited = true; self.check() } }
            do {
                try self.process.run(); self.launched = true
                let timer = DispatchSource.makeTimerSource(queue: self.queue)
                timer.schedule(deadline: .now() + self.timeout)
                timer.setEventHandler { self.finish(.failure(WorkbenchError("The native command did not respond in time"))) }
                self.timer = timer; timer.resume()
                try self.capture(output.fileHandleForReading, diagnostic: false)
                try self.capture(diagnostic.fileHandleForReading, diagnostic: true)
                if self.request.isEmpty {
                    try input.fileHandleForWriting.close(); self.inputDone = true; self.check(); return
                }
                let channel = try self.channel(input.fileHandleForWriting)
                channel.write(offset: 0, data: self.request.withUnsafeBytes { DispatchData(bytes: $0) }, queue: self.queue) { done, _, error in
                    guard !self.finished else { return }
                    if error != 0 { self.finish(.failure(WorkbenchError("Could not send PUI request"))); return }
                    if done { channel.close(); self.inputDone = true; self.check() }
                }
            } catch { self.finish(.failure(error)) }
        }
    }
    private func channel(_ handle: FileHandle) throws -> DispatchIO {
        let fd = dup(handle.fileDescriptor)
        guard fd >= 0 else { throw WorkbenchError("Could not open PUI pipe") }
        let channel = DispatchIO(type: .stream, fileDescriptor: fd, queue: queue) { _ in _ = close(fd) }
        channel.setLimit(lowWater: 1); channels.append(channel)
        // Only DispatchIO retains this parent endpoint; input close delivers EOF.
        try handle.close()
        return channel
    }
    private func capture(_ handle: FileHandle, diagnostic: Bool) throws {
        let channel = try self.channel(handle)
        channel.read(offset: 0, length: Int.max, queue: queue) { done, data, error in
            guard !self.finished else { return }
            if error != 0 { self.finish(.failure(WorkbenchError("Could not read PUI response"))); return }
            if let data {
                let count = diagnostic ? self.diagnostic.count : self.output.count
                guard data.count <= 16 * 1024 * 1024 - count else {
                    self.finish(.failure(WorkbenchError("PUI output exceeds the native panel limit"))); return
                }
                if diagnostic { self.diagnostic.append(contentsOf: data) } else { self.output.append(contentsOf: data) }
            }
            if done {
                channel.close()
                if diagnostic { self.diagnosticDone = true } else { self.outputDone = true }
                self.check()
            }
        }
    }
    private func check() {
        guard !finished, inputDone, outputDone, diagnosticDone, exited else { return }
        finish(.success(NativeProcessOutput(status: process.terminationStatus, output: output, diagnostic: diagnostic)))
    }
    private func finish(_ result: Result<NativeProcessOutput, Error>) {
        guard !finished, let continuation else { return }
        finished = true; self.continuation = nil
        timer?.cancel(); timer = nil
        process.terminationHandler = nil
        for channel in channels { channel.close(flags: .stop) }; channels.removeAll()
        if launched && !exited && process.isRunning { _ = kill(process.processIdentifier, SIGKILL) }
        // Foundation reaps this child; never target its agent/terminal group.
        continuation.resume(with: result)
    }
}
