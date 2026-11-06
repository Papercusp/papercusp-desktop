param(
    [Parameter(Mandatory=$true)][string]$BridgeSource,
    [ValidateSet('fixture', 'operator')][string]$Phase = 'fixture',
    [string]$PuiExecutable,
    [string]$OperatorUrl,
    [string]$ExpectedWorkspace
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$temp = Join-Path ([IO.Path]::GetTempPath()) ('workbench-bridge-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temp) | Out-Null
$passed = [Collections.Generic.List[string]]::new()
function Assert-True($Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Read-Fixture([string]$Mode, [Threading.CancellationToken]$Token = [Threading.CancellationToken]::None, [int]$Timeout = 5000) {
    $arguments = [Collections.Generic.Dictionary[string,object]]::new()
    $arguments.Add('mode', $Mode)
    $arguments.Add('identity', "same +/=& ' `$() " + [char]0x03bb + [char]0x4e2d)
    $arguments.Add('pidFile', (Join-Path $temp ($Mode + '.pid')))
    return [Papercusp.Workbench.PuiReadBridge]::ReadAsync($pui, 'reports.get', $arguments, $Token, $Timeout)
}
function Assert-Fails($Task, [string]$Pattern) {
    try {
        # ReadAsync rejects unsupported models synchronously, before returning
        # a Task. Keep that refusal inside the same expected-failure boundary.
        if ($Task -is [scriptblock]) { $Task = & $Task }
        $Task.GetAwaiter().GetResult() | Out-Null
    }
    catch {
        Assert-True ($_.Exception.ToString() -match $Pattern) $_.Exception.ToString()
        return
    }
    throw "Expected failure: $Pattern"
}
function Assert-Reaped([string]$Mode) {
    $pidFile = Join-Path $temp ($Mode + '.pid')
    Assert-True (Test-Path -LiteralPath $pidFile) ('Fixture did not start: ' + $Mode)
    $childId = [int][IO.File]::ReadAllText($pidFile)
    Assert-True ($null -eq (Get-Process -Id $childId -ErrorAction SilentlyContinue)) ('Helper survived: ' + $childId)
}
try {
    Add-Type -Path $BridgeSource -ReferencedAssemblies System.Web.Extensions
    if ($Phase -eq 'operator') {
        if (-not [IO.File]::Exists($PuiExecutable) -or -not $OperatorUrl -or -not $ExpectedWorkspace) {
            throw 'Operator phase requires the actual PUI, explicit operator URL and expected workspace'
        }
        $env:PUI_OPERATOR = $OperatorUrl; $env:PAPERCUSP_OPERATOR_URL = $OperatorUrl
        $emptyArgs = [Collections.Generic.Dictionary[string,object]]::new()
        $identity = [Papercusp.Workbench.PuiReadBridge]::ReadAsync($PuiExecutable, 'operator.identity', $emptyArgs,
            [Threading.CancellationToken]::None, 22000).GetAwaiter().GetResult()['rows'][0]
        Assert-True ($identity['endpoint'].TrimEnd('/') -ceq $OperatorUrl.TrimEnd('/') -and
            $identity['workspaceId'] -ceq $ExpectedWorkspace -and $identity['store']['id']) 'PUI selected a different backend'
        $passed.Add('actual PUI selects the expected endpoint workspace and store')
        $models = [Collections.Generic.List[object]]::new()
        foreach ($model in @('plans.list', 'advRoster.list', 'reports.list', 'goals.list')) {
            $payload = [Papercusp.Workbench.PuiReadBridge]::ReadAsync($PuiExecutable, $model, $emptyArgs,
                [Threading.CancellationToken]::None, 22000, $identity).GetAwaiter().GetResult()
            Assert-True ($payload.ContainsKey('rows') -and $payload.ContainsKey('version')) ('Missing canonical envelope: ' + $model)
            $models.Add(@{name=$model; rows=$payload['rows'].Count; version=$payload['version']})
            $passed.Add('actual canonical ' + $model + ' envelope and version preserved')
        }
        $wrong = [Collections.Generic.Dictionary[string,object]]::new($identity)
        $wrong['workspaceId'] = $ExpectedWorkspace + '-negative-control'
        Assert-Fails ([Papercusp.Workbench.PuiReadBridge]::ReadAsync($PuiExecutable, 'plans.list', $emptyArgs,
            [Threading.CancellationToken]::None, 22000, $wrong)) 'selected environment changed'
        $passed.Add('actual PUI refuses a different selected workspace before reading')
        [pscustomobject]@{ok=$true; platform='windows'; phase=$Phase; cases=$passed.ToArray(); count=$passed.Count;
            environment=$identity; models=$models.ToArray(); puiSha256=(Get-FileHash -LiteralPath $PuiExecutable -Algorithm SHA256).Hash.ToLowerInvariant();
            scope='actual-PUI-canonical-operator-read-only'} | ConvertTo-Json -Depth 12 -Compress
        return
    }
    $pui = Join-Path $temp "pui ' literal.exe"
    # Compile a real native child. It deliberately changes the console encoding;
    # only byte-exact redirected pipe framing can preserve the returned Unicode.
    Add-Type -OutputAssembly $pui -OutputType ConsoleApplication -ReferencedAssemblies System.Web.Extensions -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
public static class NativeFixture {
    public static int Main(string[] argv) {
        if (argv.Length != 1 || argv[0] != "native-read") return 23;
        var utf8 = new UTF8Encoding(false, true);
        Console.OutputEncoding = Encoding.GetEncoding(437);
        var json = new JavaScriptSerializer();
        var input = new StreamReader(Console.OpenStandardInput(), utf8).ReadToEnd();
        var request = json.Deserialize<Dictionary<string, object>>(input);
        var args = (Dictionary<string, object>)request["args"];
        var mode = (string)args["mode"];
        File.WriteAllText((string)args["pidFile"], Process.GetCurrentProcess().Id.ToString());
        if (mode == "timeout" || mode == "cancel") Thread.Sleep(60000);
        if (mode == "exit") { Console.Error.Write("canonical ACL refused"); return 7; }
        if (mode == "stderr") Console.Error.Write(new string('x', 100000));
        var output = mode == "malformed" ? "{" : mode == "missing" ? "{}" :
            mode == "badrows" ? "{\"rows\":{}}" : mode == "denied" ? "{\"rows\":[],\"ok\":false}" :
            mode == "oversize" ? new string('x', 17 * 1024 * 1024) :
            mode == "empty" ? "{\"rows\":[],\"version\":\"exact-empty\"}" :
            json.Serialize(new { rows = new object[] { request }, version = "canonical-version" });
        var bytes = utf8.GetBytes(output);
        Console.OpenStandardOutput().Write(bytes, 0, bytes.Length);
        return 0;
    }
}
'@
    $payload = (Read-Fixture 'unicode').GetAwaiter().GetResult()
    $row = $payload['rows'][0]
    Assert-True ($row['name'] -ceq 'reports.get') 'Read model changed'
    Assert-True ($row['args']['identity'] -ceq ("same +/=& ' `$() " + [char]0x03bb + [char]0x4e2d)) 'Canonical identity recoded'
    Assert-True ($payload['version'] -ceq 'canonical-version') 'Canonical version lost'
    Assert-Reaped 'unicode'
    $passed.Add('literal executable path and Unicode identity round-trip')
    $empty = (Read-Fixture 'empty').GetAwaiter().GetResult()
    Assert-True ($empty['rows'].Count -eq 0 -and $empty['version'] -ceq 'exact-empty') 'Empty rows confused with unavailable'
    $passed.Add('canonical empty result preserved')
    foreach ($mode in @('malformed','missing','badrows','denied','exit','oversize')) {
        Assert-Fails (Read-Fixture $mode) 'invalid|unavailable|JSON|ACL refused|limit|length|serialize'
        Assert-Reaped $mode
        $passed.Add('reject ' + $mode)
    }
    $stderr = (Read-Fixture 'stderr').GetAwaiter().GetResult()
    Assert-True ($stderr['rows'].Count -eq 1) 'Concurrent stderr pipe blocked stdout'
    $passed.Add('large stderr drains concurrently')
    Assert-Fails (Read-Fixture 'timeout' ([Threading.CancellationToken]::None) 1200) 'time'
    Assert-Reaped 'timeout'
    $passed.Add('timeout reaps only owned PUI helper')
    $cancel = [Threading.CancellationTokenSource]::new()
    try {
        $pending = Read-Fixture 'cancel' $cancel.Token
        $until = [DateTime]::UtcNow.AddSeconds(4)
        while (-not (Test-Path -LiteralPath (Join-Path $temp 'cancel.pid'))) {
            if ([DateTime]::UtcNow -ge $until) { throw 'Cancellation fixture did not start' }
            Start-Sleep -Milliseconds 20
        }
        $cancel.Cancel()
        Assert-Fails $pending 'cancel'
        Assert-Reaped 'cancel'
    } finally { $cancel.Dispose() }
    $passed.Add('cancellation reaps owned helper')
    $arguments = [Collections.Generic.Dictionary[string,object]]::new()
    $arguments.Add('query', ('x' * 70000))
    Assert-Fails ([Papercusp.Workbench.PuiReadBridge]::ReadAsync($pui, 'reports.list', $arguments, [Threading.CancellationToken]::None)) '64 KiB'
    Assert-Fails { [Papercusp.Workbench.PuiReadBridge]::ReadAsync($pui, 'goals.pause', $null, [Threading.CancellationToken]::None) } 'Unsupported'
    $passed.Add('oversized request and mutation rejected before spawn')
    [pscustomobject]@{ok=$true; platform='windows'; cases=$passed.ToArray(); count=$passed.Count} | ConvertTo-Json -Depth 8 -Compress
} finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
