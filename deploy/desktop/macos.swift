import Cocoa

final class RowsetApp: NSObject, NSApplicationDelegate {
    var status: NSStatusItem!
    var backend: Process?
    var stopping = false
    var executable: URL { Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/rowset") }

    func applicationDidFinishLaunching(_ notification: Notification) {
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status.button?.title = "Rowset"
        let menu = NSMenu()
        let open = menu.addItem(withTitle: "Open Rowset", action: #selector(openRowset), keyEquivalent: "o")
        open.target = self
        menu.addItem(NSMenuItem.separator())
        let quit = menu.addItem(withTitle: "Quit Rowset…", action: #selector(quitRowset), keyEquivalent: "q")
        quit.target = self
        status.menu = menu
        openRowset()
    }

    @objc func openRowset() {
        let process = Process()
        process.executableURL = executable
        process.arguments = ["desktop"]
        // Without this, `rowset desktop` re-execs itself detached and this
        // process exits within a second or two - which is right for someone
        // typing it into Terminal, but wrong here: the app already is the
        // long-lived process managing Rowset's lifecycle, and needs its own
        // handle on the real server to notice it crashing later, not just a
        // failed launch.
        var environment = ProcessInfo.processInfo.environment
        environment["ROWSET_DETACHED"] = "1"
        process.environment = environment
        process.terminationHandler = { child in
            if child.terminationStatus != 0 {
                DispatchQueue.main.async {
                    if self.stopping { return }
                    let alert = NSAlert()
                    alert.messageText = "Rowset could not start"
                    alert.informativeText = "Check the logs in ~/Library/Application Support/Rowset/Community/logs, then try opening Rowset again."
                    alert.runModal()
                }
            }
        }
        do { try process.run(); if backend == nil { backend = process } }
        catch { let alert = NSAlert(error: error); alert.runModal() }
    }

    @objc func quitRowset() {
        let alert = NSAlert()
        alert.messageText = "Quit Rowset?"
        alert.informativeText = "Running queries will stop and uncommitted transactions will be rolled back. Committed changes remain saved."
        alert.addButton(withTitle: "Quit and roll back")
        alert.addButton(withTitle: "Cancel")
        if alert.runModal() != .alertFirstButtonReturn { return }
        stopping = true
        let process = Process()
        process.executableURL = executable
        process.arguments = ["desktop-stop"]
        do { try process.run(); process.waitUntilExit() }
        catch { stopping = false; NSAlert(error: error).runModal(); return }
        if process.terminationStatus != 0 { stopping = false; return }
        NSApplication.shared.terminate(nil)
    }
}

let app = NSApplication.shared
let delegate = RowsetApp()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
