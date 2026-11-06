param(
    [Parameter(Mandatory=$true)][string]$SourceDirectory,
    [ValidateSet('all', 'compile', 'preflight', 'model', 'hotkeys', 'windows', 'lifecycle', 'accounts')][string]$Phase = 'all',
    [switch]$Interactive
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw 'Native WPF fixture requires -STA' }
foreach ($source in @('PuiReadBridge.cs', 'WorkbenchModel.cs', 'WorkbenchHost.cs')) {
    if (-not [IO.File]::Exists((Join-Path $SourceDirectory $source))) { throw "Missing native fixture source: $source" }
}
if ($Interactive) {
    # Reuse vm-smoke-windows.sh's owned InteractiveToken task pattern. SSH is
    # only the control transport; global shortcuts must run on the user desktop.
    $name = 'Papercusp-WorkbenchFixture-' + [Guid]::NewGuid().ToString('N')
    $directory = Join-Path $env:TEMP $name
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $receipt = Join-Path $directory 'exit.json'
    $stdout = Join-Path $directory 'stdout.txt'
    $stderr = Join-Path $directory 'stderr.txt'
    $fixtureCommand = "$" + "ProgressPreference='SilentlyContinue'; & '" + $PSCommandPath.Replace("'", "''") + "' -SourceDirectory '" +
        $SourceDirectory.Replace("'", "''") + "' -Phase '" + $Phase + "'"
    $encodedFixture = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($fixtureCommand))
    $runner = @'
param($EncodedFixture, $OutputDirectory)
$ErrorActionPreference = 'Stop'
try {
    $child = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @(
        '-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $EncodedFixture
    ) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $OutputDirectory 'stdout.txt') -RedirectStandardError (Join-Path $OutputDirectory 'stderr.txt') -Wait -PassThru
    $result = @{ exitCode = $child.ExitCode; sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId }
} catch { $result = @{ exitCode = 1; error = $_.Exception.ToString() } }
$target = Join-Path $OutputDirectory 'exit.json'
[IO.File]::WriteAllText(($target + '.tmp'), ($result | ConvertTo-Json -Compress))
Move-Item -LiteralPath ($target + '.tmp') -Destination $target
'@
    try {
        $runnerPath = Join-Path $directory 'run.ps1'
        [IO.File]::WriteAllText($runnerPath, $runner)
        $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument (
            '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -EncodedFixture {1} -OutputDirectory "{2}"' -f $runnerPath, $encodedFixture, $directory)
        $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
        Register-ScheduledTask -TaskName $name -Action $action -Principal $principal | Out-Null
        Start-ScheduledTask -TaskName $name
        $deadline = [DateTime]::UtcNow.AddSeconds(35)
        while (-not [IO.File]::Exists($receipt) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
        if (-not [IO.File]::Exists($receipt)) { throw 'Interactive fixture produced no terminal receipt; verify the signed-in user desktop' }
        $result = [IO.File]::ReadAllText($receipt) | ConvertFrom-Json
        if ([IO.File]::Exists($stderr)) { [Console]::Error.Write([IO.File]::ReadAllText($stderr)) }
        if ($result.exitCode -ne 0 -and [IO.File]::Exists($stdout)) {
            [Console]::Error.WriteLine('FAILED CHILD STDOUT: ' + [IO.File]::ReadAllText($stdout))
        }
        if ($result.PSObject.Properties['error']) { throw $result.error }
        if ($result.exitCode -ne 0) { throw "Interactive fixture exited $($result.exitCode)" }
        if ($result.sessionId -le 0) { throw 'Interactive fixture ran in service Session 0' }
        [Console]::Write([IO.File]::ReadAllText($stdout))
    } finally {
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($task) {
            if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $name }
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
        }
        Remove-Item -LiteralPath $directory -Recurse -Force
    }
    return
}
if ($Phase -eq 'lifecycle') {
    & (Join-Path $PSScriptRoot 'native-workbench-windows-lifecycle.ps1') -SourceDirectory $SourceDirectory -Resident
    return
}
[Console]::Error.WriteLine("PHASE compile: loading the production WPF source and full assembly references")
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml, System.Web.Extensions
$references = @('System.dll','System.Core.dll','System.Xaml.dll','System.Web.Extensions.dll',
    [Windows.Window].Assembly.Location, [Windows.Media.Brushes].Assembly.Location,
    [Windows.Threading.Dispatcher].Assembly.Location, [Windows.Automation.AutomationProperties].Assembly.Location)
$fixture = @'
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using Papercusp.Workbench;
public static class WorkbenchNativeHostFixture
{
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int Style(IntPtr h, int n);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr h, uint msg, IntPtr a, IntPtr b);
    private static readonly List<string> cases = new List<string>();
    private static Dictionary<string, object> Json(string text)
    { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(text); }
    private static void Check(bool ok, string name)
    {
        if (!ok) throw new Exception(name);
        cases.Add(name); Console.Error.WriteLine("PASS " + name);
    }
    private static void Refuses(Action action, string name)
    {
        var refused = false;
        try { action(); } catch (InvalidOperationException) { refused = true; }
        Check(refused, name);
    }
    private static Dictionary<string, object> Roster(params PanelResult[] rows)
    {
        return new Dictionary<string, object> { { "rows", new object[] {
            new Dictionary<string, object> { { "active", rows.Select(row => row.Row).ToArray() },
                { "ended", new object[0] }, { "pending", new object[0] }, { "starting", new object[0] } } } } };
    }
    private static PanelResult Agent(string json) { return PanelState.Result("agents", Json(json)); }
    private static void Agents()
    {
        var live = Agent("{\"advSessionId\":41,\"ownerId\":\"owner\",\"host\":\"desktop\",\"sessionState\":\"live\",\"windowId\":\"0x10\"}");
        var current = PanelState.AgentTarget(Roster(live), live, "DESKTOP", false);
        Check(current.Key == live.Key, "focus revalidates exact owner session host and recorded window");
        var changed = Agent("{\"advSessionId\":42,\"ownerId\":\"owner\",\"host\":\"desktop\",\"sessionState\":\"live\"}");
        Refuses(() => PanelState.AgentTarget(Roster(changed), live, "desktop", false), "same owner with a different session cannot steal focus");
        Refuses(() => PanelState.AgentTarget(Roster(live), live, "another-host", false), "operator locality cannot authorize a remote desktop focus");
        changed = Agent("{\"advSessionId\":41,\"ownerId\":\"another-owner\",\"host\":\"desktop\",\"sessionState\":\"live\",\"windowId\":\"0x10\"}");
        Refuses(() => PanelState.AgentTarget(Roster(changed), live, "desktop", false), "recycled session identity with another owner is refused");
        Refuses(() => PanelState.AgentTarget(Roster(live, live), live, "desktop", false), "ambiguous canonical session rows are refused");
        Refuses(() => PanelState.AgentTarget(Roster(live), live, "desktop", true), "live session cannot be resumed");
        var ended = Agent("{\"advSessionId\":41,\"ownerId\":\"owner\",\"host\":\"remote-host\",\"sessionState\":\"ended\"}");
        var resume = PanelState.AgentTarget(Roster(ended), ended, "desktop", true);
        Check(PanelState.ResumeArguments(resume).SequenceEqual(new[] { "workbench", "resume", "41", "remote-host", "owner" }),
            "ended remote resume uses canonical PUI command and exact saved identity");
        Refuses(() => PanelState.AgentTarget(Roster(ended), live, "desktop", true), "changed recorded host cannot authorize resume");
        changed = Agent("{\"advSessionId\":42,\"ownerId\":\"owner\",\"host\":\"remote-host\",\"sessionState\":\"parked\"}");
        Refuses(() => PanelState.AgentTarget(Roster(ended, changed), ended, "desktop", true), "another live session for the owner blocks ended resume");
        var partial = Roster(live); partial["partial"] = true;
        Refuses(() => PanelState.AgentTarget(partial, live, "desktop", false), "partial roster cannot authorize a terminal action");
        var anonymous = Agent("{\"ownerId\":\"owner\",\"host\":\"desktop\",\"sessionState\":\"live\"}");
        Refuses(() => PanelState.AgentTarget(Roster(anonymous), anonymous, "desktop", false), "agent label without exact session or window cannot authorize focus");
        var windows = new Dictionary<IntPtr, string> { { new IntPtr(16), "Terminal [adv:41]" }, { new IntPtr(17), "Terminal [adv:42]" } };
        Check(PanelState.ExactAgentWindow(current, windows) == new IntPtr(16), "recorded hexadecimal HWND selects the exact terminal");
        windows[new IntPtr(16)] = "Terminal [adv:42]";
        Refuses(() => PanelState.ExactAgentWindow(current, windows), "recycled HWND with conflicting session marker is refused");
        windows.Remove(new IntPtr(16)); windows[new IntPtr(17)] = "Terminal [adv:41]";
        Refuses(() => PanelState.ExactAgentWindow(current, windows), "missing recorded HWND cannot fall back to another matching title");
        current = Agent("{\"advSessionId\":41,\"ownerId\":\"owner\",\"host\":\"desktop\",\"sessionState\":\"live\"}");
        windows[new IntPtr(18)] = "Second terminal [adv:41]";
        Refuses(() => PanelState.ExactAgentWindow(current, windows), "duplicate session window markers cannot choose an arbitrary terminal");
        var area = new Rect(-500, 40, 320, 240);
        var first = WorkbenchHost.PanelBounds(area, 2, 0); var second = WorkbenchHost.PanelBounds(area, 2, 1);
        Check(area.Contains(first) && area.Contains(second) && !first.IntersectsWith(second),
            "pinned geometry fits a narrow work area with negative monitor coordinates");
        var argv = new[] { "", "space and ' apostrophe", "shell $() & | ;", "trailing\\", "embedded\"quote", "slashes\\\\\"quote", "Unicode \u03bb\u4e2d" };
        var start = new System.Diagnostics.ProcessStartInfo {
            FileName = Environment.GetEnvironmentVariable("WORKBENCH_ARGV_FIXTURE"),
            Arguments = PanelState.CommandLine(argv), UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, StandardOutputEncoding = new System.Text.UTF8Encoding(false, true) };
        using (var process = System.Diagnostics.Process.Start(start))
        {
            var output = process.StandardOutput.ReadToEnd();
            Check(process.WaitForExit(5000) && process.ExitCode == 0 &&
                new JavaScriptSerializer().Deserialize<string[]>(output).SequenceEqual(argv),
                "Windows native argv roundtrip preserves empty Unicode shell-looking quotes and trailing slashes");
        }
    }
    private static void Pump()
    {
        var frame = new DispatcherFrame();
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        timer.Tick += (s, e) => { timer.Stop(); frame.Continue = false; };
        timer.Start(); Dispatcher.PushFrame(frame);
    }
    private static void Model()
    {
        var state = new PanelState(); var g = state.BeginRefresh();
        state.Settle("plans", g, Json("{\"rows\":[{\"harness\":\"one\",\"slug\":\"same\",\"title\":\"Shared title\"},{\"harness\":\"two\",\"slug\":\"same\",\"title\":\"Shared title\"}],\"version\":\"canonical\"}"), null);
        Check(state.Results().Count == 2 && state.Results()[0].Key != state.Results()[1].Key, "plan identity includes canonical harness and slug");
        Check(state.Sources["plans"].Version.Equals("canonical"), "canonical version retained");
        state.Query = "shared same"; Check(state.Results().Count == 2, "all search terms match canonical text");
        state.Query = "unmatched"; Check(state.Results().Count == 0, "unmatched query returns no results"); state.Query = "";
        state.Settle("agents", g, Json("{\"rows\":[{\"active\":[],\"ended\":[{\"id\":41,\"coordOwnerId\":\"exact\",\"host\":\"remote\"}],\"pending\":[],\"starting\":[]}] }"), null);
        var ended = state.Sources["agents"].Rows.Single();
        Check(ended.Row["advSessionId"].Equals(41) && ended.Row["ownerId"].Equals("exact") && ended.Row["sessionState"].Equals("ended"), "ended roster preserves launch owner and host identity");
        var old = g; g = state.BeginRefresh();
        Check(!state.Settle("plans", old, Json("{\"rows\":[]}"), null) && state.Sources["plans"].Status == "loading", "stale refresh cannot replace a newer request");
        state.Settle("plans", g, Json("{\"rows\":[{\"slug\":\"missing-harness\"}]}"), null);
        Check(state.Sources["plans"].Status == "unavailable", "missing canonical identity fails closed");
        state.Settle("reports", g, Json("{\"rows\":[],\"ok\":false}"), null);
        state.Settle("goals", g, Json("{\"rows\":[{\"goals\":[],\"partial\":true}]}"), null);
        Check(state.Sources["reports"].Status == "unavailable" && state.Sources["goals"].Status == "ready" && state.Sources["goals"].Partial, "unavailable empty and partial are distinct");
        var many = new List<object>(); for (var i = 0; i < 30; ++i) many.Add(new { report_id = "r" + i, title = "Report " + i });
        state.Settle("reports", g, new Dictionary<string, object> { { "rows", new JavaScriptSerializer().DeserializeObject(new JavaScriptSerializer().Serialize(many)) } }, null);
        Check(state.Results().Count == 26 && state.Results(true).Count == 30, "result paging retains undisplayed canonical rows");
        state.ResultLimit += 26; Check(state.Results().Count == 30, "show more exposes the remaining results");
        state.Selection = "retained"; state.Query = "draft"; state.Visible = true; state.Pinned = true; state.OutsideFocus();
        Check(state.Visible && state.Query == "draft" && state.Selection == "retained", "pinned outside focus retains draft and selection");
        state.Detail = "detail";
        Check(state.Escape() == "detail" && state.Visible && state.Escape() == "panel" && !state.Visible, "Escape closes detail before panel");
        var plan = PanelState.Result("plans", Json("{\"harness\":\"selected\",\"slug\":\"literal +/=\"}"));
        Check(PanelState.DetailArgs(plan)["harness"].Equals("selected") && PanelState.DetailArgs(plan)["slug"].Equals("literal +/="), "detail routes exact harness and literal identity");
    }
    private static void Native(bool windows)
    {
        using (var host = new WorkbenchHost("C:\\nonexistent-workbench-fixture-pui.exe"))
        using (var collision = new WorkbenchHost("C:\\nonexistent-workbench-fixture-pui.exe"))
        {
            var keys = new Dictionary<string, Hotkey> { { "quick-access", new Hotkey(7, 0x79) }, { "goals", new Hotkey(7, 0x7A) } };
            Console.Error.WriteLine("STAGE initial shortcut registration");
            host.Configure(keys);
            var refused = false;
            try { collision.Configure(keys); } catch (InvalidOperationException) { refused = true; }
            Check(refused && collision.BindingCount == 0 && host.BindingCount == 2, "native shortcut collision preserves live owner");
            var duplicate = false;
            try { host.Configure(new Dictionary<string, Hotkey> { { "quick-access", new Hotkey(7, 0x7A) }, { "goals", new Hotkey(7, 0x7A) } }); }
            catch (ArgumentException) { duplicate = true; }
            Check(duplicate && host.BindingCount == 2, "duplicate shortcut edit preserves both prior bindings");
            var reserved = false;
            try { host.Configure(new Dictionary<string, Hotkey> { { "quick-access", new Hotkey(7, 0x7B) } }); }
            catch (ArgumentException) { reserved = true; }
            Check(reserved && host.BindingCount == 2, "reserved F12 is rejected before replacing live shortcuts");
            refused = false;
            try { collision.Configure(new Dictionary<string, Hotkey> {
                { "quick-access", new Hotkey(7, 0x78) }, { "goals", keys["quick-access"] } }); }
            catch (InvalidOperationException) { refused = true; }
            using (var probe = new WorkbenchHost("C:\\nonexistent-workbench-fixture-pui.exe"))
            {
                probe.Configure(new Dictionary<string, Hotkey> { { "quick-access", new Hotkey(7, 0x78) } });
                Check(refused && collision.BindingCount == 0 && host.BindingCount == 2 && probe.BindingCount == 1,
                    "failed multi-shortcut edit releases newly acquired keys and retains prior owner");
            }
            if (windows)
            {
            host.Toggle("quick-access"); Pump();
            var panel = host.Panel("quick-access"); var hwnd = new WindowInteropHelper(panel).Handle;
            Check(panel.IsVisible && panel.WindowStyle == WindowStyle.None && !panel.ShowInTaskbar &&
                (Style(hwnd, -20) & 0x80) != 0 && (Style(hwnd, -20) & 0x40000) == 0 &&
                (Style(hwnd, -16) & 0xC00000) == 0, "real HWND is chrome-free tool window without taskbar identity");
            Check(host.State("quick-access").Sources.Values.All(source => source.Status == "unavailable"), "failed PUI reads remain visible as unavailable");
            host.State("quick-access").Query = "draft";
            host.Toggle("quick-access"); Pump(); host.Toggle("quick-access"); Pump();
            Check(host.Panel("quick-access") == panel && host.State("quick-access").Query == "draft", "shortcut toggle retains resident window and query");
            host.State("quick-access").Pinned = true; host.Toggle("goals"); Pump();
            Check(host.State("quick-access").Visible && host.State("goals").Visible, "independent pin permits both surfaces");
            var quickBounds = new Rect(panel.Left, panel.Top, panel.Width, panel.Height);
            var goals = host.Panel("goals"); var goalBounds = new Rect(goals.Left, goals.Top, goals.Width, goals.Height);
            Check(!quickBounds.IntersectsWith(goalBounds) && SystemParameters.WorkArea.Contains(quickBounds) &&
                SystemParameters.WorkArea.Contains(goalBounds), "real pinned WPF panels remain separate inside the desktop work area");
            host.Toggle("goals"); Pump();
            Check(panel.Width == WorkbenchHost.PanelBounds(SystemParameters.WorkArea, 1, 0).Width && !goals.IsVisible,
                "dismissing a pinned companion returns its slot to the remaining panel");
            }
            Console.Error.WriteLine("STAGE swap shortcut registration");
            host.Configure(new Dictionary<string, Hotkey> { { "goals", keys["quick-access"] }, { "quick-access", keys["goals"] } });
            Check(host.BindingCount == 2, "atomic shortcut swap reuses native registrations");
            host.Configure(new Dictionary<string, Hotkey>());
            Console.Error.WriteLine("STAGE registration after disable");
            collision.Configure(keys);
            Check(host.BindingCount == 0 && collision.BindingCount == 2, "disable releases shortcuts for another native owner");
        }
    }
    private static string EnvironmentJson = "{\"endpoint\":\"http://fixture.invalid:3170\",\"workspaceId\":\"isolated\",\"store\":{\"id\":\"fixture\"},\"agentChat\":{\"scope\":\"workspace:isolated\"}}";
    private static Dictionary<string, object> Envelope(string row)
    { return Json("{\"rows\":[" + row + "]}"); }
    private static void AccountsModel()
    {
        var environment = Json(EnvironmentJson);
        var pool = Json("{\"rows\":[{\"id\":\"literal +/=& \\u03bb\",\"label\":\"Same\"},{\"id\":\"other\",\"label\":\"Same\"}]}");
        var steering = Envelope("{\"defaultAccountId\":\"other\",\"forcedAccounts\":[],\"excludeAccounts\":[\"other\"]}");
        var state = new AccountState(); var generation = state.Begin();
        state.Settle(generation, environment, pool, steering, null);
        Check(state.Ready && state.Accounts.Count == 2 && PanelState.Text(state.Accounts[0], "id") == "literal +/=& \u03bb", "Accounts preserves distinct exact ids with duplicate labels");
        Check(!state.Settle(generation - 1, null, null, null, new Exception("old")) && state.Ready, "stale account refresh cannot replace confirmed state");
        var partial = Json("{\"rows\":[],\"partial\":true}");
        state.Settle(state.Begin(), environment, partial, steering, null);
        Check(!state.Ready && state.Error != null, "partial account pool disables steering");
        state.Settle(state.Begin(), environment, Json("{\"rows\":[{\"id\":\"one\"},{\"id\":\"one\"}]}"), steering, null);
        Check(!state.Ready, "duplicate account identity fails closed");
        state.Settle(state.Begin(), Json("{\"endpoint\":\"http://fixture.invalid\",\"workspaceId\":\"isolated\"}"), pool, steering, null);
        Check(!state.Ready, "missing selected store identity fails closed");
        state.Settle(state.Begin(), environment, pool, steering, null);
        var confirmed = state.Override;
        state.Applied(++state.Generation, environment, null, new Exception("write denied"));
        Check(state.Override == confirmed && !state.Ready, "failed account write preserves confirmed state and requires refresh");
        state.Settle(state.Begin(), environment, pool, steering, null);
        var wrong = Envelope("{\"defaultAccountId\":\"changed\",\"forcedAccounts\":[],\"excludeAccounts\":[]}");
        wrong["environment"] = Json(EnvironmentJson.Replace("isolated", "another"));
        state.Applied(++state.Generation, environment, wrong, null);
        Check(PanelState.Text(state.Override, "defaultAccountId") == "other" && !state.Ready, "wrong environment acknowledgement cannot update account controls");
        state.Settle(state.Begin(), environment, pool, steering, null);
        var applied = Envelope("{\"defaultAccountId\":\"literal +/=& \\u03bb\",\"forcedAccounts\":[],\"excludeAccounts\":[\"other\"]}");
        applied["environment"] = environment;
        state.Applied(++state.Generation, environment, applied, null);
        Check(state.Ready && state.Contains("excludeAccounts", "other") && PanelState.Text(state.Override, "defaultAccountId") == "literal +/=& \u03bb", "confirmed account response preserves independent steering axes");
    }
    private static T Find<T>(DependencyObject parent, string name) where T : DependencyObject
    {
        if (parent is T && System.Windows.Automation.AutomationProperties.GetName(parent) == name) return (T)parent;
        foreach (var child in LogicalTreeHelper.GetChildren(parent).OfType<DependencyObject>())
        { var found = Find<T>(child, name); if (found != null) return found; }
        return null;
    }
    private static void Until(Func<bool> condition)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        do { Pump(); if (condition()) return; } while (DateTime.UtcNow < deadline);
        throw new Exception("Native account UI did not settle");
    }
    private static void AccountsNative()
    {
        Console.Error.WriteLine("STAGE Accounts constructor thread=" + Thread.CurrentThread.ManagedThreadId +
            " context=" + (SynchronizationContext.Current == null ? "null" : SynchronizationContext.Current.GetType().FullName));
        using (var host = new WorkbenchHost(Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_FIXTURE")))
        {
            Console.Error.WriteLine("STAGE Accounts toggle");
            host.Toggle("accounts"); var panel = host.Panel("accounts");
            Console.Error.WriteLine("STAGE Accounts logical control lookup");
            var scope = Find<System.Windows.Controls.TextBlock>(panel, "Account environment");
            var summary = Find<System.Windows.Controls.TextBlock>(panel, "Account steering");
            var force = Find<System.Windows.Controls.Button>(panel, "Account force");
            var exclude = Find<System.Windows.Controls.Button>(panel, "Account exclude");
            var normal = Find<System.Windows.Controls.Button>(panel, "Account default");
            var auto = Find<System.Windows.Controls.Button>(panel, "Account auto");
            if (scope == null || summary == null || force == null || exclude == null || normal == null || auto == null)
                throw new Exception("Accounts logical tree is missing a required named control");
            Console.Error.WriteLine("STAGE Accounts dispatcher wait");
            Until(() => force.IsEnabled);
            Check(panel.IsVisible && scope.Text.Contains("fixture.invalid:3170") && scope.Text.Contains("isolated") &&
                normal.IsEnabled && exclude.IsEnabled && auto.IsEnabled, "native Accounts displays selected environment and four separate controls");
            force.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
            Until(() => force.IsEnabled);
            Check(summary.Text.Contains("Force: literal +/=& \u03bb") && summary.Text.Contains("Default: other") && summary.Text.Contains("Exclude: other"), "WPF Force sends exact selected identity and preserves Default and Exclude");
            normal.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent)); Until(() => normal.IsEnabled);
            Check(summary.Text.Contains("Default: literal +/=& \u03bb") && summary.Text.Contains("Force: literal +/=& \u03bb"), "WPF Default preserves Force");
            exclude.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent)); Until(() => exclude.IsEnabled);
            Check(summary.Text.Contains("Exclude: other, literal +/=& \u03bb") && summary.Text.Contains("Force: literal +/=& \u03bb"), "WPF Exclude preserves independent Force");
            auto.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent)); Until(() => auto.IsEnabled);
            Check(summary.Text.Contains("Default: literal +/=& \u03bb") && !summary.Text.Contains("Force: literal") && !summary.Text.Contains("Exclude: other"), "WPF Auto clears Force and Exclude while preserving Default");
            var before = summary.Text;
            System.IO.File.WriteAllText(Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_STATE") + ".deny", "deny");
            force.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
            Until(() => Find<System.Windows.Controls.TextBlock>(panel, "Workbench status").Text.StartsWith("Unavailable"));
            Check(summary.Text == before, "failed native account write keeps the last confirmed steering visible");
            Check(!force.IsEnabled && !normal.IsEnabled && !exclude.IsEnabled && !auto.IsEnabled, "failed native account write disables further controls until refresh");
            var search = Find<System.Windows.Controls.TextBox>(panel, "Search Workbench"); search.Text = "literal";
            host.Toggle("accounts"); host.Toggle("accounts"); Pump();
            Check(host.Panel("accounts") == panel && search.Text == "literal", "resident Accounts retains its query across toggles");
        }
    }
    public static string Run(string phase)
    {
        cases.Clear();
        AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            Console.Error.WriteLine("UNHANDLED thread=" + Thread.CurrentThread.ManagedThreadId + ": " + e.ExceptionObject);
        AppDomain.CurrentDomain.FirstChanceException += (s, e) =>
        {
            if (e.Exception is InvalidOperationException && e.Exception.Message.Contains("thread"))
                Console.Error.WriteLine("THREAD ACCESS thread=" + Thread.CurrentThread.ManagedThreadId + ": " + e.Exception);
        };
        // Application.Run installs this context in the resident host. PowerShell
        // calls this fixture before any dispatcher frame, so reproduce that
        // precondition before async WPF actions capture their continuation.
        SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(Dispatcher.CurrentDispatcher));
        if (!(SynchronizationContext.Current is DispatcherSynchronizationContext))
            throw new Exception("Native fixture requires the WPF dispatcher synchronization context");
        if (phase == "preflight")
        {
            if (!WorkbenchHost.HasInteractiveDesktop)
            {
                var refused = false;
                try { using (var host = new WorkbenchHost("C:\\nonexistent-workbench-fixture-pui.exe")) {} }
                catch (InvalidOperationException error) { refused = error.Message.Contains("interactive Windows desktop"); }
                Check(refused, "service station is refused before creating windows or acquiring shortcuts");
            }
            else Check(WorkbenchHost.HasInteractiveDesktop, "visible user desktop satisfies native host precondition");
        }
        if (phase == "all" || phase == "model") { Console.Error.WriteLine("PHASE model"); Model(); Agents(); }
        if (phase == "accounts") { AccountsModel(); AccountsNative(); }
        if (phase == "all" || phase == "hotkeys" || phase == "windows")
        { Console.Error.WriteLine("PHASE " + (phase == "all" ? "windows" : phase)); Native(phase != "hotkeys"); }
        return new JavaScriptSerializer().Serialize(new { ok = true, platform = "windows", phase = phase, cases = cases.ToArray(), count = cases.Count,
            processSessionId = System.Diagnostics.Process.GetCurrentProcess().SessionId,
            interactiveDesktop = WorkbenchHost.HasInteractiveDesktop,
            scope = phase == "all" ? "native-model-and-WPF-HWND-fixture" : "native-" + phase + "-fixture" });
    }
}
'@
$fixtureFile = Join-Path ([IO.Path]::GetTempPath()) ('workbench-host-' + [Guid]::NewGuid().ToString('N') + '.cs')
$accountFixture = $fixtureFile + '.accounts.exe'
$accountState = $accountFixture + '.json'
$argvFixture = Join-Path ([IO.Path]::GetTempPath()) ('workbench-argv-' + [Guid]::NewGuid().ToString('N') + '.exe')
try {
    Add-Type -OutputAssembly $argvFixture -OutputType ConsoleApplication -ReferencedAssemblies System.Web.Extensions -TypeDefinition @'
using System;
using System.Text;
using System.Web.Script.Serialization;
public static class WorkbenchArgvFixture {
    public static void Main(string[] args) {
        var bytes = new UTF8Encoding(false).GetBytes(new JavaScriptSerializer().Serialize(args));
        Console.OpenStandardOutput().Write(bytes, 0, bytes.Length);
    }
}
'@
    $env:WORKBENCH_ARGV_FIXTURE = $argvFixture
    if ($Phase -eq 'accounts') {
        $env:WORKBENCH_ACCOUNT_FIXTURE = $accountFixture; $env:WORKBENCH_ACCOUNT_STATE = $accountState
        Add-Type -OutputAssembly $accountFixture -OutputType ConsoleApplication -ReferencedAssemblies System.Web.Extensions, System.Core -TypeDefinition @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
public static class NativeAccountsFixture {
    public static int Main(string[] args) {
        var json = new JavaScriptSerializer(); var utf8 = new UTF8Encoding(false, true);
        var request = json.Deserialize<Dictionary<string, object>>(new StreamReader(Console.OpenStandardInput(), utf8).ReadToEnd());
        var path = Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_STATE");
        var environment = json.DeserializeObject("{\"endpoint\":\"http://fixture.invalid:3170\",\"workspaceId\":\"isolated\",\"store\":{\"id\":\"fixture\"},\"agentChat\":{\"scope\":\"workspace:isolated\"}}");
        var state = json.Deserialize<Dictionary<string, object>>(File.Exists(path) ? File.ReadAllText(path) :
            "{\"defaultAccountId\":\"other\",\"forcedAccounts\":[],\"excludeAccounts\":[\"other\"]}");
        object rows; var scoped = false;
        if (args.Length != 1) return 23;
        if (args[0] == "native-account") {
            if (File.Exists(path + ".deny")) { Console.Error.Write("isolated write denied"); return 7; }
            if (json.Serialize(request["environment"]) != json.Serialize(environment)) return 24;
            var action = (string)request["action"]; var id = request["accountId"] as string;
            if (action == "auto") { state["forcedAccounts"] = new string[0]; state["excludeAccounts"] = new string[0]; }
            else if (action == "default") state["defaultAccountId"] = Object.Equals(state["defaultAccountId"], id) ? null : id;
            else {
                var field = action == "force" ? "forcedAccounts" : "excludeAccounts";
                var values = ((IList)state[field]).Cast<string>().ToList();
                if (!values.Remove(id)) values.Add(id); state[field] = values;
            }
            File.WriteAllText(path, json.Serialize(state)); rows = new object[] { state }; scoped = true;
        } else if (args[0] == "native-read") {
            var name = (string)request["name"];
            rows = name == "operator.identity" ? new object[] { environment } : name == "accounts.pool" ? new object[] {
                new { id = "literal +/=& \u03bb", label = "Same", provider = "fixture", available = true },
                new { id = "other", label = "Same", provider = "fixture", available = true } } : new object[] { state };
        } else return 25;
        var result = new Dictionary<string, object> { { "rows", rows } }; if (scoped) result["environment"] = environment;
        var bytes = utf8.GetBytes(json.Serialize(result)); Console.OpenStandardOutput().Write(bytes, 0, bytes.Length); return 0;
    }
}
'@
    }
    [IO.File]::WriteAllText($fixtureFile, $fixture)
    Add-Type -Path @((Join-Path $SourceDirectory 'PuiReadBridge.cs'),
        (Join-Path $SourceDirectory 'WorkbenchModel.cs'), (Join-Path $SourceDirectory 'WorkbenchHost.cs'), $fixtureFile) -ReferencedAssemblies $references
    [WorkbenchNativeHostFixture]::Run($Phase)
} catch { [Console]::Error.WriteLine($_.Exception.ToString()); throw }
finally {
    if (Test-Path -LiteralPath $fixtureFile) { Remove-Item -LiteralPath $fixtureFile -Force }
    if (Test-Path -LiteralPath $argvFixture) { Remove-Item -LiteralPath $argvFixture -Force }
    Remove-Item Env:WORKBENCH_ARGV_FIXTURE -ErrorAction SilentlyContinue
    foreach ($path in @($accountFixture, $accountState, ($accountState + '.deny'))) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    Remove-Item Env:WORKBENCH_ACCOUNT_FIXTURE, Env:WORKBENCH_ACCOUNT_STATE -ErrorAction SilentlyContinue
}
