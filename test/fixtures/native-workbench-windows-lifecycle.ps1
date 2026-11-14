param([Parameter(Mandatory=$true)][string]$SourceDirectory, [switch]$Resident, [switch]$BudgetOnly)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
Import-Module (Join-Path $SourceDirectory 'WorkbenchLifecycle.psm1') -Force
$controllerOperations = @('Install', 'Install', 'Settings', 'Run', 'Enable', 'Disable', 'Uninstall')
$controllerTimeoutMs = 12000
$settingsTimeoutMs = 5000
# The wrapper must contain every bounded child phase, two settings waits and
# settings/cleanup work. The same contract is read by the Node client.
$fixtureTimeoutMs = 35000 + $controllerOperations.Count * $controllerTimeoutMs + 2 * $settingsTimeoutMs
if ($BudgetOnly) {
    @{ fixtureTimeoutMs=$fixtureTimeoutMs; clientTimeoutMs=($fixtureTimeoutMs + 10000);
        controllerTimeoutMs=$controllerTimeoutMs; settingsTimeoutMs=$settingsTimeoutMs;
        controllerOperations=$controllerOperations; baseTimeoutMs=35000 } | ConvertTo-Json -Compress
    return
}
if ($Resident) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NativeWorkbenchFixtureDesktop {
    [StructLayout(LayoutKind.Sequential)] private struct Flags { public int Inherit, Reserved; public uint Value; }
    [DllImport("user32.dll")] private static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll")] private static extern bool GetUserObjectInformation(IntPtr h, int index, out Flags flags, int length, out int required);
    public static bool Interactive() { Flags flags; int required; return GetUserObjectInformation(GetProcessWindowStation(), 1,
        out flags, Marshal.SizeOf(typeof(Flags)), out required) && (flags.Value & 1) != 0; }
}
'@
    if (-not [NativeWorkbenchFixtureDesktop]::Interactive()) {
        throw 'Resident lifecycle requires the signed-in desktop. Use native-workbench-windows-host.ps1 -Phase lifecycle -Interactive; no fixture state has been written.'
    }
}
$directory = Join-Path $env:TEMP ('Workbench fixture ' + [Guid]::NewGuid().ToString('N') + " ' dollars `$ spaces")
$registry = 'HKCU:\Software\Papercusp\WorkbenchFixture-' + [Guid]::NewGuid().ToString('N')
$cases = [Collections.Generic.List[string]]::new()
function Trace([string]$Message) {
    $entry = [DateTime]::UtcNow.ToString('o') + ' ' + $Message
    [Console]::Error.WriteLine($entry)
    if ($env:PAPERCUSP_NATIVE_FIXTURE_PROGRESS) { [IO.File]::AppendAllText($env:PAPERCUSP_NATIVE_FIXTURE_PROGRESS, $entry + [Environment]::NewLine) }
}
function Check([bool]$Value, [string]$Name) {
    if (-not $Value) { throw $Name }
    $cases.Add($Name); Trace ('PASS ' + $Name)
}
function Refuses([scriptblock]$Block, [string]$Name) {
    $refused = $false
    try { & $Block } catch { $refused = $true }
    Check $refused $Name
}
function Login($Context) {
    $entry = Get-ItemProperty -Path $Context.RunKey -Name $Context.RunName -ErrorAction SilentlyContinue
    if ($null -eq $entry) { return $null }
    return $entry.($Context.RunName)
}
try {
    [void][IO.Directory]::CreateDirectory($directory)
    $pui = Join-Path $directory 'pui.exe'; [IO.File]::WriteAllText($pui, 'fixture path validation only')
    $script = Join-Path $directory 'workbench.ps1'; [IO.File]::WriteAllText($script, "param([string]`$Action); if (`$Action -ne 'Run') { exit 7 }")
    $otherScript = Join-Path $directory 'other-role.ps1'; [IO.File]::WriteAllText($otherScript, '# other role')
    $context = New-WorkbenchContext (Join-Path $directory 'state') ($registry + '\Run')
    $settings = Read-WorkbenchSettings $context $pui
    [void](New-Item -Path $context.RunKey -Force)
    [void](New-ItemProperty -Path $context.RunKey -Name 'Unrelated login application' -Value 'keep this command' -PropertyType String)
    Check ($settings.enabled -and $settings.bindings.'quick-access'.key -eq 32 -and $settings.bindings.goals.key -eq 71) 'first install enables native panels with distinct default shortcuts'
    Check ($settings.bindings.accounts.enabled -and $settings.bindings.accounts.modifiers -eq 3 -and $settings.bindings.accounts.key -eq 65) 'first install enables the Accounts shortcut'
    [void](Save-WorkbenchSettings $context $settings $script)
    Check ($settings.bindings.inbox.enabled -and $settings.bindings.inbox.modifiers -eq 3 -and $settings.bindings.inbox.key -eq 66) 'first install enables Inbox on Ctrl Alt B'
    $oldInbox = $settings | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    $oldInbox.bindings.PSObject.Properties.Remove('inbox'); $oldInbox.bindings.'quick-access'.key = 66
    [IO.File]::WriteAllText($context.File, ($oldInbox | ConvertTo-Json -Depth 8))
    $newInbox = Read-WorkbenchSettings $context $pui
    Check ($newInbox.bindings.inbox.key -eq 67 -and $newInbox.bindings.'quick-access'.key -eq 66 -and $newInbox.bindings.accounts.key -eq 65) 'Inbox migration chooses a free accelerator without resetting existing panels'
    [void](Save-WorkbenchSettings $context $settings $script -PreserveExisting)
    Check ((Read-WorkbenchSettings $context $pui).bindings.inbox.key -eq 67) 'installer persists the migrated Inbox shortcut'
    $newInbox.bindings.inbox.enabled = $false
    [void](Save-WorkbenchSettings $context $newInbox $script)
    [void](Save-WorkbenchSettings $context $settings $script -PreserveExisting)
    Check (-not (Read-WorkbenchSettings $context $pui).bindings.inbox.enabled) 'upgrade preserves explicitly disabled Inbox'
    [void](Save-WorkbenchSettings $context $settings $script)
    $legacy = $settings | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    Check ($settings.bindings.organizer.enabled -and $settings.bindings.organizer.key -eq 79) 'first install enables Organizer on Ctrl Alt O'
    $oldOrganizer = $settings | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    $oldOrganizer.bindings.PSObject.Properties.Remove('organizer'); $oldOrganizer.bindings.'quick-access'.key = 79
    [IO.File]::WriteAllText($context.File, ($oldOrganizer | ConvertTo-Json -Depth 8))
    $newOrganizer = Read-WorkbenchSettings $context $pui
    Check ($newOrganizer.bindings.organizer.key -eq 67 -and $newOrganizer.bindings.'quick-access'.key -eq 79) 'Organizer migration avoids existing shortcuts'
    [void](Save-WorkbenchSettings $context $settings $script -PreserveExisting)
    Check ((Read-WorkbenchSettings $context $pui).bindings.organizer.key -eq 67) 'installer persists the migrated Organizer shortcut'
    $newOrganizer.bindings.organizer.enabled = $false
    [void](Save-WorkbenchSettings $context $newOrganizer $script)
    [void](Save-WorkbenchSettings $context $settings $script -PreserveExisting)
    Check (-not (Read-WorkbenchSettings $context $pui).bindings.organizer.enabled) 'upgrade preserves explicitly disabled Organizer'
    Check ((Read-WorkbenchSettings $context $pui).bindings.'quick-access'.key -eq 79) 'Organizer upgrade retains the prior Quick Access shortcut'
    [void](Save-WorkbenchSettings $context $settings $script)
    $legacy.bindings.PSObject.Properties.Remove('accounts')
    Check ($settings.bindings.papercup.enabled -and $settings.bindings.papercup.modifiers -eq 3 -and $settings.bindings.papercup.key -eq 80) 'first install enables Papercup on Ctrl Alt P'
    $oldChat = $settings | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    $oldChat.bindings.PSObject.Properties.Remove('papercup'); $oldChat.bindings.'quick-access'.key = 80
    [IO.File]::WriteAllText($context.File, ($oldChat | ConvertTo-Json -Depth 8))
    $newChat = Read-WorkbenchSettings $context $pui
    Check ($newChat.bindings.papercup.key -eq 67 -and $newChat.bindings.'quick-access'.key -eq 80) 'Papercup migration avoids existing shortcuts'
    [void](Save-WorkbenchSettings $context $settings $script -PreserveExisting)
    Check ((Read-WorkbenchSettings $context $pui).bindings.papercup.key -eq 67) 'installer persists migrated Papercup shortcut'
    $newChat.bindings.papercup.enabled = $false
    [void](Save-WorkbenchSettings $context $newChat $script)
    [void](Save-WorkbenchSettings $context $settings $script -PreserveExisting)
    Check (-not (Read-WorkbenchSettings $context $pui).bindings.papercup.enabled) 'upgrade preserves explicitly disabled Papercup'
    Check ((Read-WorkbenchSettings $context $pui).bindings.'quick-access'.key -eq 80) 'Papercup upgrade retains existing surface preferences'
    [void](Save-WorkbenchSettings $context $settings $script)
    $legacy.enabled = $false; $legacy.bindings.'quick-access'.key = 65; $legacy.bindings.goals.enabled = $false
    [IO.File]::WriteAllText($context.File, ($legacy | ConvertTo-Json -Depth 8))
    $migrated = Read-WorkbenchSettings $context $pui
    Check (-not $migrated.enabled -and -not $migrated.bindings.goals.enabled -and $migrated.bindings.'quick-access'.key -eq 65) 'adding Accounts preserves legacy disable and shortcut choices'
    Check ($migrated.bindings.accounts.enabled -and $migrated.bindings.accounts.key -eq 67) 'Accounts migration avoids existing Quick Access and Inbox shortcuts'
    [void](Save-WorkbenchSettings $context $settings $script -PreserveExisting)
    Check ((Read-WorkbenchSettings $context $pui).bindings.accounts.key -eq 67) 'preserve-existing installer persists the missing Accounts binding'
    [void](Save-WorkbenchSettings $context $settings $script)
    $command = Login $context
    Check ($command -eq (Get-WorkbenchLoginCommand $script)) 'login registration uses the exact installed controller and fixed argv'
    Check ((Get-ItemPropertyValue -Path $context.RunKey -Name 'Unrelated login application') -eq 'keep this command') 'Workbench registration preserves unrelated login applications'
    $exe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $child = Start-Process $exe -ArgumentList $command.Substring($command.IndexOf('" ', 1) + 2) -WindowStyle Hidden -Wait -PassThru
    Check ($child.ExitCode -eq 0) 'native login command preserves spaces apostrophes and literal dollar signs'
    $settings.bindings.'quick-access'.modifiers = 6; $settings.bindings.'quick-access'.key = 65
    $settings.bindings.goals.enabled = $false
    [void](Save-WorkbenchSettings $context $settings $script)
    $upgraded = Save-WorkbenchSettings $context (Read-WorkbenchSettings (New-WorkbenchContext (Join-Path $directory 'fresh') ($registry + '\Unused')) $pui) $otherScript -PreserveExisting
    Check ($upgraded.bindings.'quick-access'.modifiers -eq 6 -and $upgraded.bindings.'quick-access'.key -eq 65 -and -not $upgraded.bindings.goals.enabled) 'upgrade preserves account shortcuts and individual panel disable'
    Check ((Login $context) -eq (Get-WorkbenchLoginCommand $otherScript)) 'upgrade refreshes the registered installation without resetting choices'
    $settings = Read-WorkbenchSettings $context $pui; $settings.enabled = $false
    [void](Save-WorkbenchSettings $context $settings $otherScript)
    Check ($null -eq (Login $context)) 'disable removes this accounts Workbench login value'
    $defaultContext = New-WorkbenchContext (Join-Path $directory 'fresh') ($registry + '\Unused')
    $defaults = Read-WorkbenchSettings $defaultContext $pui
    $disabledUpgrade = Save-WorkbenchSettings $context $defaults $script -PreserveExisting
    Check (-not $disabledUpgrade.enabled -and $null -eq (Login $context)) 'reinstall does not re-enable an explicitly disabled account'
    $settings = Read-WorkbenchSettings $context $pui; $settings.enabled = $true
    [void](Save-WorkbenchSettings $context $settings $script)
    Check ($null -ne (Login $context)) 'explicit enable restores login registration'
    $before = [IO.File]::ReadAllText($context.File); $beforeLogin = Login $context
    $bad = $before | ConvertFrom-Json; $bad.bindings.goals.enabled = $true
    $bad.bindings.goals.modifiers = $bad.bindings.'quick-access'.modifiers
    $bad.bindings.goals.key = $bad.bindings.'quick-access'.key
    Refuses { Save-WorkbenchSettings $context $bad $script } 'duplicate enabled shortcuts are refused before writing'
    $bad = $before | ConvertFrom-Json; $bad.bindings.goals.key = 123
    Refuses { Save-WorkbenchSettings $context $bad $script } 'reserved F12 remains invalid even for a disabled panel'
    $bad = $before | ConvertFrom-Json; $bad.bindings.goals.modifiers = 16
    Refuses { Save-WorkbenchSettings $context $bad $script } 'invalid native modifier bits are refused'
    Check ([IO.File]::ReadAllText($context.File) -eq $before -and (Login $context) -eq $beforeLogin) 'invalid settings leave both persistence and login state unchanged'
    $lock = [IO.File]::Open((Join-Path $context.Directory 'workbench-windows.lock'), 'Open', 'ReadWrite', 'None')
    try { Refuses { Save-WorkbenchSettings $context $settings $script } 'concurrent settings writer cannot bypass the per-account lock' }
    finally { $lock.Dispose() }
    $broken = $context.Clone(); $broken.RunKey = 'MissingWorkbenchDrive:\Run'
    $settings.enabled = $false
    # Enabling reaches the registry write, which fails; the prior file must survive.
    $settings.enabled = $true; $settings.bindings.'quick-access'.key = 67
    Refuses { Save-WorkbenchSettings $broken $settings $script } 'registry failure is surfaced instead of accepting a partial settings update'
    Check ([IO.File]::ReadAllText($context.File) -eq $before -and (Login $context) -eq $beforeLogin) 'registry failure restores the previous settings'
    Check (-not (Send-WorkbenchEvent $context settings)) 'missing resident is reported without starting a service or touching another account'
    $event = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::AutoReset, $context.Identity + '.settings')
    try { Check ((Send-WorkbenchEvent $context settings) -and $event.WaitOne(0)) 'settings wake targets the exact account and state-directory identity' }
    finally { $event.Dispose() }
    Remove-WorkbenchRegistration $context $otherScript
    Check ((Login $context) -eq $beforeLogin) 'uninstalling another role preserves the current roles login entry'
    Remove-WorkbenchRegistration $context $script
    Check ($null -eq (Login $context) -and [IO.File]::ReadAllText($context.File) -eq $before) 'uninstall removes owned login registration and retains account preferences'
    $settings = Read-WorkbenchSettings $context $pui
    Check ($settings.bindings.'quick-access'.key -eq 65 -and -not $settings.bindings.goals.enabled) 'retained preferences survive uninstall and reinstall'
    [IO.File]::WriteAllText($context.File, '{broken')
    Refuses { Read-WorkbenchSettings $context $pui } 'corrupt preferences fail visibly instead of silently resetting shortcuts'
    if ($Resident) {
        Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
        $priorLocal = $env:LOCALAPPDATA
        $env:LOCALAPPDATA = Join-Path $directory 'resident-account'
        $residentContext = New-WorkbenchContext
        $controller = Join-Path $SourceDirectory 'workbench.ps1'
        # The fixture can exercise the real Run key only when its OWN product
        # value is absent. Never replace a real account's existing registration.
        Check ($null -eq (Login $residentContext)) 'resident fixture refuses to overwrite an existing Workbench login registration'
        $script:controllerIndex = 0
        function Run-Controller([string]$Operation) {
            if ($script:controllerIndex -ge $controllerOperations.Count -or $Operation -ne $controllerOperations[$script:controllerIndex]) {
                throw 'Controller sequence changed; update the shared lifecycle deadline contract before running it'
            }
            $script:controllerIndex++
            Trace ('controller begin ' + $Operation)
            $arguments = '-STA -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $controller + '" -Action ' + $Operation
            if ($env:PAPERCUSP_NATIVE_FIXTURE_TRACE -eq '1') {
                $command = "Set-PSDebug -Trace 1; & '" + $controller.Replace("'", "''") + "' -Action " + $Operation
                $arguments = '-STA -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' +
                    [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
            }
            $evidenceDirectory = if ($env:PAPERCUSP_NATIVE_FIXTURE_PROGRESS) {
                [IO.Path]::GetDirectoryName($env:PAPERCUSP_NATIVE_FIXTURE_PROGRESS)
            } else { $directory }
            $prefix = Join-Path $evidenceDirectory ('controller-' + $script:controllerIndex + '-' + $Operation)
            $began = [DateTime]::UtcNow
            $child = Start-Process $exe -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput ($prefix + '.out') -RedirectStandardError ($prefix + '.err') -PassThru
            $null = $child.Handle
            $identity = @{ id=$child.Id; startTicks=$child.StartTime.ToUniversalTime().Ticks }
            $deadline = [DateTime]::UtcNow.AddMilliseconds($controllerTimeoutMs)
            try {
                if (-not $child.WaitForExit($controllerTimeoutMs)) { throw ('Owned controller timed out: ' + $Operation + '; evidence: ' + $prefix) }
                if ($child.ExitCode -ne 0) {
                    $log = Join-Path $residentContext.Directory 'workbench-windows-error.log'
                    $diagnostic = if (Test-Path $log) { [IO.File]::ReadAllText($log) } else { 'no resident error log' }
                    throw ('Controller ' + $Operation + ' exited ' + $child.ExitCode + ': ' + $diagnostic)
                }
                Trace ('controller completed ' + $Operation)
            } finally {
                try {
                    $running = Get-Process -Id $identity.id -ErrorAction SilentlyContinue
                    if ($running -and $running.StartTime.ToUniversalTime().Ticks -eq $identity.startTicks) {
                        & "$env:SystemRoot\System32\taskkill.exe" /PID $identity.id /T /F 2>&1 | Out-Null
                        if (-not $running.WaitForExit(5000)) { throw 'Owned lifecycle controller did not exit after termination' }
                    }
                    $log = Join-Path $residentContext.Directory 'workbench-windows-error.log'
                    if (Test-Path -LiteralPath $log) { Copy-Item -LiteralPath $log -Destination ($prefix + '-resident.err') }
                    [IO.File]::WriteAllText(($prefix + '.json'), (@{ operation=$Operation; identity=$identity;
                        startedAt=$began.ToString('o'); deadline=$deadline.ToString('o'); finishedAt=[DateTime]::UtcNow.ToString('o');
                        stdout=($prefix + '.out'); stderr=($prefix + '.err') } | ConvertTo-Json -Depth 4 -Compress))
                } finally { $child.Dispose() }
            }
        }
        try {
            $nativeSettings = Read-WorkbenchSettings $residentContext $pui
            $nativeSettings.bindings.'quick-access'.modifiers = 7; $nativeSettings.bindings.'quick-access'.key = 121
            $nativeSettings.bindings.goals.modifiers = 7; $nativeSettings.bindings.goals.key = 120
            [void](Save-WorkbenchSettings $residentContext $nativeSettings $controller)
            Run-Controller Install
            Check (Test-WorkbenchReady $residentContext) 'actual controller starts the resident in the signed-in desktop and acknowledges native readiness'
            $residentFilter = { $_.CommandLine -and $_.CommandLine.Contains($controller) -and $_.CommandLine.Contains('-Action Run') }
            $first = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object $residentFilter)
            Run-Controller Install
            $second = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object $residentFilter)
            Check ($first.Count -eq 1 -and $second.Count -eq 1 -and $first[0].ProcessId -eq $second[0].ProcessId) 'unchanged desktop preparation preserves the same resident process'
            Run-Controller Settings
            $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, 'Papercusp Workbench settings')
            $deadline = [DateTime]::UtcNow.AddMilliseconds($settingsTimeoutMs); $window = $null
            while ($null -eq $window -and [DateTime]::UtcNow -lt $deadline) {
                $window = [Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children, $condition)
                if ($null -eq $window) { Start-Sleep -Milliseconds 100 }
            }
            Check ($null -ne $window) 'settings command reaches the resident native WPF dialog through its account event'
            Check ($null -ne $window.FindFirst([Windows.Automation.TreeScope]::Descendants,
                [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, 'Papercup shortcut'))) 'resident settings exposes the configurable Papercup shortcut'
            $enabledControl = $window.FindFirst([Windows.Automation.TreeScope]::Descendants,
                [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, 'Enable Workbench at login'))
            $toggle = $enabledControl.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern)
            $toggle.Toggle()
            $saveControl = $window.FindFirst([Windows.Automation.TreeScope]::Descendants,
                [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, 'Save'))
            $saveControl.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
            $deadline = [DateTime]::UtcNow.AddMilliseconds($settingsTimeoutMs)
            while ((Test-WorkbenchReady $residentContext) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
            Check (-not (Test-WorkbenchReady $residentContext) -and $null -eq (Login $residentContext)) 'saving native disable releases the resident and removes login registration'
            Check (-not (Read-WorkbenchSettings $residentContext $pui).enabled) 'native settings persist explicit disable'
            Run-Controller Run
            Check (-not (Test-WorkbenchReady $residentContext)) 'login invocation respects the saved disabled choice'
            Run-Controller Enable
            Check (Test-WorkbenchReady $residentContext) 'explicit enable restarts the same configured native host'
            Run-Controller Disable
            Check (-not (Test-WorkbenchReady $residentContext)) 'explicit disable waits for resident shutdown'
            Run-Controller Uninstall
            if ($script:controllerIndex -ne $controllerOperations.Count) { throw 'Lifecycle did not execute its complete controller sequence' }
            Check ($null -eq (Login $residentContext) -and [IO.File]::Exists($residentContext.File)) 'controller uninstall leaves no owned login entry and retains account choices'
        } finally {
            Stop-Workbench $residentContext
            Remove-WorkbenchRegistration $residentContext $controller
            $env:LOCALAPPDATA = $priorLocal
        }
    }
    @{ok=$true; platform='windows'; resident=[bool]$Resident; count=$cases.Count; cases=$cases.ToArray()} | ConvertTo-Json -Depth 5 -Compress
} finally {
    Remove-Item -LiteralPath $registry -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue
}
