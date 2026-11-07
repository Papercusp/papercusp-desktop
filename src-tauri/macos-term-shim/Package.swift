// swift-tools-version:5.9
// PapercuspTermShim — the macOS half of the D-009 embedded native terminal
// (native-terminal-desktop-2026-06-06). A tiny dynamic library exposing a C
// ABI over SwiftTerm's LocalProcessTerminalView, so the Rust desktop can
// dlopen it (mirroring the Linux libvte pattern: no link-time dependency —
// when the dylib is absent the strategy downgrades to NewWindow).
//
// Build (on macOS):  swift build -c release
// Output:            .build/release/libPapercuspTermShim.dylib
import PackageDescription

// Share Foundation contracts and tests with the resident Workbench host.
// The existing SwiftTerm dylib stays a macOS-only product.
var products: [Product] = [.library(name: "WorkbenchCore", targets: ["WorkbenchCore"])]
var dependencies: [Package.Dependency] = []
var targets: [Target] = [
    .target(name: "WorkbenchCore"),
    .testTarget(name: "WorkbenchCoreTests", dependencies: ["WorkbenchCore"])
]
#if os(macOS)
products += [
    .library(name: "PapercuspTermShim", type: .dynamic, targets: ["PapercuspTermShim"]),
    .executable(name: "PapercuspWorkbench", targets: ["PapercuspWorkbench"])
]
dependencies += [.package(url: "https://github.com/migueldeicaza/SwiftTerm", from: "1.2.0")]
targets += [
    .target(name: "PapercuspTermShim", dependencies: [.product(name: "SwiftTerm", package: "SwiftTerm")]),
    .executableTarget(name: "PapercuspWorkbench", dependencies: ["WorkbenchCore"])
]
#endif

let package = Package(
    name: "PapercuspTermShim",
    platforms: [.macOS(.v13)],
    products: products,
    dependencies: dependencies,
    targets: targets
)
