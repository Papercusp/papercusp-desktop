param(
    [string]$Pui,
    [ValidateSet('Run', 'Install', 'Enable', 'Disable', 'Settings', 'Status', 'Uninstall')][string]$Action = 'Run'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw 'Workbench requires powershell.exe -STA' }
Import-Module (Join-Path $PSScriptRoot 'WorkbenchLifecycle.psm1') -Force
$context = New-WorkbenchContext
if ($Action -eq 'Uninstall') { Remove-WorkbenchRegistration $context $PSCommandPath; return }
$settings = Read-WorkbenchSettings $context $Pui
if ($Action -eq 'Status') { $settings | ConvertTo-Json -Depth 8; return }
if ($Action -eq 'Disable') {
    $settings.enabled = $false
    [void](Save-WorkbenchSettings $context $settings $PSCommandPath)
    Stop-Workbench $context
    return
}
if ($Action -in @('Install', 'Enable')) {
    if ($Action -eq 'Enable') { $settings.enabled = $true }
    $settings = Save-WorkbenchSettings $context $settings $PSCommandPath -PreserveExisting:($Action -eq 'Install')
    # Refresh the resident source on an upgrade. Explicitly disabled accounts
    # remain disabled; installing never flips their choice back on.
    $bundleHash = ((@('PuiReadBridge.cs', 'WorkbenchModel.cs', 'WorkbenchHost.cs', 'WorkbenchLifecycle.psm1', 'workbench.ps1') |
        ForEach-Object { (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $_) -Algorithm SHA256).Hash }) -join ':')
    $marker = Join-Path $context.Directory 'workbench-windows.sha256'
    $unchanged = [IO.File]::Exists($marker) -and [IO.File]::ReadAllText($marker) -eq $bundleHash
    if (-not $unchanged) { Stop-Workbench $context }
    if ($settings.enabled) {
        if ($unchanged -and (Test-WorkbenchReady $context)) { return }
        $command = Get-WorkbenchLoginCommand $PSCommandPath
        $executable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $child = Start-Process -FilePath $executable -ArgumentList $command.Substring($command.IndexOf('" ', 1) + 2) -WindowStyle Hidden -PassThru
        try {
            $deadline = [DateTime]::UtcNow.AddSeconds(8)
            while (-not (Test-WorkbenchReady $context)) {
                if ($child.HasExited) { throw ('Resident Workbench exited before readiness: ' + $child.ExitCode) }
                if ([DateTime]::UtcNow -gt $deadline) { throw 'Resident Workbench did not acknowledge readiness; inspect workbench-windows-error.log' }
                Start-Sleep -Milliseconds 100
            }
        } finally { $child.Dispose() }
    }
    [IO.File]::WriteAllText($marker, $bundleHash)
    return
}
if ($Action -eq 'Settings' -and (Send-WorkbenchEvent $context settings)) { return }
if (-not $settings.enabled -and $Action -ne 'Settings') { return }
$created = $false
$mutex = [Threading.Mutex]::new($true, $context.Identity, [ref]$created)
if (-not $created) { $mutex.Dispose(); exit 0 }
$hostInstance = $null
$timer = $null
$stopEvent = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::AutoReset, $context.Identity + '.stop')
$settingsEvent = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::AutoReset, $context.Identity + '.settings')
$readyEvent = [Threading.EventWaitHandle]::new($false, [Threading.EventResetMode]::ManualReset, $context.Identity + '.ready')
try {
    Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml, System.Web.Extensions
    $references = @('System.dll','System.Core.dll','System.Xaml.dll','System.Web.Extensions.dll',
        [Windows.Window].Assembly.Location, [Windows.Media.Brushes].Assembly.Location,
        [Windows.Threading.Dispatcher].Assembly.Location, [Windows.Automation.AutomationProperties].Assembly.Location)
    Add-Type -Path @((Join-Path $PSScriptRoot 'PuiReadBridge.cs'),
        (Join-Path $PSScriptRoot 'WorkbenchModel.cs'), (Join-Path $PSScriptRoot 'WorkbenchHost.cs')) -ReferencedAssemblies $references
    $application = [Windows.Application]::new()
    $application.ShutdownMode = [Windows.ShutdownMode]::OnExplicitShutdown
    $hostInstance = [Papercusp.Workbench.WorkbenchHost]::new($settings.pui)
    function Get-Bindings($value) {
        $bindings = [Collections.Generic.Dictionary[string,Papercusp.Workbench.Hotkey]]::new()
        foreach ($name in @('quick-access', 'goals', 'accounts', 'inbox', 'organizer')) {
            if ($value.enabled -and $value.bindings.$name.enabled) {
                $bindings.Add($name, [Papercusp.Workbench.Hotkey]::new($value.bindings.$name.modifiers, $value.bindings.$name.key))
            }
        }
        return ,$bindings
    }
    $hostInstance.Configure((Get-Bindings $settings))
    function Show-WorkbenchSettings {
        # Use the same native WPF controls as the panels; the registry contains
        # web components only. Capture accelerators rather than parsing prose.
        $window = [Windows.Window]::new()
        $window.Title = 'Papercusp Workbench settings'; $window.SizeToContent = 'WidthAndHeight'
        $window.WindowStartupLocation = 'CenterScreen'; $window.ResizeMode = 'NoResize'
        $layout = [Windows.Controls.StackPanel]::new(); $layout.Margin = [Windows.Thickness]::new(20); $window.Content = $layout
        $enabled = [Windows.Controls.CheckBox]::new(); $enabled.Content = 'Enable Workbench at login'; $enabled.IsChecked = $settings.enabled
        [void]$layout.Children.Add($enabled)
        $entries = @{}
        foreach ($name in @('quick-access', 'goals', 'accounts', 'inbox', 'organizer')) {
            $label = [Windows.Controls.CheckBox]::new()
            $label.Content = if ($name -eq 'quick-access') { 'Quick Access shortcut' } elseif ($name -eq 'goals') { 'Goals shortcut' } elseif ($name -eq 'inbox') { 'Inbox shortcut' } elseif ($name -eq 'organizer') { 'Organizer shortcut' } else { 'Accounts shortcut' }
            $label.IsChecked = $settings.bindings.$name.enabled; $label.Margin = [Windows.Thickness]::new(0, 12, 0, 4)
            [void]$layout.Children.Add($label)
            $entry = [Windows.Controls.TextBox]::new(); $entry.MinWidth = 340; $entry.IsReadOnly = $true
            $entry.Tag = @{ modifiers = $settings.bindings.$name.modifiers; key = $settings.bindings.$name.key }
            $entry.Text = [Papercusp.Workbench.Hotkey]::new($entry.Tag.modifiers, $entry.Tag.key).Identity + ' (press a shortcut to change)'
            $entry.Add_PreviewKeyDown({
                param($sender, $event)
                $key = if ($event.Key -eq [Windows.Input.Key]::System) { $event.SystemKey } else { $event.Key }
                if ($key -in @('LeftCtrl', 'RightCtrl', 'LeftAlt', 'RightAlt', 'LeftShift', 'RightShift', 'LWin', 'RWin')) { return }
                $modifiers = [Windows.Input.Keyboard]::Modifiers
                $native = 0
                if ($modifiers -band [Windows.Input.ModifierKeys]::Alt) { $native = $native -bor 1 }
                if ($modifiers -band [Windows.Input.ModifierKeys]::Control) { $native = $native -bor 2 }
                if ($modifiers -band [Windows.Input.ModifierKeys]::Shift) { $native = $native -bor 4 }
                if ($modifiers -band [Windows.Input.ModifierKeys]::Windows) { $native = $native -bor 8 }
                $sender.Tag = @{ modifiers = $native; key = [Windows.Input.KeyInterop]::VirtualKeyFromKey($key) }
                $sender.Text = $modifiers.ToString() + '+' + $key.ToString(); $event.Handled = $true
            })
            [void]$layout.Children.Add($entry); $entries[$name] = @{ enabled = $label; shortcut = $entry }
        }
        $errorText = [Windows.Controls.TextBlock]::new(); $errorText.TextWrapping = 'Wrap'; $errorText.MaxWidth = 400
        $errorText.Foreground = [Windows.Media.Brushes]::DarkRed; [void]$layout.Children.Add($errorText)
        $save = [Windows.Controls.Button]::new(); $save.Content = 'Save'; $save.Margin = [Windows.Thickness]::new(0, 12, 0, 0)
        $save.Add_Click({
            try {
                $next = $settings | ConvertTo-Json -Depth 8 | ConvertFrom-Json
                $next.enabled = [bool]$enabled.IsChecked
                foreach ($name in @('quick-access', 'goals', 'accounts', 'inbox', 'organizer')) {
                    $next.bindings.$name.enabled = [bool]$entries[$name].enabled.IsChecked
                    $next.bindings.$name.modifiers = $entries[$name].shortcut.Tag.modifiers
                    $next.bindings.$name.key = $entries[$name].shortcut.Tag.key
                }
                Test-WorkbenchSettings $next
                $hostInstance.Configure((Get-Bindings $next))
                try { [void](Save-WorkbenchSettings $context $next $PSCommandPath) }
                catch { $hostInstance.Configure((Get-Bindings $settings)); throw }
                $script:settings = $next
                $window.Close()
                if (-not $next.enabled) { $application.Shutdown() }
            } catch { $errorText.Text = $_.Exception.Message }
        })
        [void]$layout.Children.Add($save)
        [void]$window.ShowDialog()
    }
    $timer = [Windows.Threading.DispatcherTimer]::new(); $timer.Interval = [TimeSpan]::FromMilliseconds(150)
    $timer.Add_Tick({
        if ($stopEvent.WaitOne(0)) { $application.Shutdown() }
        elseif ($settingsEvent.WaitOne(0)) { Show-WorkbenchSettings }
    })
    $timer.Start()
    [void]$readyEvent.Set()
    if ($Action -eq 'Settings') { [void]$settingsEvent.Set() }
    [void]$application.Run()
} catch {
    [void][IO.Directory]::CreateDirectory($context.Directory)
    [IO.File]::AppendAllText((Join-Path $context.Directory 'workbench-windows-error.log'),
        [DateTime]::UtcNow.ToString('o') + ' ' + $_.Exception.ToString() + [Environment]::NewLine)
    throw
} finally {
    if ($null -ne $timer) { $timer.Stop() }
    if ($null -ne $hostInstance) { $hostInstance.Dispose() }
    [void]$readyEvent.Reset(); $readyEvent.Dispose(); $stopEvent.Dispose(); $settingsEvent.Dispose()
    $mutex.ReleaseMutex(); $mutex.Dispose()
}
