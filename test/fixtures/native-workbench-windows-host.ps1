param(
    [Parameter(Mandatory=$true)][string]$SourceDirectory,
    [ValidateSet('all', 'compile', 'preflight', 'model', 'hotkeys', 'windows', 'lifecycle', 'accounts', 'goals', 'inbox', 'organizer', 'chat', 'content', 'cards', 'voice', 'operator', 'operator-inbox', 'environment-refusal', 'fixture-diagnostics', 'fixture-failure', 'fixture-timeout')][string]$Phase = 'all',
    [string]$PuiExecutable,
    [string]$OperatorUrl,
    [string]$ExpectedWorkspace,
    [string]$ExpectedPlan,
    [string]$ExpectedGoal,
    [switch]$Interactive,
    [switch]$BudgetOnly
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw 'Native WPF fixture requires -STA' }
foreach ($source in @('PuiReadBridge.cs', 'WorkbenchModel.cs', 'WorkbenchHost.cs')) {
    if (-not [IO.File]::Exists((Join-Path $SourceDirectory $source))) { throw "Missing native fixture source: $source" }
}
if ($Phase -eq 'lifecycle') {
    $budget = & (Join-Path $PSScriptRoot 'native-workbench-windows-lifecycle.ps1') -SourceDirectory $SourceDirectory -BudgetOnly | ConvertFrom-Json
} elseif ($Phase -eq 'fixture-diagnostics') {
    $children = @([pscustomobject]@{phase='fixture-failure';clientTimeoutMs=45000},
        [pscustomobject]@{phase='fixture-timeout';clientTimeoutMs=22000})
    $milliseconds = ($children | Measure-Object -Property clientTimeoutMs -Sum).Sum + 10000
    $budget = [pscustomobject]@{ fixtureTimeoutMs=$milliseconds; clientTimeoutMs=($milliseconds + 10000); children=$children }
} else {
    $milliseconds = if ($Phase -in @('operator', 'operator-inbox')) { 90000 } elseif ($Phase -eq 'fixture-timeout') { 12000 } else { 35000 }
    $budget = [pscustomobject]@{ fixtureTimeoutMs=$milliseconds; clientTimeoutMs=($milliseconds + 10000) }
}
if ($BudgetOnly) { $budget | ConvertTo-Json -Compress; return }
function Restore-FixtureRegistration($Context, $PriorCommand, [string]$ScriptPath) {
    # A killed fixture cannot execute its finally block. Remove only a value
    # absent before this run and still pointing at this exact test controller.
    if ($null -eq $PriorCommand) { Remove-WorkbenchRegistration $Context (Get-Item -LiteralPath $ScriptPath).FullName }
}
if ($Phase -eq 'fixture-diagnostics') {
    Import-Module (Join-Path $SourceDirectory 'WorkbenchLifecycle.psm1') -Force
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
        foreach ($childBudget in $budget.children) {
            $diagnosticPhase = $childBudget.phase
            [Console]::Error.WriteLine('PHASE diagnostics begin ' + $diagnosticPhase)
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
            if (-not $process.WaitForExit($childBudget.clientTimeoutMs)) { throw ('Diagnostic wrapper exceeded its composed child budget: ' + $diagnosticPhase) }
            [Console]::Error.WriteLine('PHASE diagnostics completed ' + $diagnosticPhase)
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
        $context = New-WorkbenchContext (Join-Path $directory 'registration') ('HKCU:\Software\Papercusp\Fixture-' + [Guid]::NewGuid().ToString('N'))
        [void](New-Item -Path $context.RunKey -Force)
        $controller = (Get-Item -LiteralPath (Join-Path $SourceDirectory 'workbench.ps1')).FullName
        $expected = Get-WorkbenchLoginCommand $controller
        try {
            [void](New-ItemProperty -Path $context.RunKey -Name $context.RunName -Value $expected -PropertyType String)
            Restore-FixtureRegistration $context $expected $controller
            Check ((Get-ItemProperty -Path $context.RunKey).($context.RunName) -eq $expected) 'failed fixture preserves a pre-existing registration'
            Set-ItemProperty -Path $context.RunKey -Name $context.RunName -Value 'another installation'
            Restore-FixtureRegistration $context $null $controller
            Check ((Get-ItemProperty -Path $context.RunKey).($context.RunName) -eq 'another installation') 'failed fixture preserves a replacement registration'
            [void](New-ItemProperty -Path $context.RunKey -Name 'unrelated' -Value 'keep' -PropertyType String)
            Set-ItemProperty -Path $context.RunKey -Name $context.RunName -Value $expected
            Restore-FixtureRegistration $context $null $controller.Replace('\', '/')
            Check (-not (Get-Item -Path $context.RunKey).GetValueNames().Contains($context.RunName)) 'failed fixture removes its exact orphan registration across path separators'
            Check ((Get-ItemProperty -Path $context.RunKey).unrelated -eq 'keep') 'failed fixture cleanup preserves unrelated login values'
        } finally { Remove-Item -LiteralPath $context.RunKey -Recurse -Force }
        @{ok=$true; platform='windows'; phase=$Phase; count=$cases.Count; cases=$cases.ToArray()} | ConvertTo-Json -Depth 4 -Compress
    } finally {
        $env:PAPERCUSP_NATIVE_EVIDENCE_DIR = $priorEvidence
        if ($cases.Count -eq 19) { Remove-Item -LiteralPath $directory -Recurse -Force }
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
    $lifecycleContext = $null; $priorRunCommand = $null
    if ($Phase -eq 'lifecycle') {
        Import-Module (Join-Path $SourceDirectory 'WorkbenchLifecycle.psm1') -Force
        $lifecycleContext = New-WorkbenchContext (Join-Path $directory 'registration-custody')
        $priorEntry = Get-ItemProperty -Path $lifecycleContext.RunKey -Name $lifecycleContext.RunName -ErrorAction SilentlyContinue
        if ($null -ne $priorEntry) { $priorRunCommand = $priorEntry.($lifecycleContext.RunName) }
    }
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $receipt = Join-Path $directory 'exit.json'
    $stdout = Join-Path $directory 'stdout.txt'
    $stderr = Join-Path $directory 'stderr.txt'
    $fixtureCommand = "$" + "ProgressPreference='SilentlyContinue'; " + '$env:PAPERCUSP_NATIVE_FIXTURE_PROGRESS=' +
        "'" + (Join-Path $directory 'progress.log').Replace("'", "''") + "'; & '" + $PSCommandPath.Replace("'", "''") + "' -SourceDirectory '" +
        $SourceDirectory.Replace("'", "''") + "' -Phase '" + $Phase + "'"
    if ($Phase -in @('operator', 'operator-inbox')) {
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
        $deadline = [DateTime]::UtcNow.AddMilliseconds($budget.fixtureTimeoutMs)
        while (-not [IO.File]::Exists($receipt) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
        if (-not [IO.File]::Exists($receipt)) { throw ('Interactive ' + $Phase + ' fixture exceeded its ' + $budget.fixtureTimeoutMs + 'ms phase budget; inspect retained progress and child identity') }
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
        if (-not $completed -and $null -ne $lifecycleContext) {
            Restore-FixtureRegistration $lifecycleContext $priorRunCommand (Join-Path $SourceDirectory 'workbench.ps1')
        }
        if ($completed -and -not $env:PAPERCUSP_NATIVE_EVIDENCE_DIR) {
            Remove-Item -LiteralPath $directory -Recurse -Force
        } else {
            $diagnostic = @{ ok=$completed; phase=$Phase; budget=$budget; startedAt=$startedAt; finishedAt=[DateTime]::UtcNow.ToString('o');
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
if ($Phase -in @('operator', 'operator-inbox')) {
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
. (Join-Path $SourceDirectory 'WorkbenchDependencies.ps1')
$references = @('System.dll','System.Core.dll','System.Xaml.dll','System.Web.Extensions.dll',
    [Windows.Window].Assembly.Location, [Windows.Media.Brushes].Assembly.Location,
    [Windows.Threading.Dispatcher].Assembly.Location, [Windows.Automation.AutomationProperties].Assembly.Location) + @(Import-WorkbenchDependencies $SourceDirectory)
$fixture = @'
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
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
    private static readonly List<object> organizerRuns = new List<object>();
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
    private const string EnvironmentRefusal = "Error: selected environment changed; refresh the native panel";
    private const string InboxEnvironmentRefusal = "Error: selected environment changed; refresh Inbox";
    private static void RefusesPuiEnvironment(Action action, string name, string expectedMessage = EnvironmentRefusal)
    {
        var refused = false;
        try { action(); }
        catch (System.IO.IOException error)
        {
            if (!String.Equals(error.Message, expectedMessage, StringComparison.Ordinal)) throw;
            refused = true;
        }
        Check(refused, name);
    }
    private static void EnvironmentRefusalOracle()
    {
        RefusesPuiEnvironment(() => { throw new System.IO.IOException(EnvironmentRefusal); },
            "native PUI environment refusal is recognized through its process error");
        RefusesPuiEnvironment(() => { throw new System.IO.IOException(InboxEnvironmentRefusal); },
            "native Inbox environment refusal is recognized through its command-specific process error", InboxEnvironmentRefusal);
        var rejected = false;
        try { RefusesPuiEnvironment(() => { throw new System.IO.IOException(InboxEnvironmentRefusal); }, "wrong read refusal"); }
        catch (System.IO.IOException error) { rejected = error.Message == InboxEnvironmentRefusal; }
        Check(rejected, "an Inbox command refusal cannot satisfy the native read refusal oracle");
        rejected = false;
        try { RefusesPuiEnvironment(() => { throw new System.IO.IOException(EnvironmentRefusal); }, "wrong Inbox refusal", InboxEnvironmentRefusal); }
        catch (System.IO.IOException error) { rejected = error.Message == EnvironmentRefusal; }
        Check(rejected, "a native read refusal cannot satisfy the Inbox command refusal oracle");
        rejected = false;
        try { RefusesPuiEnvironment(() => {}, "unexpected success"); }
        catch (Exception error) { rejected = error.Message == "unexpected success"; }
        Check(rejected, "a successful changed-environment call cannot satisfy the refusal oracle");
        rejected = false;
        try { RefusesPuiEnvironment(() => { throw new System.IO.IOException("connection refused"); }, "wrong failure"); }
        catch (System.IO.IOException error) { rejected = error.Message == "connection refused"; }
        Check(rejected, "an unrelated process error cannot satisfy the environment refusal oracle");
        rejected = false;
        try { RefusesPuiEnvironment(() => { throw new TimeoutException("operator timed out"); }, "wrong exception"); }
        catch (TimeoutException) { rejected = true; }
        Check(rejected, "a timeout cannot satisfy the environment refusal oracle");
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
    private static PanelResult OrganizerAgent(int id, string host, string harness = "one")
    {
        return Agent(new JavaScriptSerializer().Serialize(new { advSessionId = id, ownerId = "owner-" + id,
            host = host, sessionState = "live", currentPlanSlug = "same", potSlug = harness, fleetSlug = "fleet",
            windowId = "0x" + id.ToString("x") }));
    }
    private static OrganizerWindow OrganizerTerminal(int id, string desktop, int monitor)
    { return new OrganizerWindow { Handle = new IntPtr(id), Title = "Terminal [adv:" + id + "]", Desktop = desktop,
        Monitor = new IntPtr(monitor), Area = new OrganizerRect { X = monitor * 1000, Y = 0, Width = 1000, Height = 800 } }; }
    private static List<OrganizerReceipt> Arrange(OrganizerGroup group, Dictionary<string, object> roster,
        IList<OrganizerWindow> windows, Func<OrganizerWindow, OrganizerRect, Task<OrganizerWindow>> place)
    { return OrganizerState.ArrangeAsync(group, roster, "desktop", windows, place).GetAwaiter().GetResult(); }
    private static void OrganizerModel()
    {
        var a = OrganizerAgent(101, "desktop"); var b = OrganizerAgent(102, "desktop");
        var other = OrganizerAgent(103, "desktop", "two"); var remote = OrganizerAgent(104, "remote");
        var ended = OrganizerAgent(105, "desktop"); ended.Row["sessionState"] = "ended";
        var missing = OrganizerAgent(106, "desktop");
        var agents = new[] { a, b, other, remote, ended, missing };
        var groups = OrganizerState.Groups(agents, "plan", new PanelResult[0]); var group = groups.Single(value => value.Harness == "one");
        Check(groups.Count == 2 && group.Rows.Count == 5, "Organizer qualifies identical plan slugs by their canonical harness");
        Check(OrganizerState.Groups(agents, "fleet", new PanelResult[0]).Single().Rows.Count == 6, "Organizer uses canonical fleet identity");
        var roster = Roster(agents);
        var goal = OrganizerState.Groups(agents, "goal", new[] { PanelState.Result("goals", Json("{\"id\":\"goal\",\"title\":\"Goal\"}")) }).Single();
        var links = Json("{\"rows\":[{\"goal\":{\"id\":\"goal\"},\"agents\":[],\"plans\":[{\"harnessSlug\":\"one\",\"planSlug\":\"same\"}],\"projects\":[\"two\"]}]}");
        Check(OrganizerState.Members(goal, roster, links).Count == 5, "Organizer goal links use the canonical plan rail rather than project membership");
        links = Json("{\"rows\":[{\"goal\":{\"id\":\"goal\"},\"agents\":[{\"ownerId\":\"owner-103\",\"live\":true},{\"ownerId\":\"owner-101\",\"live\":false}],\"plans\":[]}]}");
        Check(OrganizerState.Members(goal, roster, links).Single().Key == other.Key, "Organizer goal links include only canonical live holders");
        Refuses(() => OrganizerState.Members(goal, roster, Json("{\"rows\":[{\"goal\":{\"id\":\"changed\"},\"agents\":[],\"plans\":[]}]}")), "Organizer refuses a changed goal identity");
        var windows = new[] { OrganizerTerminal(101, "desktop-a", 1), OrganizerTerminal(102, "desktop-b", 2), OrganizerTerminal(103, "desktop-a", 1) };
        var moved = new List<IntPtr>();
        Func<OrganizerWindow, OrganizerRect, Task<OrganizerWindow>> place = (window, rect) => {
            moved.Add(window.Handle); return Task.FromResult(new OrganizerWindow { Desktop = window.Desktop, Monitor = window.Monitor, Bounds = rect }); };
        var receipts = Arrange(group, roster, windows, place);
        Check(String.Join(",", receipts.Select(row => row.Status)) == "moved,moved,unsupported,offline,failed", "Organizer preserves independent remote stale and missing terminal receipts");
        Check(moved.SequenceEqual(new[] { new IntPtr(101), new IntPtr(102) }), "Organizer leaves an unselected terminal in the same process unchanged");
        Check(receipts.Take(2).Select(row => row.Desktop).Distinct().Count() == 2, "Organizer preserves separate desktops rather than collecting windows on the active desktop");
        Check(receipts[0].Requested.X == 1012 && receipts[1].Requested.X == 2012 && receipts[0].Requested.Width == 976,
            "Organizer tiles within each existing monitor work area");
        Check(receipts.Take(2).All(row => row.Requested.Matches(row.Observed)), "Organizer keeps requested and observed native geometry in its receipts");
        moved.Clear(); var partial = Roster(agents); partial["partial"] = true;
        Refuses(() => Arrange(group, partial, windows, place), "Organizer refuses a partial roster before any mutation");
        Check(moved.Count == 0, "Organizer partial roster refusal moves no windows");
        partial = Roster(agents); ((Dictionary<string, object>)((object[])partial["rows"])[0])["degradedFields"] = new[] { "windowId" };
        Refuses(() => Arrange(group, partial, windows, place), "Organizer refuses degraded canonical window identity");
        var changed = OrganizerAgent(101, "desktop"); changed.Row["currentPlanSlug"] = "different";
        Check(Arrange(group, Roster(changed, b, other, remote, ended, missing), windows, place)[0].Status == "failed", "Organizer refuses a terminal that left the selected group");
        changed = OrganizerAgent(101, "desktop"); changed.Row["windowId"] = "0x777";
        Check(Arrange(group, Roster(changed, b, other, remote, ended, missing), windows, place)[0].Status == "failed", "Organizer refuses a replaced recorded window");
        var only = OrganizerState.Groups(new[] { a }, "plan", new PanelResult[0]).Single();
        Check(Arrange(only, Roster(a), windows, (window, rect) => Task.FromResult(new OrganizerWindow {
            Desktop = "changed", Monitor = window.Monitor, Bounds = rect })).Single().Status == "failed", "Organizer refuses a placement receipt on a different desktop");
        Check(Arrange(only, Roster(a), windows, (window, rect) => Task.FromResult(new OrganizerWindow {
            Desktop = window.Desktop, Monitor = window.Monitor, Bounds = new OrganizerRect() })).Single().Status == "failed", "Organizer cannot claim a moved terminal from an unchanged rectangle");
        var shared = OrganizerAgent(107, "desktop"); shared.Row["windowId"] = a.Row["windowId"];
        var sharedWindow = OrganizerTerminal(101, "desktop-a", 1); sharedWindow.Title = "Shared terminal";
        var sharedGroup = OrganizerState.Groups(new[] { a, shared }, "plan", new PanelResult[0]).Single(); moved.Clear();
        Check(Arrange(sharedGroup, Roster(a, shared), new[] { sharedWindow }, place).All(row => row.Status == "failed") && moved.Count == 0,
            "Organizer refuses multiple sessions sharing one exact native window");
    }
    private static void OrganizerNative()
    {
        var a = new Window { Title = "Organizer A [adv:201]", Width = 300, Height = 200, Left = 20, Top = 20 };
        var b = new Window { Title = "Organizer B [adv:202]", Width = 300, Height = 200, Left = 350, Top = 30 };
        var control = new Window { Title = "Unselected [adv:299]", Width = 300, Height = 200, Left = 40, Top = 250 };
        try
        {
            a.Show(); b.Show(); control.Show(); Pump();
            var ah = new WindowInteropHelper(a).Handle; var bh = new WindowInteropHelper(b).Handle;
            var before = WorkbenchHost.InspectOrganizerWindow(new WindowInteropHelper(control).Handle);
            var first = OrganizerAgent(201, Environment.MachineName); first.Row["windowId"] = "0x" + ah.ToInt64().ToString("x");
            var second = OrganizerAgent(202, Environment.MachineName); second.Row["windowId"] = "0x" + bh.ToInt64().ToString("x");
            var remote = OrganizerAgent(203, "remote-host"); var stale = OrganizerAgent(204, Environment.MachineName); stale.Row["stale"] = true;
            var missing = OrganizerAgent(205, Environment.MachineName);
            var path = Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_STATE");
            System.IO.File.WriteAllText(path, new JavaScriptSerializer().Serialize(Roster(first, second, remote, stale, missing)));
            Check(before.Unsupported == null && before.Desktop != null, "native Windows adapter observes the documented virtual desktop identity");
            using (var host = new WorkbenchHost(Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_FIXTURE")))
            {
                host.State("organizer").Pinned = true; host.Toggle("organizer"); var panel = host.Panel("organizer");
                Until(() => Find<System.Windows.Controls.Button>(panel, "Arrange one / same") != null);
                Check(panel.IsVisible && host.State("organizer").Visible, "Organizer summons a resident native WPF panel");
                var field = panel.GetType().GetField("organizerReceipts", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                Func<List<OrganizerReceipt>> receipts = () => (List<OrganizerReceipt>)field.GetValue(panel);
                Action<string> arrange = label => {
                    Find<System.Windows.Controls.Button>(panel, label).RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
                    Until(() => receipts() != null);
                    Check(String.Join(",", receipts().Select(row => row.Status)) == "moved,moved,unsupported,offline,failed", label + " reports exact placements and partial failures"); };
                Action<string> retain = label => organizerRuns.Add(new { group = label, receipts = receipts().ToArray() });
                arrange("Arrange one / same");
                retain("plan");
                Check(receipts().Take(2).All(row => row.Requested.Matches(row.Observed)), "native Windows placement is measured rather than inferred from SetWindowPos");
                var after = WorkbenchHost.InspectOrganizerWindow(before.Handle);
                Check(after.Desktop == before.Desktop && after.Monitor == before.Monitor && before.Bounds.Matches(after.Bounds), "native Organizer leaves an unselected same-process window unchanged");
                var grouping = Find<System.Windows.Controls.ComboBox>(panel, "Organizer grouping"); grouping.SelectedItem = "fleet";
                arrange("Arrange fleet"); retain("fleet"); grouping.SelectedItem = "goal";
                arrange("Arrange Goal"); retain("goal");
                Check(receipts().Take(2).All(row => row.Desktop == WorkbenchHost.InspectOrganizerWindow(row.SessionId == "201" ? ah : bh).Desktop), "native Organizer preserves the observed desktop for each window");
                var cancelled = WorkbenchHost.PlaceOrganizerWindowAsync(WorkbenchHost.InspectOrganizerWindow(ah), before.Bounds, () => false);
                Until(() => cancelled.IsCompleted);
                Check(cancelled.IsFaulted && cancelled.Exception.InnerException.Message.Contains("cancelled"), "native arrangement cancellation refuses mutation");
                var previous = WorkbenchHost.InspectOrganizerWindow(ah); var calls = 0;
                cancelled = WorkbenchHost.PlaceOrganizerWindowAsync(previous, before.Bounds, () => ++calls == 1);
                Until(() => cancelled.IsCompleted);
                Check(calls == 2 && cancelled.IsFaulted && previous.Bounds.Matches(WorkbenchHost.InspectOrganizerWindow(ah).Bounds),
                    "native late cancellation after restore prevents geometry mutation");
                calls = 0;
                cancelled = WorkbenchHost.PlaceOrganizerWindowAsync(previous, before.Bounds, () => { if (++calls == 2) a.Title = "Replaced terminal [adv:999]"; return true; });
                Until(() => cancelled.IsCompleted);
                Check(calls == 2 && cancelled.IsFaulted && previous.Bounds.Matches(WorkbenchHost.InspectOrganizerWindow(ah).Bounds),
                    "native late terminal identity replacement cannot move a recycled handle");
                a.Title = previous.Title;
                host.Toggle("organizer"); Check(!panel.IsVisible && !host.State("organizer").Visible, "Organizer dismisses independently and retains its native resident");
            }
        }
        finally { a.Close(); b.Close(); control.Close(); }
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
    private static void OperatorInboxNative()
    {
        var pui = Environment.GetEnvironmentVariable("WORKBENCH_REAL_PUI");
        var identity = InboxState.One(PuiReadBridge.ReadAsync(pui, "operator.identity", null, CancellationToken.None).GetAwaiter().GetResult());
        Check(PanelState.Text(identity, "workspaceId") == Environment.GetEnvironmentVariable("WORKBENCH_EXPECTED_WORKSPACE") &&
            PanelState.Text(identity, "endpoint").TrimEnd('/') == Environment.GetEnvironmentVariable("PUI_OPERATOR").TrimEnd('/'),
            "actual Inbox PUI selects the explicit operator workspace");
        using (var host = new WorkbenchHost(pui))
        {
            host.Toggle("inbox"); var panel = host.Panel("inbox");
            var inbox = (InboxState)panel.GetType().GetField("inbox",
                System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance).GetValue(panel);
            Until(() => (inbox.ListReady || inbox.ListError != null) && (inbox.BulkReady || inbox.BulkError != null), 30);
            Check(inbox.ListReady && inbox.ListError == null, "actual PUI loads canonical Inbox groups: " + inbox.ListError);
            Check(inbox.BulkReady && inbox.BulkError == null, "actual PUI restores the canonical saved run or explicit absence: " + inbox.BulkError);
            var status = Find<System.Windows.Controls.TextBlock>(panel, "Workbench status");
            var hwnd = new WindowInteropHelper(panel).Handle;
            Check(panel.IsVisible && hwnd != IntPtr.Zero && panel.WindowStyle == WindowStyle.None && !panel.ShowInTaskbar &&
                (Style(hwnd, -16) & 0xC00000) == 0, "actual Inbox renders in a chrome-free resident native HWND");
            Check(status.Text.Contains(PanelState.Text(identity, "endpoint")) && status.Text.Contains(PanelState.Text(identity, "workspaceId")),
                "actual Inbox displays the selected operator and workspace");
            var rows = inbox.Results("");
            Check(status.Text.StartsWith(rows.Count + " questions") && rows.All(row =>
                Find<System.Windows.Controls.Button>(panel, "Inbox question " + InboxState.Text(row, "id")) != null),
                "actual Inbox renders each canonical question identity and visible count");
            Check(new[] { "start", "stop", "resume", "apply" }.All(operation =>
                Find<System.Windows.Controls.Button>(panel, "Inbox " + operation) != null),
                "actual Inbox exposes the native batch and selected review controls");
            if (inbox.Run == null)
                Check(status.Text.Contains("No saved bulk run"), "actual Inbox distinguishes canonical saved-run absence from failure");
            else
            {
                var counts = InboxState.Counts(inbox.Run, inbox.Items);
                Check(status.Text.Contains("Run " + InboxState.Text(inbox.Run, "runId")) &&
                    status.Text.Contains(counts["decided"] + "/" + counts["total"] + " decided"),
                    "actual Inbox uses saved identity and item outcomes with the persisted total");
            }
            var wrong = new Dictionary<string, object>(identity);
            wrong["workspaceId"] = PanelState.Text(identity, "workspaceId") + "-not-selected";
            RefusesPuiEnvironment(() => PuiReadBridge.ReadAsync(pui, "plans.attention", null, CancellationToken.None, 22000, wrong)
                .GetAwaiter().GetResult(), "actual Inbox read refuses a changed selected workspace");
            var request = new Dictionary<string, object> { { "environment", wrong }, { "operation", "stop" },
                { "confirmed", true }, { "runId", "native-integration-must-never-write" } };
            RefusesPuiEnvironment(() => PuiReadBridge.InboxAsync(pui, request, CancellationToken.None).GetAwaiter().GetResult(),
                "actual native-inbox command refuses a changed workspace before run control", InboxEnvironmentRefusal);
            var search = Find<System.Windows.Controls.TextBox>(panel, "Search Workbench");
            search.Text = "native-integration-no-match-" + Guid.NewGuid().ToString("N");
            Check(inbox.Results(search.Text).Count == 0 && status.Text.StartsWith("0 questions"),
                "actual Inbox filters the canonical list without replacing its source");
            var query = search.Text;
            host.Toggle("inbox"); host.Toggle("inbox"); Pump();
            Check(host.Panel("inbox") == panel && new WindowInteropHelper(panel).Handle == hwnd && search.Text == query,
                "actual Inbox retains its native HWND and query across toggles");
        }
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
                RefusesPuiEnvironment(() => PuiReadBridge.ReadAsync(pui, "goals.detail", args, CancellationToken.None, 22000, wrongEnvironment)
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
    private static IEnumerable<T> Elements<T>(DependencyObject parent) where T : DependencyObject
    {
        if (parent is T) yield return (T)parent;
        foreach (var child in LogicalTreeHelper.GetChildren(parent).OfType<DependencyObject>())
            foreach (var found in Elements<T>(child)) yield return found;
    }
    private static void CardsNative()
    {
        const string a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        var path = Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_STATE"); var json = new JavaScriptSerializer();
        var rows = new List<Dictionary<string, object>>(); var version = 0;
        Action save = () => System.IO.File.WriteAllText(path + ".cards", json.Serialize(new { version = ++version, rows = rows }));
        Func<string, string, Dictionary<string, object>> row = (id, kind) => Json(json.Serialize(new {
            correlationId = id, conversationId = a, prompt = "Question " + id, createdAt = 1,
            presentation = new { kind = kind } }));
        foreach (var kind in new[] { "radio", "checkbox", "select", "text", "date", "slider" })
        {
            var value = row(kind, kind); var presentation = (Dictionary<string, object>)value["presentation"];
            if (new[] { "radio", "checkbox", "select" }.Contains(kind)) presentation["options"] = new[] {
                new { id = "one", label = "Same label", hint = "first", description = "First description" },
                new { id = "two", label = "Same label", hint = "second", description = "Second description" } };
            if (kind == "text") { presentation["multiline"] = true; presentation["placeholder"] = "Exact prose";
                value["approval"] = new { title = "Approval title", body = new[] { "Approval paragraph" }, question = "Approval question" };
                value["report"] = new { title = "Report title", plans = new[] { new { title = "Plan title", status = "active", summary = "Plan summary",
                    items = new[] { new { id = "P-001", text = "Report item", status = "done", @ref = "WI-123" } } } } };
                value["details"] = "Exact details"; }
            if (kind == "date") { presentation["min"] = "2026-11-01"; presentation["max"] = "2026-11-30"; }
            if (kind == "slider") { presentation["min"] = 2; presentation["max"] = 10; presentation["step"] = 2; }
            rows.Add(value);
        }
        var secret = row("secret", "text"); ((Dictionary<string, object>)secret["presentation"])["sensitive"] = true;
        ((Dictionary<string, object>)secret["presentation"])["link"] = "/api/ui/cards/secret/link"; rows.Add(secret);
        var decline = row("decline", "text"); rows.Add(decline);
        var cancel = row("cancel", "text"); cancel["allowDecline"] = false; rows.Add(cancel);
        var expired = row("expired", "text"); expired["timeoutMs"] = 1; rows.Add(expired);
        rows.Add(row("unknown", "future-kind")); rows.Add(row("denied", "text")); rows.Add(row("wrong", "text"));
        save();
        using (var host = new WorkbenchHost(Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_FIXTURE")))
        {
            host.State("papercup").Pinned = true; host.Toggle("papercup"); var panel = host.Panel("papercup");
            var cards = (NativeCardsState)panel.GetType().GetField("cards", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).GetValue(panel);
            var chat = (ChatState)panel.GetType().GetField("chat", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).GetValue(panel);
            Func<string, System.Windows.Controls.Button> button = name => Find<System.Windows.Controls.Button>(panel, "Papercup " + name);
            Action<string> click = name => { var control = button(name); Check(control != null && control.IsEnabled, "native card control enabled: " + name + " #" + cases.Count); control.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent)); };
            var status = Find<System.Windows.Controls.TextBlock>(panel, "Papercup questions status");
            Until(() => cards.Connected && cards.Cards.Count == rows.Count);
            Check(Find<System.Windows.Controls.RadioButton>(panel, "Papercup answer radio one") != null &&
                Find<System.Windows.Controls.CheckBox>(panel, "Papercup answer checkbox two") != null &&
                Find<System.Windows.Controls.ComboBox>(panel, "Papercup answer select") != null &&
                Find<System.Windows.Controls.TextBox>(panel, "Papercup answer text").AcceptsReturn &&
                Find<System.Windows.Controls.DatePicker>(panel, "Papercup answer date") != null &&
                Find<System.Windows.Controls.Slider>(panel, "Papercup answer slider") != null, "all six card kinds use native typed WPF controls");
            Check(Find<System.Windows.Controls.PasswordBox>(panel, "Papercup answer secret") != null &&
                Find<System.Windows.Controls.TextBox>(panel, "Papercup answer secret") == null, "sensitive card answers are masked native password fields");
            var displayed = Elements<System.Windows.Controls.TextBlock>(panel).Select(text => text.Text).ToArray();
            Check(new[] { "Approval title", "Approval paragraph", "Approval question", "Report title", "Plan title", "Plan summary" }.All(displayed.Contains) &&
                displayed.Any(text => text.Contains("Report item") && text.Contains("WI-123")), "card approval prose and structured report preserve canonical context");
            var details = Find<System.Windows.Controls.Expander>(panel, "Papercup details text"); details.IsExpanded = true;
            Check(((System.Windows.Controls.TextBox)details.Content).Text == "Exact details", "card details expand as copyable native text");
            Check(button("decline cancel") == null && !button("submit expired").IsEnabled && button("submit unknown") == null,
                "decline policy expiry and unsupported kinds cannot fabricate a native submit");
            string opened = null;
            panel.GetType().GetField("LaunchChatUri", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).SetValue(panel, new Action<string>(uri => opened = uri));
            click("secure link secret");
            Check(opened == "http://fixture.invalid:3170/api/ui/cards/secret/link", "native secure link uses the selected canonical operator origin");
            click("submit radio");
            Check(cards.Connected && cards.Pending == null && status.Text.Contains("Choose") && !System.IO.File.Exists(path + ".card-writes"), "invalid native selection never invokes the response helper");
            var draft = Find<System.Windows.Controls.TextBox>(panel, "Papercup answer text"); draft.Text = "literal ' $() \u03bb\nsecond line";
            var prior = cards.Cards[0]; save(); Until(() => !Object.ReferenceEquals(prior, cards.Cards[0]));
            Check(Find<System.Windows.Controls.TextBox>(panel, "Papercup answer text") == draft && draft.Text.Contains("second line"), "identical new-version snapshots retain controls and exact multiline draft");
            Find<System.Windows.Controls.RadioButton>(panel, "Papercup answer radio two").IsChecked = true;
            Find<System.Windows.Controls.CheckBox>(panel, "Papercup answer checkbox one").IsChecked = true;
            Find<System.Windows.Controls.CheckBox>(panel, "Papercup answer checkbox two").IsChecked = true;
            var drafts = (System.Collections.IDictionary)panel.GetType().GetField("cardDrafts", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).GetValue(panel);
            Func<string[]> selectedDraft = () => ((IEnumerable<string>)drafts["select"].GetType().GetField("Picks").GetValue(drafts["select"])).ToArray();
            var originalSelect = Find<System.Windows.Controls.ComboBox>(panel, "Papercup answer select"); originalSelect.SelectedValue = "two";
            Check(Object.Equals(Find<System.Windows.Controls.ComboBox>(panel, "Papercup answer select").SelectedValue, "two"), "native dropdown selects the canonical option identity");
            Check(selectedDraft().SequenceEqual(new[] { "two" }), "native dropdown captures the selected identity during the selection event");
            originalSelect.SelectedItem = null;
            Check(selectedDraft().Length == 0, "deliberately clearing the current dropdown clears its draft");
            originalSelect.SelectedItem = originalSelect.Items.Cast<System.Windows.Controls.ComboBoxItem>().Single(option => Object.Equals(option.Tag, "two"));
            Check(selectedDraft().SequenceEqual(new[] { "two" }), "native dropdown item selection captures the canonical identity");
            Find<System.Windows.Controls.PasswordBox>(panel, "Papercup answer secret").Password = "sensitive literal";
            Find<System.Windows.Controls.DatePicker>(panel, "Papercup answer date").SelectedDate = new DateTime(2026, 11, 20);
            Find<System.Windows.Controls.Slider>(panel, "Papercup answer slider").Value = 6;
            foreach (var id in new[] { "radio", "checkbox", "select", "text", "date", "slider", "secret" })
            {
                click("submit " + id); Until(() => cards.Error != null || cards.Pending == null && !cards.Cards.Any(card => card.Id == id));
                Check(cards.Error == null, "native card acknowledgement " + id + ": " + cards.Error);
                if (id == "radio" || id == "checkbox") Check(selectedDraft().SequenceEqual(new[] { "two" }) &&
                    Object.Equals(Find<System.Windows.Controls.ComboBox>(panel, "Papercup answer select").SelectedValue, "two"),
                    "unanswered dropdown draft and displayed selection survive " + id + " acknowledgement");
                if (id == "radio") originalSelect.SelectedValue = null;
                if (id == "checkbox") Check(Object.Equals(Find<System.Windows.Controls.ComboBox>(panel, "Papercup answer select").SelectedValue, "two"),
                    "late selection event from detached dropdown cannot erase the current card draft");
            }
            var writes = System.IO.File.ReadAllLines(path + ".card-writes").Select(Json).ToArray();
            Func<string, Dictionary<string, object>> payload = id => (Dictionary<string, object>)writes.Single(write => (string)write["correlationId"] == id)["payload"];
            Check(((System.Collections.IList)payload("radio")["picks"]).Cast<object>().SequenceEqual(new[] { "two" }) &&
                ((System.Collections.IList)payload("checkbox")["picks"]).Count == 2 &&
                ((System.Collections.IList)payload("select")["picks"]).Cast<object>().SequenceEqual(new[] { "two" }), "native choices submit exact option identities despite duplicate labels");
            Check((string)payload("text")["value"] == "literal ' $() \u03bb\nsecond line" && (string)payload("secret")["value"] == "sensitive literal" &&
                (string)payload("date")["value"] == "2026-11-20" && Convert.ToInt32(payload("slider")["value"]) == 6, "native typed answers reach the helper byte-for-byte with numeric slider payload");
            click("decline decline"); Until(() => !cards.Cards.Any(card => card.Id == "decline"));
            click("cancel cancel"); Until(() => !cards.Cards.Any(card => card.Id == "cancel"));
            writes = System.IO.File.ReadAllLines(path + ".card-writes").Select(Json).ToArray();
            Check(writes.Any(write => (string)write["action"] == "decline") && writes.Any(write => (string)write["action"] == "cancel"), "native decline and cancel wait for exact canonical receipts");
            Find<System.Windows.Controls.TextBox>(panel, "Papercup answer denied").Text = "keep after denial";
            System.IO.File.WriteAllText(path + ".cards-deny", "deny"); click("submit denied"); Until(() => cards.Error != null && !cards.Connected);
            Check(cards.Cards.Any(card => card.Id == "denied") && !button("submit denied").IsEnabled &&
                Find<System.Windows.Controls.TextBox>(panel, "Papercup answer denied").Text == "keep after denial", "denied native answer retains its draft and blocks blind resubmit");
            System.IO.File.Delete(path + ".cards-deny"); click("reconnect questions"); Until(() => cards.Connected && cards.Cards.Any(card => card.Id == "denied"));
            Check(Find<System.Windows.Controls.TextBox>(panel, "Papercup answer denied").Text == "keep after denial", "question reconnect preserves exact same-scope draft for reconciliation");
            Find<System.Windows.Controls.TextBox>(panel, "Papercup answer wrong").Text = "keep until exact receipt";
            System.IO.File.WriteAllText(path + ".cards-wrong", "wrong"); click("submit wrong"); Until(() => !cards.Connected && cards.Error != null);
            Check(cards.Cards.Any(card => card.Id == "wrong") && status.Text.Contains("reconciliation"), "wrong correlation receipt cannot remove native card or claim success");
            System.IO.File.Delete(path + ".cards-wrong"); click("reconnect questions"); Until(() => cards.Connected && cards.Cards.Count > 0);
            rows.Single(value => (string)value["correlationId"] == "denied")["prompt"] = "Changed question"; save();
            Until(() => Find<System.Windows.Controls.TextBox>(panel, "Papercup answer denied").Text == "");
            Check(cards.Cards.Any(card => (string)card.Raw["prompt"] == "Changed question"), "changed card signature clears the old answer instead of reusing a stale draft");
            System.IO.File.WriteAllText(path + ".other", "other"); host.Toggle("papercup"); host.Toggle("papercup");
            Until(() => chat.Ready && chat.ConversationId == b && cards.Connected);
            Check(cards.Cards.Count == 0 && Find<System.Windows.Controls.TextBox>(panel, "Papercup answer denied") == null,
                "switching conversation fences old question frames and draft controls");
            host.Toggle("papercup");
            Check(!cards.Connected && cards.ConversationId == "" && cards.Cards.Count == 0, "dismissing native sidebar cancels subscription and invalidates card generation");
        }
    }
    private static void ContentNative()
    {
        using (var host = new WorkbenchHost(Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_FIXTURE")))
        {
            host.State("papercup").Pinned = true; host.Toggle("papercup"); var panel = host.Panel("papercup");
            var chat = (ChatState)panel.GetType().GetField("chat", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).GetValue(panel);
            Until(() => chat.Ready && chat.ReferencePlans.Count == 2);
            var environment = chat.Environment;
            var matches = NativeWorkRefs.Parse("\ud83d\ude00 WI-7 `EI-1` [WI-2](https://x/EI-3) ```F-4``` P-005 WI-7 \u03bbEI-8\u03bb XWI-9 WI-10x P-01");
            Check(String.Join(",", matches.Select(match => match.Value)) == "WI-7,P-005,WI-7,EI-8", "shared refs mask code and links and preserve repetitions and ASCII boundaries");
            Check(matches[0].Index == 3, "native ref offsets use UTF16 beside astral text");
            Check(NativeWorkRefs.Parse("WI-1 ```P-005\nEI-2").Length == 1, "unterminated code fences mask the remaining refs");
            Check(NativeWorkRefs.Parse("wi-1 P-12 _WI-3 WI-4_ P-1234").Single().Value == "P-1234", "reference shape remains case sensitive and word bounded");
            Check(NativeWorkRefs.Target("WI-7", environment, "a +/=&", null) == "http://fixture.invalid:3170/?wpop=a%20%2B%2F%3D%26%3A%3AWI-7", "work links encode exact harness on the selected origin");
            Check(NativeWorkRefs.Target("P-005", environment, "one", "a/b") == "http://fixture.invalid:3170/?wppop=one%3A%3Aa%2Fb", "plan links use the GUI plan popup grammar");
            Check(NativeWorkRefs.Target("P-005", environment, "one", "") == null && NativeWorkRefs.Target("WI-7", environment, "", "plan") == null, "missing plan or harness stays inert");
            var bad = new Dictionary<string, object>(environment); bad["endpoint"] = "https://user:secret@example.com";
            Check(NativeWorkRefs.Target("WI-7", bad, "one", null) == null, "credentialed origins cannot become native links");
            Check(NativeWorkRefs.Markdown("WI-7 `WI-7`", environment, "one", null).EndsWith(" `WI-7`"), "native link substitution leaves inline code intact");
            var opened = new List<string>();
            var view = NativeChatContent.View("# Heading\n\n**bold** *italic* ~~gone~~ `WI-1`\n\n```cs\nvar answer = 42;\n```\n\n3. third\n4. fourth\n\n> quote\n\n| A | B |\n|---|---|\n| cell | value |\n\n[go](https://example.com/path) [bad](javascript:alert) ![alt](https://example.com/pixel)\n\n<script>unsafe()</script>", opened.Add);
            var text = new System.Windows.Documents.TextRange(view.Document.ContentStart, view.Document.ContentEnd).Text;
            Check(view.IsReadOnly && view.IsDocumentEnabled, "native Markdown is selectable and enables link activation");
            Check(view.Document.Blocks.OfType<System.Windows.Documents.Paragraph>().First().FontWeight == FontWeights.Bold, "Markdown heading has native heading emphasis");
            Check(Elements<System.Windows.Documents.Run>(view.Document).Any(run => run.Text == "bold" && run.FontWeight == FontWeights.Bold), "Markdown strong text uses native bold runs");
            Check(Elements<System.Windows.Documents.Run>(view.Document).Any(run => run.Text == "italic" && run.FontStyle == FontStyles.Italic), "Markdown emphasis uses native italic runs");
            Check(Elements<System.Windows.Documents.Run>(view.Document).Any(run => run.Text == "WI-1" && run.FontFamily.Source == "Consolas"), "inline code remains copyable native monospace text");
            Check(text.Contains("var answer = 42;") && !text.Contains("```"), "fenced code preserves source without Markdown delimiters");
            Check(view.Document.Blocks.OfType<System.Windows.Documents.List>().Single().StartIndex == 3, "ordered lists retain the canonical starting number");
            Check(view.Document.Blocks.OfType<System.Windows.Documents.Section>().Any() && text.Contains("quote"), "block quotes render as native document sections");
            Check(view.Document.Blocks.OfType<System.Windows.Documents.Table>().Single().RowGroups[0].Rows.Count == 2 && text.Contains("cell"), "maintained table AST renders native header and data cells");
            var links = Elements<System.Windows.Documents.Hyperlink>(view.Document).ToArray();
            Check(links.Length == 1 && links[0].NavigateUri.AbsoluteUri == "https://example.com/path", "unsafe links and image URLs never become active or fetch content");
            links[0].RaiseEvent(new System.Windows.Navigation.RequestNavigateEventArgs(links[0].NavigateUri, ""));
            Check(opened.SequenceEqual(new[] { "https://example.com/path" }), "native hyperlink navigation invokes the host activation seam once");
            Check(text.Contains("unsafe()") && text.Contains("alt"), "HTML and image alternative text remain visible inert content");
            var context = Find<System.Windows.Controls.ComboBox>(panel, "Papercup work link context");
            context.SelectedItem = context.Items.Cast<System.Windows.Controls.ComboBoxItem>().First(item => (string)item.Tag == chat.ReferencePlans[0].Key);
            Check(chat.ReferenceHarness == "one" && chat.ReferencePlan("") == "same", "explicit context captures canonical harness plus plan identity");
            Check(chat.ReferencePlan("message-plan") == "message-plan", "message plan takes precedence over selected fallback");
            var choice = chat.ReferenceKey; chat.Draft = "unsent draft";
            panel.GetType().GetMethod("Refresh", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(panel, null);
            Until(() => chat.Ready && chat.ReferencePlans.Count == 2);
            Check(chat.ReferenceKey == choice && chat.Draft == "unsent draft", "same-conversation refresh retains explicit context and unsent draft");
            chat.Turns[0]["text"] = "WI-7 P-005 `WI-8`"; chat.Turns[0]["planSlug"] = "message-plan";
            var render = panel.GetType().GetMethod("RenderChat", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic); render.Invoke(panel, null);
            var history = Find<System.Windows.Controls.RichTextBox>(panel, "Papercup message text");
            var worklinks = Elements<System.Windows.Documents.Hyperlink>(history.Document).ToArray();
            Check(worklinks.Length == 2 && worklinks[1].NavigateUri.Query.Contains("message-plan"), "actual native history renders scoped refs while code remains inert");
            var activated = new List<string>(); panel.GetType().GetField("LaunchChatUri", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).SetValue(panel, new Action<string>(activated.Add));
            worklinks[0].RaiseEvent(new System.Windows.Navigation.RequestNavigateEventArgs(worklinks[0].NavigateUri, ""));
            Check(activated.Count == 1 && activated[0].Contains("one%3A%3AWI-7"), "native history activates the exact selected harness target");
            context.SelectedItem = context.Items.Cast<System.Windows.Controls.ComboBoxItem>().First(item => (string)item.Tag == chat.ReferencePlans[1].Key);
            worklinks[0].RaiseEvent(new System.Windows.Navigation.RequestNavigateEventArgs(worklinks[0].NavigateUri, ""));
            Check(activated.Count == 1 && chat.ReferenceHarness == "two", "replaced context fences retained document links from the former harness");
            host.Toggle("papercup");
            worklinks[0].RaiseEvent(new System.Windows.Navigation.RequestNavigateEventArgs(worklinks[0].NavigateUri, ""));
            Check(activated.Count == 1, "dismissed native documents cannot activate retained work links");
            var path = Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_STATE");
            System.IO.File.WriteAllText(path + ".other", "other"); host.Toggle("papercup");
            Until(() => chat.Ready && chat.ReferencePlans.Count == 2);
            Check(chat.ReferenceKey == "" && chat.ReferenceHarness == "fixture" && chat.Draft == "", "conversation change clears fallback context and keeps the other draft isolated");
            Check(chat.ReferencePlan("") == "" && chat.ReferencePlan("own-plan") == "own-plan", "new conversation cannot inherit the previous plan fallback");
            System.IO.File.Delete(path + ".other");
            var generation = chat.Begin();
            Check(!chat.SettleReferencePlans(generation - 1, environment, null), "late context response is fenced by generation");
            Check(chat.ReferencePlans.Count == 0, "conversation reload removes previous interactive context choices");
        }
    }
    private sealed class VoiceDeviceFixture : NativeVoiceDevice
    {
        public bool Denied, Playing, Cancelled;
        public readonly TaskCompletionSource<byte[]> Recording = new TaskCompletionSource<byte[]>();
        private readonly TaskCompletionSource<bool> playback = new TaskCompletionSource<bool>();
        public static byte[] Wave()
        {
            using (var stream = new System.IO.MemoryStream())
            using (var writer = new System.IO.BinaryWriter(stream))
            {
                writer.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); writer.Write(320036);
                writer.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt ")); writer.Write(16); writer.Write((short)1);
                writer.Write((short)1); writer.Write(16000); writer.Write(32000); writer.Write((short)2); writer.Write((short)16);
                writer.Write(System.Text.Encoding.ASCII.GetBytes("data")); writer.Write(320000); writer.Write(new byte[320000]); return stream.ToArray();
            }
        }
        public override Task<byte[]> RecordAsync(Action ready, CancellationToken token)
        {
            if (Denied) throw new InvalidOperationException("fixture microphone denied");
            token.Register(() => { Cancelled = true; Recording.TrySetCanceled(); }); ready(); return Recording.Task;
        }
        public override void FinishRecording() { Recording.TrySetResult(Wave()); }
        public override Task PlayAsync(byte[] bytes, CancellationToken token)
        { Playing = true; token.Register(() => { Cancelled = true; playback.TrySetCanceled(); }); return playback.Task; }
    }
    private static void VoiceNative()
    {
        var path = Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_STATE");
        using (var host = new WorkbenchHost(Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_FIXTURE")))
        {
            host.State("papercup").Pinned = true; host.Toggle("papercup"); var panel = host.Panel("papercup");
            var chat = (ChatState)panel.GetType().GetField("chat", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).GetValue(panel);
            var compose = Find<System.Windows.Controls.TextBox>(panel, "Papercup message");
            var notice = Find<System.Windows.Controls.TextBlock>(panel, "Papercup voice status");
            Action<string> click = name => { var button = Find<System.Windows.Controls.Button>(panel, "Papercup " + name);
                if (!button.IsEnabled) throw new Exception("disabled voice control: " + name); button.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent)); };
            Until(() => chat.Ready); compose.Text = "retryable draft \u03bb\nsecond line"; var draft = compose.Text;
            var environment = ChatReply.Copy(chat.Environment); var conversation = chat.ConversationId;
            var id = Guid.NewGuid().ToString();
            var request = new Dictionary<string,object>{{"environment",environment},{"conversationId",conversation},{"requestId",id},{"operation","transcribe"},{"audioBase64",Convert.ToBase64String(VoiceDeviceFixture.Wave())}};
            var row = new Dictionary<string,object>{{"conversationId",conversation},{"requestId",id},{"operation","transcribe"},{"text","voice transcript \u03bb"}};
            var payload = new Dictionary<string,object>{{"environment",environment},{"rows",new object[]{row}}};
            NativeVoice.Validate(request); Check(NativeVoice.Result(request,payload)==row,"canonical voice receipt accepts exact Unicode transcript");
            foreach(var key in new[]{"conversationId","requestId","operation"}) {
                var bad=ChatReply.Copy(payload); ((Dictionary<string,object>)((System.Collections.IList)bad["rows"])[0])[key]="wrong";
                Refuses(()=>NativeVoice.Result(request,bad),"voice refuses foreign receipt "+key);
            }
            foreach(var key in new[]{"endpoint","workspaceId","store","agentChat"}) {
                var bad=ChatReply.Copy(payload); var env=ChatReply.Object(bad["environment"]);
                env[key]=key=="store"? (object)new Dictionary<string,object>{{"id","other"}} : key=="agentChat"? (object)new Dictionary<string,object>{{"scope","other"}} : "other";
                Refuses(()=>NativeVoice.Result(request,bad),"voice refuses foreign environment axis "+key);
            }
            foreach(var text in new[]{"", " ",new string('x',32769)}) {
                var bad=ChatReply.Copy(payload); ((Dictionary<string,object>)((System.Collections.IList)bad["rows"])[0])["text"]=text;
                Refuses(()=>NativeVoice.Result(request,bad),"voice refuses empty or oversized transcript #"+cases.Count);
            }
            foreach(var audio in new[]{"AB==","AAAA\n","bad",new string('A',2600004)})
                Refuses(()=>NativeVoice.Audio(audio,2600000),"voice refuses noncanonical or oversized audio #"+cases.Count);
            chat.BeginVoice(id,"permission"); Check(chat.AdvanceVoice(id,"recording") && chat.AdvanceVoice(id,"transcribing"),"voice advances only through recording and transcription");
            var badRequest=ChatReply.Copy(request); badRequest["requestId"]=Guid.NewGuid().ToString();
            Refuses(()=>chat.Transcribed(id,badRequest,payload),"voice rejects request not owned by current capture");
            Check(chat.Draft==draft,"failed voice receipt preserves exact multiline draft");
            chat.Draft="edited"; Check(!chat.Transcribed(id,request,payload),"late voice result cannot overwrite edited draft"); chat.Draft=draft;
            chat.BeginVoice(id,"permission"); ++chat.Generation; Check(!chat.VoiceCurrent(id),"voice result is fenced by generation"); chat.CancelVoice();
            VoiceDeviceFixture device=null;
            Action<Func<NativeVoiceDevice>> setDevice = factory => panel.GetType().GetField("CreateVoiceDevice",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).SetValue(panel,factory);
            setDevice(()=>device=new VoiceDeviceFixture());
            click("record message"); Check(chat.VoicePhase=="recording" && compose.Text==draft,"recording retains draft and displays recording state");
            click("stop voice"); Until(()=>device.Cancelled); Check(compose.Text==draft && chat.VoiceId==null,"stop recording releases capture and preserves draft");
            click("record message"); var hidden=device; host.Toggle("papercup");
            Check(hidden.Cancelled && !panel.IsVisible && chat.VoiceId==null,"dismissal cancels voice before hiding the resident panel");
            host.Toggle("papercup"); Until(()=>chat.Ready); Check(compose.Text==draft,"reopening preserves original voice draft");
            setDevice(()=>device=new VoiceDeviceFixture{Denied=true}); click("record message");
            Check(notice.Text.Contains("microphone denied") && compose.Text==draft && chat.VoiceId==null,"microphone failure is explicit and preserves retryable draft");
            setDevice(()=>device=new VoiceDeviceFixture());
            System.IO.File.WriteAllText(path+".voice-deny","deny"); click("record message"); click("use recording");
            Until(()=>notice.Text.Contains("voice denied")); Check(compose.Text==draft,"canonical transcription failure retains draft without success");
            System.IO.File.Delete(path+".voice-deny");
            System.IO.File.WriteAllText(path+".voice-wrong","wrong"); click("record message"); click("use recording");
            Until(()=>notice.Text.Contains("different conversation")); Check(compose.Text==draft,"foreign transcription receipt cannot replace draft");
            System.IO.File.Delete(path+".voice-wrong"); click("record message"); click("use recording");
            Until(()=>chat.VoiceId==null);
            Check(compose.Text=="voice transcript \u03bb","canonical Unicode transcript is displayed exactly: text="+compose.Text+"; status="+notice.Text);
            var progress=Environment.GetEnvironmentVariable("PAPERCUSP_NATIVE_FIXTURE_PROGRESS");
            if(!String.IsNullOrEmpty(progress)) System.IO.File.WriteAllText(System.IO.Path.Combine(System.IO.Path.GetDirectoryName(progress),"voice-ui.json"),
                new JavaScriptSerializer().Serialize(new{transcript=compose.Text,status=notice.Text,conversationId=chat.ConversationId}),new System.Text.UTF8Encoding(false));
            Check(notice.Text.Contains("review") && chat.Reply==null,"transcription requires review and never sends automatically");
            var writes=System.IO.File.ReadAllLines(path+".voice-writes").Select(line=>Json(line)).ToArray();
            Check(writes.All(write=>PanelState.Text(write,"conversationId")==conversation) && writes.All(write=>PanelState.Text(write,"requestId")!="") &&
                ((string)writes.Last()["audioBase64"]).Length>65536,"native voice child receives exact conversation, request and audio beyond ordinary panel limit");
            var send=chat.Send(Guid.NewGuid().ToString()); Check(PanelState.Text(send,"modality")=="voice","unchanged transcript retains voice modality on canonical send");
            chat.Reply=null; compose.Text="edited transcript"; send=chat.Send(Guid.NewGuid().ToString());
            Check(PanelState.Text(send,"modality")=="text","editing transcript restores text modality"); chat.Reply=null;
            chat.Turns.Add(new Dictionary<string,object>{{"role","assistant"},{"text","public spoken reply"}});
            // Direct model setup needs the same render production runs after history loads.
            panel.GetType().GetMethod("RenderChat",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).Invoke(panel,null);
            Check(chat.CanUseVoice && chat.SpokenReply=="public spoken reply","spoken reply fixture has a ready canonical assistant turn");
            click("read reply"); Until(()=>device.Playing); Check(chat.VoicePhase=="playing" && compose.Text=="edited transcript","spoken reply plays canonical receipt without changing draft");
            click("stop voice"); Check(device.Cancelled && chat.VoiceId==null,"stop spoken reply cancels local playback");
            var read=Json(System.IO.File.ReadAllLines(path+".voice-writes").Last());
            Check(PanelState.Text(read,"operation")=="speak" && PanelState.Text(read,"text")=="public spoken reply","spoken reply uses existing canonical TTS route");
        }
    }
    private static void ChatNative()
    {
        var path = Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_STATE");
        Action<string> mark = name => System.IO.File.WriteAllText(path + "." + name, name);
        Action<string> clear = name => System.IO.File.Delete(path + "." + name);
        using (var host = new WorkbenchHost(Environment.GetEnvironmentVariable("WORKBENCH_ACCOUNT_FIXTURE")))
        {
            host.State("papercup").Pinned = true; host.Toggle("papercup"); var panel = host.Panel("papercup");
            var chat = (ChatState)panel.GetType().GetField("chat", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).GetValue(panel);
            var compose = Find<System.Windows.Controls.TextBox>(panel, "Papercup message");
            var status = Find<System.Windows.Controls.TextBlock>(panel, "Workbench status");
            Func<string, System.Windows.Controls.Button> button = name => Find<System.Windows.Controls.Button>(panel, "Papercup " + name);
            Action<string> click = name => { var b = button(name); Check(b.IsEnabled, "native chat control enabled: " + name + " #" + cases.Count); b.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent)); };
            Action reload = () => panel.GetType().GetMethod("Refresh", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).Invoke(panel, null);
            Until(() => chat.Ready);
            var hwnd = new WindowInteropHelper(panel).Handle;
            Check(panel.IsVisible && !panel.ShowInTaskbar && panel.WindowStyle == WindowStyle.None && (Style(hwnd, -20) & 0x80) != 0,
                "Papercup is a resident native tool sidebar without app chrome");
            var scope = Find<System.Windows.Controls.TextBlock>(panel, "Papercup conversation environment");
            Check(scope.Text.Contains("fixture.invalid:3170") && scope.Text.Contains("isolated") && scope.Text.Contains(chat.ConversationId),
                "Papercup displays the canonical selected environment and conversation");
            Check(chat.Turns.Count == 1 && PanelState.Text(chat.Turns[0], "text") == "Recent history", "native chat loads canonical history");
            click("earlier messages"); Until(() => !chat.Loading);
            Check(chat.Turns.Count == 2 && PanelState.Text(chat.Turns[0], "text") == "Earlier history", "native history prepends the exact earlier page");
            compose.Text = "draft +/=& \u03bb\nsecond line"; var draft = compose.Text;
            host.Toggle("papercup"); host.Toggle("papercup"); Until(() => chat.Ready);
            Check(host.Panel("papercup") == panel && new WindowInteropHelper(panel).Handle == hwnd && compose.Text == draft,
                "native Papercup retains its HWND and exact multiline draft across dismissal");
            mark("deny"); click("send"); Until(() => chat.Error != null);
            Check(compose.Text == draft && !button("send").IsEnabled && status.Text.StartsWith("Unavailable") && !System.IO.File.Exists(path + ".writes"),
                "denied native send retains draft without success or a duplicate send route");
            clear("deny"); reload(); Until(() => chat.Ready); click("send");
            Until(() => chat.Reply != null && chat.Reply.DisplayText == "Partial" && !chat.Reply.Complete);
            Check(compose.Text == "" && chat.Reply.SavedUser != null, "only canonical user acknowledgement clears the native draft");
            var displayedMessages = Elements<System.Windows.Controls.RichTextBox>(panel)
                .Where(view => System.Windows.Automation.AutomationProperties.GetName(view) == "Papercup message text")
                .Select(view => new System.Windows.Documents.TextRange(view.Document.ContentStart, view.Document.ContentEnd).Text).ToArray();
            Check(displayedMessages.Any(text => text.Trim() == "Partial") &&
                displayedMessages.All(text => !text.Contains("internal")) && !chat.Reply.DisplayText.Contains("internal"),
                "native incremental display excludes private text");
            Until(() => chat.Reply == null && chat.Ready);
            Check(chat.Turns.Any(t => PanelState.Text(t, "role") == "assistant" && PanelState.Text(t, "text") == "Partial reply"),
                "completed native stream reloads the saved canonical assistant turn");
            mark("disconnect"); compose.Text = "reconnect me"; click("send"); Until(() => chat.Error != null && chat.Reply != null && chat.Reply.TurnId != "");
            var writes = System.IO.File.ReadAllLines(path + ".writes").Length;
            Check(button("reconnect").IsEnabled && !button("send").IsEnabled, "disconnected native reply exposes reconciliation without resending");
            clear("disconnect"); click("reconnect"); Until(() => chat.Reply == null && chat.Ready);
            Check(System.IO.File.ReadAllLines(path + ".writes").Length == writes && System.IO.File.ReadAllText(path + ".controls").Contains("reconnect:1"),
                "native reconnect resumes the saved turn cursor without a second send");
            mark("hold"); compose.Text = "cancel me"; click("send"); Until(() => chat.Reply != null && chat.Reply.Sequence == 1);
            click("cancel reply"); Until(() => chat.Reply != null && chat.Reply.Complete);
            Check(chat.Reply.Phase == "cancelled" && status.Text.Contains("cancelled") && System.IO.File.ReadAllText(path + ".controls").Contains("cancel"),
                "native cancel waits for a canonical cancelled acknowledgement");
            clear("hold"); reload(); Until(() => chat.Ready);
            mark("hold"); compose.Text = "conversation A only"; click("send"); Until(() => chat.Reply != null && chat.Reply.Sequence == 1);
            var a = chat.ConversationId; mark("other"); host.Toggle("papercup"); host.Toggle("papercup"); Until(() => chat.Ready && chat.ConversationId != a);
            compose.Text = "conversation B draft"; Pump();
            Check(chat.Reply == null && chat.Turns.All(t => !PanelState.Text(t, "text").Contains("conversation A only")) && compose.Text == "conversation B draft",
                "late A stream cannot enter conversation B or clear its native draft");
            clear("other"); clear("hold"); reload(); Until(() => chat.Ready && chat.ConversationId == a);
            Check(chat.Turns.Any(t => PanelState.Text(t, "text") == "conversation A only"), "returning to A reads its independently saved user event");
            mark("other"); reload(); Until(() => chat.Ready && chat.ConversationId != a);
            Check(compose.Text == "conversation B draft", "native draft keys include the canonical conversation identity");
            clear("other"); reload(); Until(() => chat.Ready && chat.ConversationId == a);
            mark("foreign"); compose.Text = "foreign frame"; click("send"); Until(() => chat.Error != null);
            Check(chat.Reply.DisplayText == "" && status.Text.Contains("Unavailable") && compose.Text == "foreign frame",
                "foreign environment frame cannot alter native reply or acknowledge its draft");
            clear("foreign");
            Check(System.IO.File.ReadAllLines(path + ".writes").All(line => line == a), "every native send is bound to conversation A in the helper receipt");
        }
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
        organizerRuns.Clear();
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
        if (phase == "environment-refusal") { EnvironmentRefusalOracle(); }
        if (phase == "accounts") { AccountsModel(); AccountsNative(); }
        if (phase == "goals") { GoalsNative(); }
        if (phase == "inbox") { InboxModel(); InboxNative(); }
        if (phase == "organizer") { OrganizerModel(); OrganizerNative(); }
        if (phase == "chat") { ChatNative(); }
        if (phase == "content") { ContentNative(); }
        if (phase == "cards") { CardsNative(); }
        if (phase == "voice") { VoiceNative(); }
        if (phase == "operator") { OperatorNative(); }
        if (phase == "operator-inbox") { OperatorInboxNative(); }
        if (phase == "all" || phase == "hotkeys" || phase == "windows")
        { Console.Error.WriteLine("PHASE " + (phase == "all" ? "windows" : phase)); Native(phase != "hotkeys"); }
        return new JavaScriptSerializer().Serialize(new { ok = true, platform = "windows", phase = phase, cases = cases.ToArray(), count = cases.Count,
            organizerRuns = organizerRuns.ToArray(),
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
    # Compile preflight includes the generated child as well as the WPF fixture.
    if ($Phase -in @('compile', 'accounts', 'goals', 'inbox', 'organizer', 'chat', 'content', 'cards', 'voice')) {
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
    private const string ChatA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ChatB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ChatTurn = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    private static void Frame(JavaScriptSerializer json, object environment, string kind, object data) {
        var bytes = new UTF8Encoding(false).GetBytes(json.Serialize(new { environment = environment, @event = kind, data = data }) + "\n");
        Console.OpenStandardOutput().Write(bytes, 0, bytes.Length); Console.Out.Flush();
    }
    private static int Cards(string[] args, Dictionary<string, object> request, JavaScriptSerializer json, string path, object environment) {
        if (args.Length != 1 || args[0] != "native-cards" || json.Serialize(request["environment"]) != json.Serialize(environment)) return 70;
        var conversation = (string)request["conversationId"];
        if ((string)request["operation"] == "respond") {
            if (File.Exists(path + ".cards-deny")) { Console.Error.Write("isolated answer denied"); return 7; }
            var id = (string)request["correlationId"];
            File.AppendAllText(path + ".card-writes", json.Serialize(request) + "\n");
            if (!File.Exists(path + ".cards-wrong")) File.WriteAllText(path + ".card-resolved-" + id, "resolved");
            Console.Write(json.Serialize(new { environment = environment, rows = new[] { new {
                responded = true, conversationId = conversation, correlationId = File.Exists(path + ".cards-wrong") ? "wrong-receipt" : id } } })); return 0;
        }
        Frame(json, environment, "reset", new { workspaceId = "isolated" });
        string previous = null;
        for (var i = 0; i < 500; ++i) {
            if (File.Exists(path + ".cards")) {
                var raw = File.ReadAllText(path + ".cards");
                if (raw != previous) {
                    var saved = json.Deserialize<Dictionary<string, object>>(raw); previous = raw;
                    var cards = ((IList)saved["rows"]).Cast<Dictionary<string, object>>().Where(row =>
                        Object.Equals(row["conversationId"], conversation) && !File.Exists(path + ".card-resolved-" + (string)row["correlationId"])).ToArray();
                    Frame(json, environment, "snapshot", new { workspaceId = "isolated", runId = "native-questions", version = saved["version"], snapshot = new { openCards = cards } });
                }
            }
            System.Threading.Thread.Sleep(50);
        }
        return 0;
    }
    private static int Chat(string[] args, Dictionary<string, object> request, JavaScriptSerializer json, string path, object environment) {
        if (args.Length == 1 && args[0] == "native-cards") return Cards(args, request, json, path, environment);
        if (args.Length == 1 && args[0] == "native-voice") {
            File.AppendAllText(path+".voice-writes",json.Serialize(request)+"\n");
            if(File.Exists(path+".voice-deny")) {Console.Error.Write("isolated voice denied");return 7;}
            if(json.Serialize(request["environment"])!=json.Serialize(environment))return 71;
            var row=new Dictionary<string,object>{{"conversationId",File.Exists(path+".voice-wrong")?ChatB:request["conversationId"]},{"requestId",request["requestId"]},{"operation",request["operation"]}};
            if(Object.Equals(request["operation"],"transcribe"))row["text"]="voice transcript \u03bb";
            else row["audioBase64"]="SUQz";
            var response=json.Serialize(new{environment=environment,rows=new[]{row}});
            File.WriteAllText(path+".voice-response",response,new UTF8Encoding(false));
            var progress=Environment.GetEnvironmentVariable("PAPERCUSP_NATIVE_FIXTURE_PROGRESS");
            if(!String.IsNullOrEmpty(progress)) File.WriteAllText(Path.Combine(Path.GetDirectoryName(progress),"voice-response.json"),response,new UTF8Encoding(false));
            var output=new UTF8Encoding(false).GetBytes(response);Console.OpenStandardOutput().Write(output,0,output.Length);return 0;
        }
        var id = File.Exists(path + ".other") ? ChatB : ChatA;
        var saved = File.Exists(path) ? json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path)) : null;
        var user = saved == null ? null : new { id = (string)saved["userTurnId"], conversationId = ChatA, role = "user", seq = 11, text = (string)saved["text"] };
        if (args.Length != 1) return 60;
        if (args[0] == "native-read") {
            var name = (string)request["name"]; object row;
            if (name == "operator.identity") row = environment;
            else {
                if (json.Serialize(request["environment"]) != json.Serialize(environment)) return 61;
                var query = (Dictionary<string, object>)request["args"];
                if (name == "plans.list") {
                    Console.Write(json.Serialize(new { rows = new[] { new { harness = "one", slug = "same", title = "One plan" }, new { harness = "two", slug = "same", title = "Two plan" } }, environment = environment })); return 0;
                }
                if (name == "operatorConversations.current") row = new { id = id, workspaceId = "isolated", subjectKind = "global", status = "active", harnessSlug = "fixture" };
                else if (name == "operatorTurns.page" && Object.Equals(query["conversationId"], id)) {
                    var earlier = query.ContainsKey("beforeSeq"); var turns = new List<object>();
                    if (earlier && Convert.ToInt32(query["beforeSeq"]) != 10) return 62;
                    turns.Add(new { id = earlier ? "earlier" : "recent", conversationId = id, role = "system", seq = earlier ? 1 : 10, text = earlier ? "Earlier history" : "Recent history" });
                    if (!earlier && id == ChatA && user != null) {
                        turns.Add(user); if (File.Exists(path + ".complete")) turns.Add(new { id = "assistant", conversationId = id, role = "assistant", seq = 12, text = "Partial reply" });
                    }
                    row = new { turns = turns, hasMoreEarlier = !earlier };
                } else return 63;
            }
            Console.Write(json.Serialize(new { rows = new[] { row }, environment = environment })); return 0;
        }
        if (args[0] != "native-chat" || !Object.Equals(request["conversationId"], ChatA) || json.Serialize(request["environment"]) != json.Serialize(environment)) return 64;
        if (File.Exists(path + ".deny")) { Console.Error.Write("isolated send denied"); return 7; }
        var operation = (string)request["operation"];
        if (operation == "send") {
            File.WriteAllText(path, json.Serialize(request)); File.Delete(path + ".complete");
            File.AppendAllText(path + ".writes", ChatA + "\n");
            var actualEnvironment = File.Exists(path + ".foreign") ? json.DeserializeObject("{\"endpoint\":\"http://foreign.invalid\",\"workspaceId\":\"foreign\",\"store\":{\"id\":\"foreign\"},\"agentChat\":{\"scope\":\"foreign\"}}") : environment;
            Frame(json, actualEnvironment, "user-saved", new { conversationId = ChatA, turn = new { id = request["userTurnId"], conversationId = ChatA, role = "user", seq = 11, text = request["text"] } });
        } else {
            if (!Object.Equals(request["turnId"], ChatTurn)) return 65;
            File.AppendAllText(path + ".controls", operation + (operation == "reconnect" ? ":" + request["afterSequence"] : "") + "\n");
        }
        if (operation == "cancel") {
            Frame(json, environment, "cancelled", new { ok = true, state = new { schemaVersion = 1, conversationId = ChatA, turnId = ChatTurn,
                phase = "cancelled", revision = 2, lastSequence = 1, capabilities = new { connectionReplay = true, persistedHistory = true,
                    persistedInteractionDecisions = true, completedToolCheckpoints = true, interruptedTurnRecovery = true } } }); return 0;
        }
        Frame(json, environment, "turn-meta", new { schemaVersion = 1, conversationId = ChatA, turnId = ChatTurn });
        if (operation == "send") {
            Frame(json, environment, "chat-event", new { schemaVersion = 1, conversationId = ChatA, turnId = ChatTurn, sequence = 1, eventId = "delta1", @event = new { type = "delta", text = "internal<say>Partial" } });
            System.Threading.Thread.Sleep(File.Exists(path + ".hold") ? 4000 : 700);
            if (File.Exists(path + ".disconnect")) { Console.Error.Write("isolated stream disconnected"); return 7; }
        }
        Frame(json, environment, "chat-event", new { schemaVersion = 1, conversationId = ChatA, turnId = ChatTurn, sequence = 2, eventId = "delta2", @event = new { type = "delta", text = " reply</say>" } });
        File.WriteAllText(path + ".complete", "complete");
        Frame(json, environment, "done", new { phase = "completed", persistedTurn = new { conversationId = ChatA, turnId = ChatTurn, seq = 12 } }); return 0;
    }
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
                if (!query.ContainsKey("id") || query.ContainsKey("itemId") || !Object.Equals(query["id"], "question +/=& \u03bb")) return 49;
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
        if (new[] { "chat", "content", "cards", "voice" }.Contains(Environment.GetEnvironmentVariable("WORKBENCH_CONTROL_PHASE"))) return Chat(args, request, json, path, environment);
        if (Environment.GetEnvironmentVariable("WORKBENCH_CONTROL_PHASE") == "organizer") {
            if (args.Length != 1 || args[0] != "native-read") return 50;
            var name = (string)request["name"]; object organizerRows;
            if (name == "operator.identity") organizerRows = new object[] { environment };
            else if (name == "advRoster.list") organizerRows = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path))["rows"];
            else if (name == "goals.list") organizerRows = new object[] { new { goals = new[] { new { id = "goal", title = "Goal" } } } };
            else if (name == "goals.detail") organizerRows = new object[] { new { goal = new { id = "goal" }, agents = new object[0],
                plans = new[] { new { harnessSlug = "one", planSlug = "same" } } } };
            else return 51;
            Console.Write(json.Serialize(new { rows = organizerRows, environment = environment, version = "organizer-fixture" })); return 0;
        }
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
        (Join-Path $SourceDirectory 'WorkbenchModel.cs'), (Join-Path $SourceDirectory 'WorkbenchContent.cs'), (Join-Path $SourceDirectory 'WorkbenchHost.cs'), $fixtureFile) -ReferencedAssemblies $references
    [WorkbenchNativeHostFixture]::Run($Phase)
} catch { [Console]::Error.WriteLine($_.Exception.ToString()); throw }
finally {
    if (Test-Path -LiteralPath $fixtureFile) { Remove-Item -LiteralPath $fixtureFile -Force }
    if (Test-Path -LiteralPath $argvFixture) { Remove-Item -LiteralPath $argvFixture -Force }
    Remove-Item Env:WORKBENCH_ARGV_FIXTURE -ErrorAction SilentlyContinue
    foreach ($path in @($accountFixture, $accountState, ($accountState + '.deny'), ($accountState + '.writes'), ($accountState + '.unknown'), ($accountState + '.dormant'))) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    foreach ($suffix in @('complete', 'controls', 'hold', 'other', 'disconnect', 'foreign')) {
        $chatPath = $accountState + '.' + $suffix
        if (Test-Path -LiteralPath $chatPath) { Remove-Item -LiteralPath $chatPath -Force }
    }
    Get-ChildItem -LiteralPath ([IO.Path]::GetDirectoryName($accountState)) -Filter ([IO.Path]::GetFileName($accountState) + '.card*') | Remove-Item -Force
    Remove-Item Env:WORKBENCH_ACCOUNT_FIXTURE, Env:WORKBENCH_ACCOUNT_STATE, Env:WORKBENCH_CONTROL_PHASE -ErrorAction SilentlyContinue
}
