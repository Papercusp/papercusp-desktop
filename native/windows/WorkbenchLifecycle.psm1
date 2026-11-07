Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Reuse Windows' per-account Run registration. No service, elevated task, or
# second operator is needed; this process belongs to the interactive account.
function New-WorkbenchContext {
    param([string]$StateDirectory = (Join-Path $env:LOCALAPPDATA 'papercusp'),
        [string]$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run')
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $scope = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes(
        [IO.Path]::GetFullPath($StateDirectory).ToLowerInvariant()))).Replace('-', '').Substring(0, 16) }
    finally { $hash.Dispose() }
    return @{ Directory = $StateDirectory; File = (Join-Path $StateDirectory 'workbench-windows.json');
        RunKey = $RunKey; RunName = 'Papercusp Workbench'; Identity = ('Local\Papercusp.Workbench.' + $sid + '.' + $scope) }
}

function Test-WorkbenchSettings {
    param($Settings)
    if ($Settings.schemaVersion -ne 1 -or $Settings.enabled -isnot [bool]) { throw 'Invalid Workbench settings version or enabled value' }
    if (-not [IO.Path]::IsPathRooted($Settings.pui) -or -not [IO.File]::Exists($Settings.pui)) {
        throw 'Select an installed PUI executable'
    }
    $seen = @{}
    foreach ($name in @('quick-access', 'goals', 'accounts', 'inbox')) {
        $binding = $Settings.bindings.$name
        if ($binding.enabled -isnot [bool]) { throw 'Invalid panel enabled value' }
        # Validate disabled bindings too, so re-enabling cannot resurrect an
        # invalid accelerator. F12 is reserved by Windows for debuggers.
        if ($binding.modifiers -isnot [int] -or $binding.key -isnot [int] -or
            $binding.modifiers -lt 0 -or $binding.modifiers -gt 15 -or
            $binding.key -lt 1 -or $binding.key -gt 254 -or $binding.key -eq 123) {
            throw 'Choose a valid shortcut; Windows reserves F12 for debuggers'
        }
        if ($binding.enabled) {
            $identity = [string]$binding.modifiers + ':' + [string]$binding.key
            if ($seen.ContainsKey($identity)) { throw 'Each enabled panel needs a different shortcut' }
            $seen[$identity] = $true
        }
    }
}

function Complete-WorkbenchSettings {
    param($Settings)
    # Add the new panel to existing per-account settings without resetting any
    # shortcut or disable choice. Choose a free accelerator if A is already used.
    foreach ($name in @('accounts', 'inbox')) {
        if ($null -eq $Settings.bindings.PSObject.Properties[$name]) {
            $used = @($Settings.bindings.PSObject.Properties | Where-Object { $_.Value.enabled } |
                ForEach-Object { [string]$_.Value.modifiers + ':' + [string]$_.Value.key })
            $preferred = if ($name -eq 'inbox') { 66 } else { 65 }
            $available = @(@($preferred) + @(65..90 | Where-Object { $_ -ne $preferred }) |
                Where-Object { ('3:' + $_) -notin $used })
            if ($available.Count -eq 0) { throw "No free default $name shortcut; configure existing shortcuts first" }
            $Settings.bindings | Add-Member -NotePropertyName $name -NotePropertyValue (
                [pscustomobject]@{ enabled = $true; modifiers = 3; key = [int]$available[0] })
        }
    }
    return $Settings
}

function Read-WorkbenchSettings {
    param($Context, [string]$Pui)
    if ([IO.File]::Exists($Context.File)) {
        $settings = [IO.File]::ReadAllText($Context.File) | ConvertFrom-Json
    } else {
        $settings = [pscustomobject]@{ schemaVersion = 1; enabled = $true; pui = $Pui; bindings = [pscustomobject]@{
            'quick-access' = [pscustomobject]@{ enabled = $true; modifiers = 3; key = 32 };
            goals = [pscustomobject]@{ enabled = $true; modifiers = 3; key = 71 } } }
    }
    $settings = Complete-WorkbenchSettings $settings
    Test-WorkbenchSettings $settings
    return $settings
}

function Get-WorkbenchLoginCommand {
    param([string]$ScriptPath)
    if (-not [IO.Path]::IsPathRooted($ScriptPath) -or -not [IO.File]::Exists($ScriptPath) -or $ScriptPath.Contains('"')) {
        throw 'Select an installed Workbench script'
    }
    # Arguments are fixed; paths are quoted, never evaluated as PowerShell.
    return '"' + $env:SystemRoot + '\System32\WindowsPowerShell\v1.0\powershell.exe" -STA -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $ScriptPath + '" -Action Run'
}

function Save-WorkbenchSettings {
    param($Context, $Settings, [string]$ScriptPath, [switch]$PreserveExisting)
    Test-WorkbenchSettings $Settings
    $command = Get-WorkbenchLoginCommand $ScriptPath
    [void][IO.Directory]::CreateDirectory($Context.Directory)
    # GUI and Server may prepare the same account together. Serialize both the
    # config and its Run value, including readers that modify these settings.
    $lock = [IO.File]::Open((Join-Path $Context.Directory 'workbench-windows.lock'),
        [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $temporary = $Context.File + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
    $backup = $temporary + '.previous'
    try {
        $previous = if ([IO.File]::Exists($Context.File)) { [IO.File]::ReadAllText($Context.File) } else { $null }
        if ($PreserveExisting -and $null -ne $previous) {
            $Settings = Complete-WorkbenchSettings ($previous | ConvertFrom-Json)
            Test-WorkbenchSettings $Settings
        }
        [IO.File]::WriteAllText($temporary, ($Settings | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
        # Windows PowerShell converts $null to an empty String for this .NET
        # overload. A real owned backup path also gives atomic rollback.
        if ([IO.File]::Exists($Context.File)) { [IO.File]::Replace($temporary, $Context.File, $backup) }
        else { [IO.File]::Move($temporary, $Context.File) }
        try {
            if ($Settings.enabled) {
                if (-not (Test-Path -LiteralPath $Context.RunKey -ErrorAction Stop)) {
                    [void](New-Item -Path $Context.RunKey -Force)
                }
                [void](New-ItemProperty -Path $Context.RunKey -Name $Context.RunName -Value $command -PropertyType String -Force)
            } else {
                if ((Test-Path -LiteralPath $Context.RunKey -ErrorAction Stop) -and
                    (Get-Item -LiteralPath $Context.RunKey).GetValueNames().Contains($Context.RunName)) {
                    Remove-ItemProperty -Path $Context.RunKey -Name $Context.RunName -ErrorAction Stop
                }
            }
        } catch {
            if ($null -eq $previous) { [IO.File]::Delete($Context.File) }
            else { [IO.File]::Replace($backup, $Context.File, $temporary) }
            throw
        }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
        if ([IO.File]::Exists($backup)) { [IO.File]::Delete($backup) }
        $lock.Dispose()
    }
    return $Settings
}

function Send-WorkbenchEvent {
    param($Context, [ValidateSet('stop', 'settings')][string]$Name)
    $event = $null
    try { $event = [Threading.EventWaitHandle]::OpenExisting($Context.Identity + '.' + $Name); [void]$event.Set(); return $true }
    catch [Threading.WaitHandleCannotBeOpenedException] { return $false }
    finally { if ($null -ne $event) { $event.Dispose() } }
}

function Test-WorkbenchReady {
    param($Context)
    $event = $null
    try { $event = [Threading.EventWaitHandle]::OpenExisting($Context.Identity + '.ready'); return $event.WaitOne(0) }
    catch [Threading.WaitHandleCannotBeOpenedException] { return $false }
    finally { if ($null -ne $event) { $event.Dispose() } }
}

function Stop-Workbench {
    param($Context)
    if (-not (Send-WorkbenchEvent $Context stop)) { return }
    $mutex = $null
    try {
        $mutex = [Threading.Mutex]::OpenExisting($Context.Identity)
        if (-not $mutex.WaitOne(5000)) { throw 'Workbench has not stopped; close its settings window and retry' }
        $mutex.ReleaseMutex()
    } catch [Threading.WaitHandleCannotBeOpenedException] { }
    catch [Threading.AbandonedMutexException] { $mutex.ReleaseMutex() }
    finally { if ($null -ne $mutex) { $mutex.Dispose() } }
}

function Remove-WorkbenchRegistration {
    param($Context, [string]$ScriptPath)
    $entry = Get-ItemProperty -Path $Context.RunKey -Name $Context.RunName -ErrorAction SilentlyContinue
    if ($null -eq $entry) { return }
    # GUI and Server can coexist. Removing one role cannot remove the other
    # role's registration. Keep explicit enable/disable and shortcuts on disk.
    if ($entry.($Context.RunName) -ne (Get-WorkbenchLoginCommand $ScriptPath)) { return }
    Stop-Workbench $Context
    Remove-ItemProperty -Path $Context.RunKey -Name $Context.RunName
}

Export-ModuleMember -Function New-WorkbenchContext, Read-WorkbenchSettings, Test-WorkbenchSettings,
    Save-WorkbenchSettings, Get-WorkbenchLoginCommand, Send-WorkbenchEvent, Stop-Workbench, Remove-WorkbenchRegistration, Test-WorkbenchReady
