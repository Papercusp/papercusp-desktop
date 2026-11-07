import Foundation

/// Foundation projection of packages/operator-ui/src/papercup-chat/
/// parse-work-refs.ts and chat-ref-popup-params.ts. Offsets and word boundaries
/// follow JavaScript (UTF-16 and ASCII), including beside non-ASCII prose.
public enum NativeWorkRefs {
    public struct Reference: Equatable {
        public let id: String
        public let range: NSRange
        public var isPlanItem: Bool { id.hasPrefix("P-") }
    }
    public static func parse(_ text: String) -> [Reference] {
        let scan = NSMutableString(string: text)
        for pattern in [#"\x60\x60\x60[\s\S]*?(?:\x60\x60\x60|$)"#, #"(`+)[\s\S]*?\1"#, #"!?\[[^\]]*\]\([^)]*\)"#] {
            let expression = try! NSRegularExpression(pattern: pattern)
            for match in expression.matches(in: scan as String, range: NSRange(location: 0, length: scan.length)).reversed() {
                scan.replaceCharacters(in: match.range, with: String(repeating: " ", count: match.range.length))
            }
        }
        let expression = try! NSRegularExpression(pattern: #"(?<![A-Za-z0-9_])(?:(?:WI|EI|F)-[0-9]+|P-[0-9]{3,})(?![A-Za-z0-9_])"#)
        return expression.matches(in: scan as String, range: NSRange(location: 0, length: scan.length)).map {
            Reference(id: (text as NSString).substring(with: $0.range), range: $0.range)
        }
    }
    /// Use the GUI popup grammar on the selected operator origin. Missing
    /// context is intentionally inert, matching workRefPopupTarget.
    public static func target(_ ref: Reference, environment: JSONValue, harness: String?, plan: String?) -> URL? {
        guard NativeEnvironment.same(environment, environment),
              var url = URLComponents(string: environment["endpoint"].text),
              ["http", "https"].contains(url.scheme ?? ""), url.host != nil,
              url.user == nil, url.password == nil else { return nil }
        let id: String, param: String
        if ref.isPlanItem {
            guard let plan, !plan.isEmpty else { return nil }
            id = plan; param = "wppop"
        } else {
            guard let harness, !harness.isEmpty else { return nil }
            id = ref.id; param = "wpop"
        }
        let value = harness.flatMap { $0.isEmpty ? nil : $0 }.map { $0 + "::" + id } ?? id
        url.path = "/"; url.fragment = nil
        url.queryItems = [URLQueryItem(name: param, value: value)]
        return url.url
    }
    public static func markdown(_ text: String, environment: JSONValue, harness: String?, plan: String?) -> String {
        let output = NSMutableString(string: text)
        for ref in parse(text).reversed() {
            guard let url = target(ref, environment: environment, harness: harness, plan: plan) else { continue }
            let destination = url.absoluteString.replacingOccurrences(of: "(", with: "%28").replacingOccurrences(of: ")", with: "%29")
            output.replaceCharacters(in: ref.range, with: "[" + ref.id + "](" + destination + ")")
        }
        return output as String
    }
}
