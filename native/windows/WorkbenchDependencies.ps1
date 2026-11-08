# Shared by the resident controller and native fixture. Never resolve or fetch
# packages at runtime: installation must contain the exact pinned closure.
function Import-WorkbenchDependencies([string]$Directory) {
    $manifest = [IO.File]::ReadAllText((Join-Path $Directory 'dependencies.json')) | ConvertFrom-Json
    foreach ($entry in @($manifest.packages) + @($manifest.licenses)) {
        $path = Join-Path $Directory $entry.file
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $entry.sha256) {
            throw ('Workbench dependency does not match its pinned manifest: ' + $entry.file)
        }
    }
    $references = @()
    foreach ($entry in $manifest.packages) {
        $path = (Get-Item -LiteralPath (Join-Path $Directory $entry.file)).FullName
        [void][Reflection.Assembly]::LoadFrom($path)
        $references += $path
    }
    return $references
}
