param([Parameter(Mandatory=$true)][string]$SourceDirectory, [switch]$Resident)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest
Import-Module (Join-Path $SourceDirectory 'WorkbenchLifecycle.psm1') -Force
$directory = Join-Path $env:TEMP ('Workbench fixture ' + [Guid]::NewGuid().ToString('N') + " ' dollars `$ spaces")
$registry = 'HKCU:\Software\Papercusp\WorkbenchFixture-' + [Guid]::NewGuid().ToString('N')
$cases = [Collections.Generic.List[string]]::new()
function Check([bool]$Value, [string]$Name) {
    if (-not $Value) { throw $Name }
    $cases.Add($Name); [Console]::Error.WriteLine('PASS ' + $Name)
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
    $legacy = $settings | ConvertTo-Json -Depth 8 | ConvertFrom-Json
    $legacy.bindings.PSObject.Properties.Remove('accounts')
    $legacy.enabled = $false; $legacy.bindings.'quick-access'.key = 65; $legacy.bindings.goals.enabled = $false
    [IO.File]::WriteAllText($context.File, ($legacy | ConvertTo-Json -Depth 8))
    $migrated = Read-WorkbenchSettings $context $pui
    Check (-not $migrated.enabled -and -not $migrated.bindings.goals.enabled -and $migrated.bindings.'quick-access'.key -eq 65) 'adding Accounts preserves legacy disable and shortcut choices'
    Check ($migrated.bindings.accounts.enabled -and $migrated.bindings.accounts.key -eq 66) 'Accounts migration avoids an existing shortcut collision'
    [void](Save-WorkbenchSettings $context $settings $script -PreserveExisting)
    Check ((Read-WorkbenchSettings $context $pui).bindings.accounts.key -eq 66) 'preserve-existing installer persists the missing Accounts binding'
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
    $settings.enabled = $true; $settings.bindings.'quick-access'.key = 66
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
        function Run-Controller([string]$Operation) {
            $arguments = '-STA -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $controller + '" -Action ' + $Operation
            $child = Start-Process $exe -ArgumentList $arguments -WindowStyle Hidden -PassThru
            try {
                if (-not $child.WaitForExit(12000)) { $child.Kill(); throw ('Owned controller timed out: ' + $Operation) }
                if ($child.ExitCode -ne 0) {
                    $log = Join-Path $residentContext.Directory 'workbench-windows-error.log'
                    $diagnostic = if (Test-Path $log) { [IO.File]::ReadAllText($log) } else { 'no resident error log' }
                    throw ('Controller ' + $Operation + ' exited ' + $child.ExitCode + ': ' + $diagnostic)
                }
            } finally { $child.Dispose() }
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
            $deadline = [DateTime]::UtcNow.AddSeconds(5); $window = $null
            while ($null -eq $window -and [DateTime]::UtcNow -lt $deadline) {
                $window = [Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children, $condition)
                if ($null -eq $window) { Start-Sleep -Milliseconds 100 }
            }
            Check ($null -ne $window) 'settings command reaches the resident native WPF dialog through its account event'
            $enabledControl = $window.FindFirst([Windows.Automation.TreeScope]::Descendants,
                [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, 'Enable Workbench at login'))
            $toggle = $enabledControl.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern)
            $toggle.Toggle()
            $saveControl = $window.FindFirst([Windows.Automation.TreeScope]::Descendants,
                [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::NameProperty, 'Save'))
            $saveControl.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
            $deadline = [DateTime]::UtcNow.AddSeconds(5)
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
