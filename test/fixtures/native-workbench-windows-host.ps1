param(
    [Parameter(Mandatory=$true)][string]$SourceDirectory,
    [ValidateSet('all', 'compile', 'preflight', 'model', 'hotkeys', 'windows', 'lifecycle', 'accounts', 'goals', 'inbox', 'operator', 'fixture-diagnostics', 'fixture-failure', 'fixture-timeout')][string]$Phase = 'all',
    [string]$PuiExecutable,
    [string]$OperatorUrl,
    [string]$ExpectedWorkspace,
    [string]$ExpectedPlan,
    [string]$ExpectedGoal,
    [switch]$Interactive
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw 'Native WPF fixture requires -STA' }
foreach ($source in @('PuiReadBridge.cs', 'WorkbenchModel.cs', 'WorkbenchHost.cs')) {
    if (-not [IO.File]::Exists((Join-Path $SourceDirectory $source))) { throw "Missing native fixture source: $source" }
}
if ($Phase -eq 'fixture-diagnostics') {
    $priorEvidence = $env:PAPERCUSP_NATIVE_EVIDENCE_DIR
    $directory = Join-Path $env:TEMP ('WorkbenchDiagnostics-' + [Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($directory)
    $env:PAPERCUSP_NATIVE_EVIDENCE_DIR = $directory
    $cases = [Collections.Generic.List[string]]::new()
    function Check([bool]$Value, [string]$Name) {
        if (-not $Value) { throw $Name }
        $cases.Add($Name)
    }
    try {
        foreach ($diagnosticPhase in @('fixture-failure', 'fixture-timeout')) {
            $out = Join-Path $directory ($diagnosticPhase + '.out')
            $err = Join-Path $directory ($diagnosticPhase + '.err')
            $command = "& '" + $PSCommandPath.Replace("'", "''") + "' -SourceDirectory '" +
                $SourceDirectory.Replace("'", "''") + "' -Phase '" + $diagnosticPhase + "' -Interactive"
            $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
            $process = Start-Process "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @(
                '-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded
            ) -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
            # Windows PowerShell loses ExitCode after redirected child exit
            # unless the native process handle is retained before waiting.
            $null = $process.Handle
            if (-not $process.WaitForExit(40000)) { throw 'Diagnostic wrapper did not enforce its deadline' }
            Check ($process.ExitCode -eq 1) ($diagnosticPhase + ' rejects the injected failure')
            $process.Dispose()
            Check ([IO.File]::ReadAllText($err).Contains('WORKBENCH_FIXTURE_EVIDENCE ')) ($diagnosticPhase + ' returns retained evidence location')
            $manifests = @(Get-ChildItem -LiteralPath $directory -Filter diagnostic.json -Recurse | ForEach-Object {
                [IO.File]::ReadAllText($_.FullName) | ConvertFrom-Json
            } | Where-Object { $_.phase -eq $diagnosticPhase })
            Check ($manifests.Count -eq 1 -and -not $manifests[0].ok) ($diagnosticPhase + ' records failed phase')
            $manifest = $manifests[0]
            Check ([IO.File]::ReadAllText((Join-Path $manifest.directory 'stdout.txt')).Contains('diagnostic child entered')) ($diagnosticPhase + ' retains child stdout')
            Check ([IO.File]::ReadAllText((Join-Path $manifest.directory 'stderr.txt')).Contains('diagnostic stderr retained')) ($diagnosticPhase + ' retains child stderr')
            $identity = [IO.File]::ReadAllText((Join-Path $manifest.directory 'child.json')) | ConvertFrom-Json
            $childProcess = Get-Process -Id $identity.id -ErrorAction SilentlyContinue
            Check (-not $childProcess -or $childProcess.StartTime.ToUniversalTime().Ticks -ne $identity.startTicks) ($diagnosticPhase + ' leaves no owned child')
            Check ($null -eq (Get-ScheduledTask -TaskName $manifest.taskName -ErrorAction SilentlyContinue)) ($diagnosticPhase + ' unregisters its task')
            if ($diagnosticPhase -eq 'fixture-timeout') { Check ($null -ne $manifest.stoppedChild) 'timeout cleanup verifies and terminates the owned child tree' }
        }
        @{ok=$true; platform='windows'; phase=$Phase; count=$cases.Count; cases=$cases.ToArray()} | ConvertTo-Json -Depth 4 -Compress
    } finally {
        $env:PAPERCUSP_NATIVE_EVIDENCE_DIR = $priorEvidence
        if ($cases.Count -eq 15) { Remove-Item -LiteralPath $directory -Recurse -Force }
        else { [Console]::Error.WriteLine('Diagnostic self-test evidence: ' + $directory) }
    }
    return
}
if ($Interactive) {
    # Reuse vm-smoke-windows.sh's owned InteractiveToken task pattern. SSH is
    # only the control transport; global shortcuts must run on the user desktop.
    $name = 'Papercusp-WorkbenchFixture-' + [Guid]::NewGuid().ToString('N')
    $evidenceRoot = if ($env:PAPERCUSP_NATIVE_EVIDENCE_DIR) { $env:PAPERCUSP_NATIVE_EVIDENCE_DIR } else { $env:TEMP }
    $directory = Join-Path $evidenceRoot $name
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $receipt = Join-Path $directory 'exit.json'
    $stdout = Join-Path $directory 'stdout.txt'
    $stderr = Join-Path $directory 'stderr.txt'
    $fixtureCommand = "$" + "ProgressPreference='SilentlyContinue'; " + '$env:PAPERCUSP_NATIVE_FIXTURE_PROGRESS=' +
        "'" + (Join-Path $directory 'progress.log').Replace("'", "''") + "'; & '" + $PSCommandPath.Replace("'", "''") + "' -SourceDirectory '" +
        $SourceDirectory.Replace("'", "''") + "' -Phase '" + $Phase + "'"
    if ($Phase -eq 'operator') {
        foreach ($nameValue in @(@('PuiExecutable', $PuiExecutable), @('OperatorUrl', $OperatorUrl),
            @('ExpectedWorkspace', $ExpectedWorkspace), @('ExpectedPlan', $ExpectedPlan), @('ExpectedGoal', $ExpectedGoal))) {
            $fixtureCommand += " -" + $nameValue[0] + " '" + $nameValue[1].Replace("'", "''") + "'"
        }
    }
    $encodedFixture = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($fixtureCommand))
    $runner = @'
param($EncodedFixture, $OutputDirectory)
$ErrorActionPreference = 'Stop'
try {
    $child = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @(
        '-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $EncodedFixture
    ) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $OutputDirectory 'stdout.txt') -RedirectStandardError (Join-Path $OutputDirectory 'stderr.txt') -PassThru
    $null = $child.Handle
    [IO.File]::WriteAllText((Join-Path $OutputDirectory 'child.json'), (@{
        id = $child.Id; startTicks = $child.StartTime.ToUniversalTime().Ticks
    } | ConvertTo-Json -Compress))
    $child.WaitForExit()
    $result = @{ exitCode = $child.ExitCode; sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId }
    $child.Dispose()
} catch { $result = @{ exitCode = 1; error = $_.Exception.ToString() } }
$target = Join-Path $OutputDirectory 'exit.json'
[IO.File]::WriteAllText(($target + '.tmp'), ($result | ConvertTo-Json -Compress))
Move-Item -LiteralPath ($target + '.tmp') -Destination $target
'@
    $completed = $false
    $failure = $null
    $startedAt = [DateTime]::UtcNow.ToString('o')
    try {
        $runnerPath = Join-Path $directory 'run.ps1'
        [IO.File]::WriteAllText($runnerPath, $runner)
        $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument (
            '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -EncodedFixture {1} -OutputDirectory "{2}"' -f $runnerPath, $encodedFixture, $directory)
        $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
        Register-ScheduledTask -TaskName $name -Action $action -Principal $principal | Out-Null
        Start-ScheduledTask -TaskName $name
        $deadline = [DateTime]::UtcNow.AddSeconds($(if ($Phase -eq 'operator') { 90 } elseif ($Phase -eq 'fixture-timeout') { 12 } else { 35 }))
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
        $completed = $true
    } catch {
        $failure = $_.Exception.Message
        throw
    } finally {
        $stoppedChild = $null
        if (-not $completed -and [IO.File]::Exists((Join-Path $directory 'child.json'))) {
            $owned = [IO.File]::ReadAllText((Join-Path $directory 'child.json')) | ConvertFrom-Json
            $childProcess = Get-Process -Id $owned.id -ErrorAction SilentlyContinue
            if ($childProcess -and $childProcess.StartTime.ToUniversalTime().Ticks -eq $owned.startTicks) {
                # Verify creation identity before terminating only this fixture's tree.
                & "$env:SystemRoot\System32\taskkill.exe" /PID $owned.id /T /F 2>&1 | Out-Null
                $stoppedChild = $owned.id
            }
        }
        $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($task) {
            if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $name }
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
        }
        if ($completed -and -not $env:PAPERCUSP_NATIVE_EVIDENCE_DIR) {
            Remove-Item -LiteralPath $directory -Recurse -Force
        } else {
            $diagnostic = @{ ok=$completed; phase=$Phase; startedAt=$startedAt; finishedAt=[DateTime]::UtcNow.ToString('o');
                error=$failure; stoppedChild=$stoppedChild; directory=$directory; taskName=$name }
            [IO.File]::WriteAllText((Join-Path $directory 'diagnostic.json'), ($diagnostic | ConvertTo-Json -Compress))
            if (-not $completed) {
                foreach ($log in @('progress.log', 'stdout.txt', 'stderr.txt')) {
                    $logPath = Join-Path $directory $log
                    if ([IO.File]::Exists($logPath)) { [Console]::Error.WriteLine($log + ': ' + [IO.File]::ReadAllText($logPath)) }
                }
            }
            [Console]::Error.WriteLine('WORKBENCH_FIXTURE_EVIDENCE ' + (Join-Path $directory 'diagnostic.json'))
        }
    }
    return
}
if ($Phase -in @('fixture-failure', 'fixture-timeout')) {
    [Console]::Out.WriteLine('fixture diagnostic child entered ' + $Phase)
    [Console]::Error.WriteLine('fixture diagnostic stderr retained')
    if ($Phase -eq 'fixture-failure') { throw 'injected native fixture failure' }
    Start-Sleep -Seconds 30
    throw 'fixture timeout was not enforced'
}
if ($Phase -eq 'lifecycle') {
    & (Join-Path $PSScriptRoot 'native-workbench-windows-lifecycle.ps1') -SourceDirectory $SourceDirectory -Resident
    return
}
if ($Phase -eq 'operator') {
    if (-not [IO.File]::Exists($PuiExecutable) -or -not $OperatorUrl -or -not $ExpectedWorkspace -or -not $ExpectedPlan) {
        throw 'Operator phase requires actual PUI, explicit operator URL, expected workspace and plan'
    }
    $env:PUI_OPERATOR = $OperatorUrl; $env:PAPERCUSP_OPERATOR_URL = $OperatorUrl
    $env:WORKBENCH_REAL_PUI = $PuiExecutable
    $env:WORKBENCH_EXPECTED_WORKSPACE = $ExpectedWorkspace; $env:WORKBENCH_EXPECTED_PLAN = $ExpectedPlan
    $env:WORKBENCH_EXPECTED_GOAL = $ExpectedGoal
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
    private static void Until(Func<bool> condition, int seconds = 10)
    {
        var deadline = DateTime.UtcNow.AddSeconds(seconds);
        do { Pump(); if (condition()) return; } while (DateTime.UtcNow < deadline);
        throw new Exception("Native UI did not settle within " + seconds + " seconds");
    }
    private static void OperatorNative()
    {
        var pui = Environment.GetEnvironmentVariable("WORKBENCH_REAL_PUI");
        var identity = AccountState.One(PuiReadBridge.ReadAsync(pui, "operator.identity", null, CancellationToken.None).GetAwaiter().GetResult());
        Check(PanelState.Text(identity, "workspaceId") == Environment.GetEnvironmentVariable("WORKBENCH_EXPECTED_WORKSPACE") &&
            PanelState.Text(identity, "endpoint").TrimEnd('/') == Environment.GetEnvironmentVariable("PUI_OPERATOR").TrimEnd('/'),
            "actual WPF helper selects the expected operator workspace");
        using (var host = new WorkbenchHost(pui))
        {
            host.Toggle("quick-access");
            var state = host.State("quick-access"); var panel = host.Panel("quick-access");
            Until(() => state.Sources.Count == 4 && state.Sources.Values.All(source => source.Status != "loading"), 25);
            foreach (var kind in PanelState.Kinds)
                Check(state.Sources[kind].Status == "ready", "actual WPF " + kind + " canonical rows loaded: " + state.Sources[kind].Error);
            var list = Find<System.Windows.Controls.ListBox>(panel, "Workbench results");
            Check(panel.IsVisible && new WindowInteropHelper(panel).Handle != IntPtr.Zero && list != null,
                "actual canonical results are rendered in the resident WPF HWND");
            Check(list.Items.Cast<PanelResult>().Select(row => row.Key).SequenceEqual(state.Results().Select(row => row.Key)),
                "actual WPF list retains the canonical result identities");
            Check(state.Sources["plans"].Rows.Any(row => PanelState.Text(row.Row, "slug") == Environment.GetEnvironmentVariable("WORKBENCH_EXPECTED_PLAN")),
                "actual Workbench plan is present in the canonical native results");
            state.Pinned = true; host.Toggle("goals");
            var goals = host.State("goals");
            Until(() => goals.Sources.Count == 1 && goals.Sources["goals"].Status != "loading", 25);
            Check(goals.Sources["goals"].Status == "ready" && host.Panel("goals").IsVisible,
                "actual Goals portfolio loads in its independent native panel");
            var goalList = Find<System.Windows.Controls.ListBox>(host.Panel("goals"), "Workbench results");
            Check(goalList.Items.Cast<PanelResult>().Select(row => row.Key).SequenceEqual(goals.Results().Select(row => row.Key)),
                "actual Goals rows retain canonical identities including valid empty results");
            var expectedGoal = Environment.GetEnvironmentVariable("WORKBENCH_EXPECTED_GOAL");
            if (!String.IsNullOrWhiteSpace(expectedGoal))
            {
                var selected = goalList.Items.Cast<PanelResult>().SingleOrDefault(row => PanelState.Text(row.Row, "id") == expectedGoal);
                Check(selected != null, "actual Goals portfolio contains the explicitly selected integration goal");
                goalList.SelectedItem = selected;
                goalList.RaiseEvent(new System.Windows.Input.MouseButtonEventArgs(System.Windows.Input.Mouse.PrimaryDevice, 0,
                    System.Windows.Input.MouseButton.Left) { RoutedEvent = System.Windows.Controls.Control.MouseDoubleClickEvent });
                Until(() => goals.Detail != null && goals.Detail != "Loading…", 25);
                Check(!goals.Detail.StartsWith("Unavailable"), "actual Windows PUI loads native canonical Goal detail");
                var detail = Json(goals.Detail);
                var goal = (Dictionary<string, object>)detail["goal"];
                Check(PanelState.Text(goal, "id") == expectedGoal && detail.ContainsKey("evidence"),
                    "actual native Goal detail preserves selected identity and canonical evidence");
                var controlStatus = Find<System.Windows.Controls.TextBlock>(host.Panel("goals"), "Goal control status");
                Check(controlStatus.Visibility == Visibility.Visible &&
                    controlStatus.Text.Contains("Workspace: " + PanelState.Text(identity, "workspaceId")) &&
                    controlStatus.Text.Contains(PanelState.Text(identity, "endpoint")) &&
                    controlStatus.Text.Contains("Status: " + PanelState.Text(goal, "status")) &&
                    controlStatus.Text.Contains(" · " + PanelState.Text(detail, "effectiveStatus") + " · holder " + PanelState.Text(detail, "holderLiveness")),
                    "actual native Goal controls display confirmed environment status and holder liveness");
                var wrongEnvironment = new Dictionary<string, object>(identity);
                wrongEnvironment["workspaceId"] = PanelState.Text(identity, "workspaceId") + "-not-selected";
                var args = PanelState.DetailArgs(selected); args["workspaceId"] = identity["workspaceId"];
                Refuses(() => PuiReadBridge.ReadAsync(pui, "goals.detail", args, CancellationToken.None, 22000, wrongEnvironment)
                    .GetAwaiter().GetResult(), "actual Goal detail refuses a changed selected workspace");
            }
            host.Toggle("quick-access"); host.Toggle("quick-access"); Pump();
            Check(host.Panel("quick-access") == panel && state.Pinned,
                "actual native read panel retains its resident window and pin across toggles");
        }
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
    private static void GoalsNative()
    {
        var path = Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_STATE");
        using (var host = new WorkbenchHost(Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_FIXTURE")))
        {
            host.Toggle("goals"); var panel = host.Panel("goals"); var state = host.State("goals");
            Until(() => state.Sources.Count == 1 && state.Sources["goals"].Status == "ready");
            var list = Find<System.Windows.Controls.ListBox>(panel, "Workbench results");
            Check(list.Items.Count == 1 && ((PanelResult)list.Items[0]).Row["id"].ToString() == "literal +/=& \u03bb", "Goals native portfolio preserves the exact canonical selection");
            Action open = () => list.RaiseEvent(new System.Windows.Input.MouseButtonEventArgs(System.Windows.Input.Mouse.PrimaryDevice, 0,
                System.Windows.Input.MouseButton.Left) { RoutedEvent = System.Windows.Controls.Control.MouseDoubleClickEvent });
            Func<string, System.Windows.Controls.Button> button = action => Find<System.Windows.Controls.Button>(panel, "Goal " + action);
            var status = Find<System.Windows.Controls.TextBlock>(panel, "Goal control status");
            open(); Until(() => button("pause").Visibility == Visibility.Visible);
            Check(status.Text.Contains("isolated") && status.Text.Contains("holder held") && state.Detail.Contains("retained-evidence"),
                "Goal detail shows environment liveness and canonical evidence before enabling controls");
            var confirmations = 0;
            var confirm = panel.GetType().GetField("ConfirmGoal", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            confirm.SetValue(panel, new Func<string, bool>(message => { ++confirmations; return false; }));
            button("pause").RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent)); Pump();
            Check(confirmations == 1 && !System.IO.File.Exists(path + ".writes") && status.Text.Contains("Status: active"),
                "cancelled native confirmation performs no write or optimistic status change");
            confirm.SetValue(panel, new Func<string, bool>(message => { ++confirmations; return true; }));
            foreach (var action in new[] { "pause", "resume", "achieve", "reopen", "kill", "reopen" })
            {
                button(action).RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
                var expected = action == "pause" ? "paused" : action == "achieve" ? "achieved" : action == "kill" ? "killed" : "active";
                Until(() => status.Text.Contains("Status: " + expected) && !status.Text.Contains("Checking"));
                Check(state.Detail.Contains("retained-evidence") && status.Text.Contains("Status: " + expected),
                    "native Goal " + action + " reads back confirmed status and evidence" + (action == "reopen" ? " " + confirmations : ""));
            }
            Check(confirmations == 7 && System.IO.File.ReadAllLines(path + ".writes").Length == 6,
                "every accepted native Goal transition requires confirmation and exactly one write");
            Check(status.Text.Contains("incomplete") && status.Text.Contains("unattributed activity remains"),
                "degraded Goal success remains visible alongside confirmed server status");
            var before = state.Detail;
            System.IO.File.WriteAllText(path + ".deny", "deny");
            button("pause").RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
            Until(() => status.Text.Contains("Unavailable"));
            Check(state.Detail == before && status.Text.Contains("Status: active"), "failed native Goal write preserves the last confirmed detail");
            Check(new[] { "pause", "resume", "start", "reopen", "achieve", "kill" }.All(action => button(action).Visibility != Visibility.Visible || !button(action).IsEnabled),
                "failed native Goal action disables controls until refreshed");
            System.IO.File.Delete(path + ".deny"); System.IO.File.WriteAllText(path + ".unknown", "unknown");
            open(); Until(() => status.Text.Contains("holder unknown"));
            Check(new[] { "pause", "start", "achieve", "kill" }.All(action => button(action).Visibility != Visibility.Visible),
                "unknown Goal holder liveness never becomes permission to start or mutate");
            System.IO.File.Delete(path + ".unknown"); System.IO.File.WriteAllText(path + ".dormant", "dormant");
            open(); Until(() => button("start").Visibility == Visibility.Visible);
            button("start").RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
            Until(() => status.Text.Contains("holder held"));
            Check(System.IO.File.ReadAllLines(path + ".writes").Last() == "start", "holderless native Start follows the composed activation seam");
            host.Toggle("goals"); host.Toggle("goals"); Pump();
            Check(host.Panel("goals") == panel, "Goals controls retain the same resident native panel across toggles");
        }
    }
    private static string InboxQuestion = "{\"id\":\"question +/=& \\u03bb\",\"kind\":\"question\",\"title\":\"Alpha literal question\",\"body\":\"Question body\",\"contextMarkdown\":\"Exact context\",\"ref\":{\"kind\":\"coord-escalation\",\"conversationId\":\"thread-a\",\"options\":[{\"id\":\"yes\",\"label\":\"Yes\"}]},\"actions\":[{\"id\":\"resolve\"}]}";
    private static string InboxReview = "{\"runId\":\"run-1\",\"itemId\":\"question +/=& \\u03bb\",\"kind\":\"question\",\"title\":\"Review Alpha\",\"ref\":{\"kind\":\"coord-escalation\",\"conversationId\":\"thread-a\"},\"outcome\":\"recommended\",\"actionId\":\"answer\",\"draftAnswer\":\"draft\",\"recommendation\":{\"kind\":\"recommended\"}}";
    private static InboxState InboxLoaded()
    {
        var state = new InboxState(); var token = state.Begin();
        state.SettleList(token, Envelope("{\"items\":[" + InboxQuestion + "]}"));
        state.SettleBulk(token, Envelope("{\"run\":null,\"items\":[]}")); return state;
    }
    private static void InboxModel()
    {
        var environment = Json(EnvironmentJson); var state = InboxLoaded(); var id = "question +/=& \u03bb";
        Check(state.ListReady && state.BulkReady && state.Results("Alpha literal").Count == 1, "Inbox reads and filters canonical attention groups");
        var frozen = state.Request("start", environment, "Alpha");
        ((Dictionary<string, object>)state.Rows[0]["ref"])["conversationId"] = "changed";
        Check(new JavaScriptSerializer().Serialize(frozen).Contains("thread-a"), "visible batch freezes nested references before confirmation");
        state = InboxLoaded(); var token = state.Select(id);
        state.SettleContext(token, id, Envelope(InboxQuestion));
        Check(state.Context != null && InboxState.Actions(state.Context).Single()["id"].Equals("yes"), "context uses exact question identity and offered escalation option");
        Check(!state.SettleContext(token - 1, id, Envelope(InboxQuestion)), "late context generation is rejected");
        state.SettleContext(token, id, Envelope(InboxQuestion.Replace("thread-a", "thread-b")));
        Check(state.Context == null && state.ContextError != null, "changed reference cannot resolve a recycled question identity");
        token = state.Select(id); state.SettleContext(token, id, Envelope(InboxQuestion));
        Refuses(() => state.Request("resolve", environment, actionId: "unoffered"), "manual resolution refuses unoffered actions");
        var request = state.Request("resolve", environment, actionId: "yes");
        var action = state.BeginAction(new[] { request });
        Refuses(() => state.Request("resolve", environment, actionId: "yes"), "pending action suppresses duplicate invocation");
        var receipt = Envelope("{\"ok\":true,\"resolved\":true,\"recorded\":false,\"itemId\":\"question +/=& \\u03bb\"}"); receipt["environment"] = environment;
        Refuses(() => state.RecordAction(action, request, receipt), "unrecorded terminal effect is surfaced for reconciliation");
        state.FinishAction(action);
        Check(state.Applied.Contains(id), "confirmed terminal effect cannot repeat when bookkeeping fails");
        Refuses(() => state.Request("resolve", environment, actionId: "yes"), "locally confirmed question cannot be applied twice");
        state = InboxLoaded();
        var bulk = Envelope("{\"run\":{\"runId\":\"run-1\",\"phase\":\"review\",\"totalItems\":5},\"items\":[" + InboxReview + "," + InboxReview.Replace("question +/=& \\u03bb", "owner-only").Replace("recommended\\\"}", "owner_action\\\"}") + "]}");
        // Explicit manual disposition is never an applicable recommendation.
        var items = (System.Collections.IList)((Dictionary<string, object>)((System.Collections.IList)bulk["rows"])[0])["items"];
        ((Dictionary<string, object>)((Dictionary<string, object>)items[1])["recommendation"])["kind"] = "owner_action";
        state.SettleBulk(state.Generation, bulk, "run-1");
        Check(state.BulkReady && state.CanSelect(id) && !state.CanSelect("owner-only"), "owner action stays outside Apply selected");
        var counts = InboxState.Counts(state.Run, state.Items);
        Check(counts["total"] == 5 && counts["decided"] == 2 && counts["percent"] == 40 && counts["left"] == 3, "partial delivery uses persisted total as the progress denominator");
        state.SelectedReviews.Add(id); state.Drafts[id] = "edited \u03bb";
        request = state.Request("apply", environment, itemId:id);
        Check(request["answer"].Equals("edited \u03bb") && request["runId"].Equals("run-1"), "Apply freezes the edited draft and saved run identity");
        Refuses(() => state.Request("apply", environment, itemId:"owner-only"), "owner-only row cannot enter a bulk apply request");
        action = state.BeginAction(new[] { request }); var other = Json(EnvironmentJson); other["workspaceId"] = "other";
        receipt["environment"] = other;
        Refuses(() => state.RecordAction(action, request, receipt), "action receipt from another workspace is rejected");
        Check(!state.SettleLiveBulk(state.Generation, "run-1", bulk), "live saved run refresh cannot overwrite a pending action"); state.FinishAction(action);
        Check(!state.SettleLiveBulk(state.Generation, "different", bulk), "live refresh cannot replace the selected saved run");
        var duplicate = new List<Dictionary<string, object>> { state.Items[0], state.Items[0] };
        Refuses(() => InboxState.Counts(state.Run, duplicate), "duplicate bulk identities fail closed");
        state.Run["phase"] = "complete"; state.Items[0]["outcome"] = "failed";
        request = state.Request("resume", environment);
        Check(((System.Collections.IList)request["itemIds"]).Count == 1, "resume submits only retryable saved item identities");
        Refuses(() => state.Request("stop", environment), "stop refuses a terminal run");
        state.Run["phase"] = "running"; Check(state.Request("stop", environment)["runId"].Equals("run-1"), "stop targets the exact active saved run");
        Refuses(() => state.Request("start", environment), "active saved run prevents a second batch");
        state = InboxLoaded(); token = state.Select(id); state.SettleContext(token, id, Envelope(InboxQuestion)); state.RetainVisibleSelection("no match");
        Check(state.Selection == null && state.Context == null && !state.SettleContext(token, id, Envelope(InboxQuestion)), "filtering out a question dismisses context and fences its late response");
        var partial = Envelope("{\"run\":null,\"items\":[]}"); partial["partial"] = true; state.SettleBulk(state.Generation, partial);
        Check(!state.BulkReady && state.BulkError != null, "incomplete canonical run blocks actions");
        state.SettleList(state.Generation, Envelope("{\"items\":[" + InboxQuestion + "," + InboxQuestion.Replace("thread-a", "thread-b") + "]}"));
        Check(!state.ListReady && state.ListError != null, "conflicting attention identities are surfaced instead of silently merged");
    }
    private static void InboxNative()
    {
        var path = Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_STATE");
        using (var host = new WorkbenchHost(Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_FIXTURE")))
        {
            host.Toggle("inbox"); var panel = host.Panel("inbox");
            var status = Find<System.Windows.Controls.TextBlock>(panel, "Workbench status");
            Until(() => status.Text.Contains("2 questions") && status.Text.Contains("No saved bulk run"));
            Check(panel.IsVisible && status.Text.Contains("fixture.invalid:3170"), "native Inbox renders canonical attention and selected environment");
            var search = Find<System.Windows.Controls.TextBox>(panel, "Search Workbench"); search.Text = "Alpha";
            Find<System.Windows.Controls.Button>(panel, "Inbox start").RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
            var confirm = Find<System.Windows.Controls.Button>(panel, "Inbox confirm action");
            Check(confirm != null && !System.IO.File.Exists(path + ".writes"), "native visible batch waits for explicit confirmation without writes");
            search.Text = "Beta"; Check(Find<System.Windows.Controls.Button>(panel, "Inbox confirm action") == null, "query edit cancels a frozen batch confirmation");
            search.Text = "Alpha";
            Find<System.Windows.Controls.Button>(panel, "Inbox question question +/=& \u03bb").RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
            Until(() => Find<System.Windows.Controls.Button>(panel, "Inbox resolve yes") != null);
            Check(Find<System.Windows.Controls.TextBox>(panel, "Answer selected question") != null, "native question context exposes offered actions and answer control");
            Find<System.Windows.Controls.Button>(panel, "Inbox resolve yes").RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
            Check(!System.IO.File.Exists(path + ".writes"), "manual offered action also waits for confirmation");
            Find<System.Windows.Controls.Button>(panel, "Inbox cancel action").RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
            Find<System.Windows.Controls.Button>(panel, "Inbox start").RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
            Find<System.Windows.Controls.Button>(panel, "Inbox confirm action").RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
            Until(() => status.Text.Contains("run-1") && status.Text.Contains("review"));
            var written = System.IO.File.ReadAllLines(path + ".writes"); var start = Json(written[0]);
            Check(written.Length == 1 && ((System.Collections.IList)start["items"]).Count == 1, "confirmed batch submits exactly the one filtered visible question");
            var pick = Find<System.Windows.Controls.CheckBox>(panel, "Inbox review question +/=& \u03bb");
            Check(pick != null && pick.IsEnabled && status.Text.Contains("1/1 decided"), "saved run polling renders authoritative review progress");
            pick.IsChecked = true; pick.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Primitives.ButtonBase.ClickEvent));
            var draft = Find<System.Windows.Controls.TextBox>(panel, "Inbox draft question +/=& \u03bb"); draft.Text = "edited native answer \u03bb";
            Pump(); Check(Find<System.Windows.Controls.TextBox>(panel, "Inbox draft question +/=& \u03bb") == draft && draft.Text.Contains("edited"), "saved run refresh preserves the live draft control and edited text");
            Find<System.Windows.Controls.Button>(panel, "Inbox apply").RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
            Check(System.IO.File.ReadAllLines(path + ".writes").Length == 1, "selected recommendation is never auto-applied");
            Find<System.Windows.Controls.Button>(panel, "Inbox confirm action").RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
            Until(() => status.Text.Contains("1 resolved") && status.Text.Contains("complete"));
            written = System.IO.File.ReadAllLines(path + ".writes"); var apply = Json(written[1]);
            Check(written.Length == 2 && apply["answer"].Equals("edited native answer \u03bb") && ((Dictionary<string, object>)apply["expected"])["id"].Equals("question +/=& \u03bb"), "native Apply sends the exact selected identity and edited Unicode draft");
            host.State("inbox").Pinned = true; host.Toggle("goals"); Pump();
            var goals = host.Panel("goals");
            Check(panel.IsVisible && goals.IsVisible && !new Rect(panel.Left, panel.Top, panel.Width, panel.Height).IntersectsWith(new Rect(goals.Left, goals.Top, goals.Width, goals.Height)), "Inbox pins alongside independent panels within separate native slots");
            host.Toggle("goals"); host.Toggle("inbox"); host.Toggle("inbox"); Pump();
            Check(host.Panel("inbox") == panel && search.Text == "Alpha", "native Inbox retains its resident HWND and query across toggles");
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
        if (phase == "goals") { GoalsNative(); }
        if (phase == "inbox") { InboxModel(); InboxNative(); }
        if (phase == "operator") { OperatorNative(); }
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
    if ($Phase -in @('accounts', 'goals', 'inbox')) {
        $env:WORKBENCH_ACCOUNT_FIXTURE = $accountFixture; $env:WORKBENCH_ACCOUNT_STATE = $accountState
        $env:WORKBENCH_CONTROL_PHASE = $Phase
        Add-Type -OutputAssembly $accountFixture -OutputType ConsoleApplication -ReferencedAssemblies System.Web.Extensions, System.Core -TypeDefinition @'
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
public static class NativeAccountsFixture {
    private static int Inbox(string[] args, Dictionary<string, object> request, JavaScriptSerializer json, UTF8Encoding utf8, string path, object environment) {
        const string question = "{\"id\":\"question +/=& \\u03bb\",\"kind\":\"question\",\"title\":\"Alpha literal question\",\"body\":\"Question body\",\"contextMarkdown\":\"Exact context\",\"ref\":{\"kind\":\"coord-escalation\",\"conversationId\":\"thread-a\",\"options\":[{\"id\":\"yes\",\"label\":\"Yes\"}]},\"actions\":[{\"id\":\"resolve\"}]}";
        const string review = "{\"runId\":\"run-1\",\"itemId\":\"question +/=& \\u03bb\",\"kind\":\"question\",\"title\":\"Review Alpha\",\"ref\":{\"kind\":\"coord-escalation\",\"conversationId\":\"thread-a\"},\"outcome\":\"recommended\",\"actionId\":\"answer\",\"draftAnswer\":\"draft\",\"recommendation\":{\"kind\":\"recommended\"}}";
        var current = json.Deserialize<Dictionary<string, object>>(File.Exists(path) ? File.ReadAllText(path) : "{\"run\":null,\"items\":[]}");
        object[] rows;
        if (args.Length != 1) return 40;
        if (args[0] == "native-inbox") {
            if (File.Exists(path + ".deny")) { Console.Error.Write("isolated Inbox action denied"); return 7; }
            if (json.Serialize(request["environment"]) != json.Serialize(environment) || !Object.Equals(request["confirmed"], true)) return 41;
            var operation = (string)request["operation"];
            var receipt = new Dictionary<string, object> { { "ok", true }, { "recorded", true } };
            if (operation == "start") {
                var batch = (IList)request["items"];
                if (batch.Count != 1 || !Object.Equals(((Dictionary<string, object>)batch[0])["itemId"], "question +/=& \u03bb")) return 42;
                current = json.Deserialize<Dictionary<string, object>>("{\"run\":{\"runId\":\"run-1\",\"phase\":\"running\",\"totalItems\":1},\"items\":[" + review.Replace("recommended", "pending") + "]}");
                receipt["runId"] = "run-1";
            } else if (operation == "apply" || operation == "resolve") {
                var expected = (Dictionary<string, object>)request["expected"];
                if (!Object.Equals(expected["id"], "question +/=& \u03bb")) return 43;
                if (operation == "apply") {
                    if (!Object.Equals(request["runId"], "run-1") || !Object.Equals(request["actionId"], "answer")) return 44;
                    current = json.Deserialize<Dictionary<string, object>>("{\"run\":{\"runId\":\"run-1\",\"phase\":\"complete\",\"totalItems\":1},\"items\":[" + review.Replace("recommended", "auto_resolved") + "]}");
                } else if (!Object.Equals(request["actionId"], "yes")) return 45;
                receipt["resolved"] = true; receipt["itemId"] = "question +/=& \u03bb";
            } else if (operation == "stop" || operation == "resume") {
                if (!Object.Equals(request["runId"], "run-1") || current["run"] == null) return 46;
                ((Dictionary<string, object>)current["run"])["phase"] = operation == "stop" ? "complete" : "running";
            } else return 47;
            File.WriteAllText(path, json.Serialize(current)); File.AppendAllText(path + ".writes", json.Serialize(request) + "\n"); rows = new object[] { receipt };
        } else if (args[0] == "native-read") {
            var name = (string)request["name"];
            if (name != "operator.identity" && (!request.ContainsKey("environment") || json.Serialize(request["environment"]) != json.Serialize(environment))) return 48;
            if (name == "operator.identity") rows = new object[] { environment };
            else if (name == "plans.attention") rows = new object[] { new { items = new object[] {
                json.DeserializeObject(question), json.DeserializeObject(question.Replace("question +/=& \\u03bb", "question-b").Replace("Alpha", "Beta").Replace("thread-a", "thread-b")) } } };
            else if (name == "plans.attentionItem") {
                var query = (Dictionary<string, object>)request["args"];
                if (!Object.Equals(query["itemId"], "question +/=& \u03bb")) return 49;
                rows = new object[] { json.DeserializeObject(question) };
            } else if (name == "plans.attentionBulkRun") {
                rows = new object[] { current };
                var run = current["run"] as Dictionary<string, object>;
                if (run != null && Object.Equals(run["phase"], "running")) {
                    // Return a real intermediate snapshot; the next one-second
                    // refresh must observe review from the persisted fixture.
                    File.WriteAllText(path, "{\"run\":{\"runId\":\"run-1\",\"phase\":\"review\",\"totalItems\":1},\"items\":[" + review + "]}");
                }
            } else if (name == "goals.list") rows = new object[] { new { goals = new object[0] } };
            else return 50;
        } else return 51;
        var bytes = utf8.GetBytes(json.Serialize(new { rows = rows, environment = environment })); Console.OpenStandardOutput().Write(bytes, 0, bytes.Length); return 0;
    }
    private static int Goals(string[] args, Dictionary<string, object> request, JavaScriptSerializer json, UTF8Encoding utf8, string path, object environment) {
        var state = json.Deserialize<Dictionary<string, object>>(File.Exists(path) ? File.ReadAllText(path) :
            "{\"goal\":{\"id\":\"literal +/=& \\u03bb\",\"title\":\"Same goal\",\"status\":\"active\"},\"effectiveStatus\":\"active\",\"holderLiveness\":\"held\",\"evidence\":[\"retained-evidence\"]}");
        var goal = (Dictionary<string, object>)state["goal"]; object rows;
        var result = new Dictionary<string, object>();
        if (args.Length != 1) return 30;
        if (args[0] == "native-goal") {
            if (File.Exists(path + ".deny")) { Console.Error.Write("isolated goal write denied"); return 7; }
            if (json.Serialize(request["environment"]) != json.Serialize(environment) || !Object.Equals(request["confirmed"], true) ||
                !Object.Equals(request["goalId"], goal["id"]) || !Object.Equals(request["expectedStatus"], goal["status"])) return 31;
            var action = (string)request["action"];
            goal["status"] = action == "pause" ? "paused" : action == "achieve" ? "achieved" : action == "kill" ? "killed" : "active";
            state["effectiveStatus"] = goal["status"]; state["holderLiveness"] = "held";
            File.WriteAllText(path, json.Serialize(state)); File.AppendAllText(path + ".writes", action + "\n"); File.Delete(path + ".dormant");
            rows = new object[] { state }; result["environment"] = environment;
            result["degraded"] = true; result["degradedReasons"] = new[] { "unattributed activity remains" };
        } else if (args[0] == "native-read") {
            var name = (string)request["name"];
            if (name == "goals.detail") {
                var query = (Dictionary<string, object>)request["args"];
                if (!Object.Equals(query["goalId"], goal["id"]) || !Object.Equals(query["workspaceId"], "isolated")) return 32;
            }
            if (File.Exists(path + ".unknown")) state["holderLiveness"] = "unknown";
            if (File.Exists(path + ".dormant")) { state["holderLiveness"] = "lost"; state["effectiveStatus"] = "dormant"; }
            rows = name == "operator.identity" ? new object[] { environment } : name == "goals.list" ? new object[] { new { goals = new object[] { goal } } } : new object[] { state };
        } else return 33;
        result["rows"] = rows;
        var bytes = utf8.GetBytes(json.Serialize(result)); Console.OpenStandardOutput().Write(bytes, 0, bytes.Length); return 0;
    }
    public static int Main(string[] args) {
        var json = new JavaScriptSerializer(); var utf8 = new UTF8Encoding(false, true);
        var request = json.Deserialize<Dictionary<string, object>>(new StreamReader(Console.OpenStandardInput(), utf8).ReadToEnd());
        var path = Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_STATE");
        var environment = json.DeserializeObject("{\"endpoint\":\"http://fixture.invalid:3170\",\"workspaceId\":\"isolated\",\"store\":{\"id\":\"fixture\"},\"agentChat\":{\"scope\":\"workspace:isolated\"}}");
        if (Environment.GetEnvironmentVariable("WORKBENCH_CONTROL_PHASE") == "goals") return Goals(args, request, json, utf8, path, environment);
        if (Environment.GetEnvironmentVariable("WORKBENCH_CONTROL_PHASE") == "inbox") return Inbox(args, request, json, utf8, path, environment);
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
    foreach ($path in @($accountFixture, $accountState, ($accountState + '.deny'), ($accountState + '.writes'), ($accountState + '.unknown'), ($accountState + '.dormant'))) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    Remove-Item Env:WORKBENCH_ACCOUNT_FIXTURE, Env:WORKBENCH_ACCOUNT_STATE, Env:WORKBENCH_CONTROL_PHASE -ErrorAction SilentlyContinue
}
