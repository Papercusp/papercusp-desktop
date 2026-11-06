param(
    [Parameter(Mandatory=$true)][string]$Pui,
    [uint32]$QuickAccessModifiers = 3,
    [uint32]$QuickAccessKey = 32,
    [uint32]$GoalsModifiers = 3,
    [uint32]$GoalsKey = 71
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw 'Workbench requires powershell.exe -STA' }
if (-not [IO.Path]::IsPathRooted($Pui) -or -not [IO.File]::Exists($Pui)) { throw 'Select an installed PUI executable' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$created = $false
$mutex = [Threading.Mutex]::new($true, ('Local\Papercusp.Workbench.' + $identity), [ref]$created)
if (-not $created) { $mutex.Dispose(); exit 0 }
$hostInstance = $null
try {
    Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml, System.Web.Extensions
    $references = @('System.dll','System.Core.dll','System.Xaml.dll','System.Web.Extensions.dll',
        [Windows.Window].Assembly.Location, [Windows.Media.Brushes].Assembly.Location,
        [Windows.Threading.Dispatcher].Assembly.Location, [Windows.Automation.AutomationProperties].Assembly.Location)
    Add-Type -Path @((Join-Path $PSScriptRoot 'PuiReadBridge.cs'),
        (Join-Path $PSScriptRoot 'WorkbenchModel.cs'), (Join-Path $PSScriptRoot 'WorkbenchHost.cs')) -ReferencedAssemblies $references
    $application = [Windows.Application]::new()
    $application.ShutdownMode = [Windows.ShutdownMode]::OnExplicitShutdown
    $hostInstance = [Papercusp.Workbench.WorkbenchHost]::new($Pui)
    $bindings = [Collections.Generic.Dictionary[string,Papercusp.Workbench.Hotkey]]::new()
    $bindings.Add('quick-access', [Papercusp.Workbench.Hotkey]::new($QuickAccessModifiers, $QuickAccessKey))
    $bindings.Add('goals', [Papercusp.Workbench.Hotkey]::new($GoalsModifiers, $GoalsKey))
    $hostInstance.Configure($bindings)
    [void]$application.Run()
} finally {
    if ($null -ne $hostInstance) { $hostInstance.Dispose() }
    $mutex.ReleaseMutex(); $mutex.Dispose()
}
