param([Parameter(Mandatory=$true)][int]$GuiPid, [Parameter(Mandatory=$true)][string]$GuiTitle, [Parameter(Mandatory=$true)][int]$TargetPid, [Parameter(Mandatory=$true)][guid]$ClientId, [switch]$SetupOnly, [ValidateSet('all','same-desktop','minimized','other-desktop')][string]$Case='all', [string]$CleanupOwnedDesktops='', [guid]$ProtectedDesktop=[guid]::Empty)
# Run through an Interactive scheduled task in the reserved Windows test VM.
# Only setup uses Win32 activation/keys. Every measured focus goes through the
# real WSL operator HTTP route, its UI-intent stream and the native GUI handler.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$dir = Join-Path $env:TEMP 'papercusp-focus-449b1'
$receipt = Join-Path $dir 'wsl-acceptance.json'
$out = @{ cases=@(); completed=$false; error=$null; createdDesktop=$null; attemptId=[guid]::NewGuid().ToString(); startedAtUtc=[DateTime]::UtcNow.ToString('o') }
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
[ComImport,Guid("A5CD92FF-29BE-454C-8D04-D82879FB3F1B"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface VDFocusWitness {
 [PreserveSig] int IsWindowOnCurrentVirtualDesktop(IntPtr h,[MarshalAs(UnmanagedType.Bool)]out bool current);
 [PreserveSig] int GetWindowDesktopId(IntPtr h,out Guid desktop);
 [PreserveSig] int MoveWindowToDesktop(IntPtr h,[MarshalAs(UnmanagedType.LPStruct)]Guid desktop);
}
[ComImport,Guid("AA509086-5CA9-4C25-8F95-589D3C07B48A")]public class VDFocusManager {}
public class FocusWitness {
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 public delegate bool EnumProc(IntPtr h,IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc fn,IntPtr p);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder text,int n);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int command);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(uint pid);
 [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h,bool altTab);
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect rect);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h,uint flags);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int cx,int cy,uint flags);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr CreateWindowEx(uint ex,string cls,string title,uint style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr data);
 [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
 [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h,int attribute,out int value,int size);
 public static IntPtr Window(int pid,string title) {
   IntPtr found=IntPtr.Zero;int count=0;
   EnumWindows((h,p)=>{uint owner;GetWindowThreadProcessId(h,out owner);var text=new StringBuilder(4096);GetWindowText(h,text,text.Capacity);
     if(owner==pid && (title==null ? text.Length>0 && IsWindowVisible(h) : text.ToString()==title)){found=h;count++;}return true;},IntPtr.Zero);
   if(count!=1)throw new Exception("Expected one exact native window, got "+count+" for pid "+pid);return found;
 }
 public static object Observe(IntPtr h) {
   var manager=(VDFocusWitness)new VDFocusManager();bool current;Guid desktop;int cloaked;
   int ch=manager.IsWindowOnCurrentVirtualDesktop(h,out current),dh=manager.GetWindowDesktopId(h,out desktop),wh=DwmGetWindowAttribute(h,14,out cloaked,4);
   if(ch!=0||dh!=0||wh!=0)throw new Exception("Native witness query failed");
   return new {hwnd=h.ToInt64(),foreground=GetForegroundWindow().ToInt64(),desktop=desktop.ToString(),current=current,minimized=IsIconic(h),visible=IsWindowVisible(h),cloaked=cloaked};
 }
 public static void DesktopKey(byte key) {
   keybd_event(0x5b,0,0,UIntPtr.Zero);keybd_event(0x11,0,0,UIntPtr.Zero);keybd_event(key,0,0,UIntPtr.Zero);
   keybd_event(key,0,2,UIntPtr.Zero);keybd_event(0x11,0,2,UIntPtr.Zero);keybd_event(0x5b,0,2,UIntPtr.Zero);
 }
 public static IntPtr OpenDesktopProbe() {
   // Desktop switches may legitimately leave GetForegroundWindow()==NULL.
   // A newly created fixture window provides an independent current-desktop
   // identity without assuming that Explorer has activated another window.
   IntPtr h=CreateWindowEx(0,"STATIC","Papercusp-Focus-449b1-DesktopProbe",0x10CF0000,100,100,200,120,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
   if(h==IntPtr.Zero)throw new Exception("Desktop probe creation failed");
   return h;
 }
 public static string DesktopId(IntPtr h) {
     Guid desktop=Guid.Empty;int hr=0;var manager=(VDFocusWitness)new VDFocusManager();
     for(int n=0;n<20;n++){hr=manager.GetWindowDesktopId(h,out desktop);if(hr==0&&desktop!=Guid.Empty)return desktop.ToString();System.Threading.Thread.Sleep(50);}
     throw new Exception("Desktop probe identity unavailable: HRESULT="+hr.ToString("X8")+", GUID="+desktop);
 }
 public static string CurrentDesktopId() {
   IntPtr h=OpenDesktopProbe();
   try { return DesktopId(h); }
   finally {DestroyWindow(h);}
 }
 public static bool ClickOwnedCaption(IntPtr h) {
   Rect rect;Point old;
   if(!GetWindowRect(h,out rect)||!GetCursorPos(out old)||rect.Right-rect.Left<150||rect.Bottom-rect.Top<100)return false;
   var point=new Point{X=rect.Left+(rect.Right-rect.Left)/2,Y=rect.Top+12};
   // Fixture setup only. A real click grants input focus; neither a scheduled
   // task nor AllowSetForegroundWindow alone creates a user's input gesture.
   SetWindowPos(h,new IntPtr(-1),0,0,0,0,0x13);
   try {
     if(GetAncestor(WindowFromPoint(point),2)!=h)return false;
     if(!SetCursorPos(point.X,point.Y))return false;
     mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);
     return true;
   } finally { SetWindowPos(h,new IntPtr(-2),0,0,0,0,0x13);SetCursorPos(old.X,old.Y); }
 }
}
'@
function Save-Receipt { $out | ConvertTo-Json -Depth 14 | Set-Content -Encoding UTF8 $receipt }
function Install-FocusTrace {
  # Own the instrumentation before the first measured request. Previously the
  # finalizer silently depended on a recorder installed by an external driver.
  $installTraceJs=@'
(() => {
  window.__focusTraceRestore?.();
  const internals = window.__TAURI_INTERNALS__;
  const callbacks = internals?.callbacks;
  if (!callbacks || typeof callbacks.set !== 'function' || typeof callbacks.entries !== 'function') {
    throw new Error('native callback instrumentation unavailable');
  }
  const trace = window.__focusTrace = [];
  const record = (entry) => {
    try {
      trace.push({ t: Date.now(), ...entry });
      if (trace.length > 300) trace.splice(0, trace.length - 300);
    } catch { /* diagnostics must not change native delivery */ }
  };
  // Tauri defines runCallback/invoke as non-writable and non-configurable.
  // Its documented debug registry is mutable; wrap its values, including
  // callbacks registered after setup, without replacing those native methods.
  const originalSet = callbacks.set;
  const ownSet = Object.getOwnPropertyDescriptor(callbacks, 'set');
  const originals = new WeakMap();
  const wrap = (id, original) => {
    if (typeof original !== 'function') return original;
    function callback(message) {
      // Metadata only: never retain response bodies, arguments or tokens.
      record({ kind: 'callback', id, index: message?.index,
        event: message?.message?.name, terminal: message?.message?.kind });
      try { return original.apply(this, arguments); }
      catch (error) {
        record({ kind: 'callback-error', id, error: String(error?.name ?? 'Error') });
        throw error;
      }
    }
    originals.set(callback, original);
    return callback;
  };
  function set(id, callback) {
    return originalSet.call(this, id, this === callbacks ? wrap(id, callback) : callback);
  }
  callbacks.set = set;
  if (callbacks.set !== set) throw new Error('native callback registry is not instrumentable');
  for (const [id, callback] of callbacks.entries()) originalSet.call(callbacks, id, wrap(id, callback));
  window.__focusTraceRestore = () => {
    if (callbacks.set === set) {
      if (ownSet) Object.defineProperty(callbacks, 'set', ownSet);
      else delete callbacks.set;
    }
    for (const [id, callback] of callbacks.entries()) {
      if (originals.has(callback)) originalSet.call(callbacks, id, originals.get(callback));
    }
    delete window.__focusTraceRestore;
  };
  return { ready: true, at: Date.now() };
})()
'@
  $bridge=Get-Content (Join-Path $env:TEMP ('tauri-dev-bridge-'+$GuiPid+'.token')) | ConvertFrom-Json
  $out.traceSetup=Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:'+$bridge.port+'/eval') -ContentType 'application/json' -Body (@{token=$bridge.token;js=$installTraceJs}|ConvertTo-Json -Compress) -TimeoutSec 8
  $ready=$out.traceSetup.result
  if($ready -is [string]){$ready=$ready|ConvertFrom-Json}
  if($ready.ready -ne $true){throw 'Native callback trace was not installed'}
}
function Save-FocusDiagnostics {
  # These bridge reads do not execute JS. They remain useful when /eval itself
  # is the stalled path. Save before desktop cleanup or a later process restart.
  $diagnostics=@{guiPid=$GuiPid;attemptId=$out.attemptId;atUtc=[DateTime]::UtcNow.ToString('o');bridge=@{};logs=@()}
  try {
    $bridge=Get-Content (Join-Path $env:TEMP ('tauri-dev-bridge-'+$GuiPid+'.token'))|ConvertFrom-Json
    foreach($endpoint in @('health','logs')){
      try {
        $diagnostics.bridge[$endpoint]=Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:'+$bridge.port+'/'+$endpoint) -ContentType 'application/json' -Body (@{token=$bridge.token}|ConvertTo-Json -Compress) -TimeoutSec 3
      } catch {$diagnostics.bridge[$endpoint]=@{error=$_.Exception.Message}}
    }
  } catch {$diagnostics.bridgeError=$_.Exception.Message}
  foreach($name in @(('stdout-'+$GuiPid+'.log'),'stdout.log')){
    $source=Join-Path $dir $name
    if(!(Test-Path $source)){continue}
    $archive='native-stdout-'+$out.attemptId+'-'+$name
    $sourceStream=$null;$snapshotStream=$null
    try {
      # The GUI keeps stdout open for writing. Default .NET readers deny that
      # existing writer; explicitly share it and copy a finite snapshot from
      # the same handle used to verify the startup PID.
      $sourceStream=[IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
      $sourceLength=$sourceStream.Length
      $prefix=[byte[]]::new(65536)
      $prefixLength=$sourceStream.Read($prefix,0,$prefix.Length)
      $head=[Text.Encoding]::UTF8.GetString($prefix,0,$prefixLength)
      if($head -notmatch ('version self-report .* pid '+$GuiPid+' ->')){
        $diagnostics.logs+=@{source=$name;error='process identity mismatch'};continue
      }
      $sourceStream.Position=0
      $remaining=[Math]::Min($sourceLength,1048576)
      $snapshotStream=[IO.File]::Open((Join-Path $dir $archive),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
      $buffer=[byte[]]::new(8192)
      while($remaining -gt 0){
        $read=$sourceStream.Read($buffer,0,[int][Math]::Min($remaining,$buffer.Length))
        if($read -eq 0){break}
        $snapshotStream.Write($buffer,0,$read);$remaining-=$read
      }
      $snapshotStream.Dispose();$snapshotStream=$null
      $diagnostics.logs+=@{source=$name;archive=$archive;sourceBytes=$sourceLength;truncated=($sourceLength -gt 1048576);sha256=(Get-FileHash (Join-Path $dir $archive) -Algorithm SHA256).Hash.ToLowerInvariant()}
    } catch {$diagnostics.logs+=@{source=$name;error=$_.Exception.Message}}
    finally {
      if($snapshotStream){$snapshotStream.Dispose()}
      if($sourceStream){$sourceStream.Dispose()}
    }
  }
  $out.diagnostics='native-diagnostics-'+$out.attemptId+'.json'
  $diagnostics|ConvertTo-Json -Depth 10|Set-Content -Encoding UTF8 (Join-Path $dir $out.diagnostics)
}
function Assert-NativeTransport {
  # HTTP readiness cannot prove the WebView can consume UI intents. In a
  # copied debug rig, a missing Server recipe can latch the Windows PID route
  # for a WSL operator and leave every IPC request retrying forever.
  $bridge=Get-Content (Join-Path $env:TEMP ('tauri-dev-bridge-'+$GuiPid+'.token'))|ConvertFrom-Json
  $js=@'
(async () => {
  const ipc = await window.__TAURI__.core.invoke('endpoint_ipc_status');
  if (ipc.client === 'connected' && ipc.ownerIsContentOrigin && ipc.connectedPath) return { ipc };
  return { ipc, wsl: await window.__TAURI__.core.invoke('wsl_status') };
})()
'@
  $response=Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:'+$bridge.port+'/eval') -ContentType 'application/json' -Body (@{token=$bridge.token;js=$js}|ConvertTo-Json -Compress) -TimeoutSec 8
  $out.transport=$response.result|ConvertFrom-Json
  $ipc=$out.transport.ipc
  if($ipc.client -ne 'connected' -or -not $ipc.ownerIsContentOrigin -or -not $ipc.connectedPath){
    throw ('Native IPC precondition failed: '+$ipc.resolutionDetail+'; WSL '+($out.transport.wsl.state|ConvertTo-Json -Compress))
  }
}
function Wait-Client {
  # WebView background timer throttling can stale presence. Observe the real
  # hook's heartbeat before requesting focus; never manufacture a presence row.
  $js=@'
import{readFileSync}from'node:fs';import{createRequire}from'node:module';
import{pathToFileURL}from'node:url';
const root='/tmp/papercusp-focus-449b1-current';
const req=createRequire(root+'/node_modules/@papercusp/embedded-postgres-server/package.json');
const postgres=(await import(pathToFileURL(req.resolve('postgres')).href)).default;
const db=postgres(JSON.parse(readFileSync(root+'/home/embedded-pg.json')).url,{max:1,connect_timeout:3});
try{const rows=await db`SELECT client_id,workspace_id,viewport->>'nativeDesktop' AS native,EXTRACT(EPOCH FROM now()-last_seen_at)::float AS age FROM harness_shared.ui_clients WHERE client_id=${'__CLIENT_ID__'}`;console.log(JSON.stringify(rows[0]??null));}finally{await db.end()}
'@
  $js=$js.Replace('__CLIENT_ID__',$ClientId.ToString())
  $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($js))
  $loader="await import('data:text/javascript;base64,"+$encoded+"')"
  $deadline=[DateTime]::UtcNow.AddSeconds(25)
  do {
    $raw=& wsl.exe -d papercup-runtime --exec node --input-type=module -e $loader 2>&1
    if($LASTEXITCODE -ne 0){throw ('Presence witness query failed: '+($raw -join "`n"))}
    $client=$raw | ConvertFrom-Json
    if($client -and $client.workspace_id -eq 'focus-449b1' -and $client.native -eq 'true' -and $client.age -lt 3){return $client}
    Start-Sleep -Milliseconds 500
  } while([DateTime]::UtcNow -lt $deadline)
  throw 'Fresh native client heartbeat was not observed'
}
function Focus-Gui {
  # Establish the initiating user's input gesture in the test VM. A scheduled
  # task alone has no foreground grant; its refusal is not a product verdict.
  [FocusWitness]::keybd_event(0x12,0,0,[UIntPtr]::Zero)
  [FocusWitness]::keybd_event(0x12,0,2,[UIntPtr]::Zero)
  [FocusWitness]::keybd_event(0x1b,0,0,[UIntPtr]::Zero)
  [FocusWitness]::keybd_event(0x1b,0,2,[UIntPtr]::Zero)
  [FocusWitness]::AllowSetForegroundWindow([uint32]$GuiPid) | Out-Null
  [FocusWitness]::ShowWindow($gui,9) | Out-Null
  [FocusWitness]::SwitchToThisWindow($gui,$true)
  [FocusWitness]::SetForegroundWindow($gui) | Out-Null
  if([FocusWitness]::GetForegroundWindow() -ne $gui){
    $out.captionClick=[FocusWitness]::ClickOwnedCaption($gui)
  }
  $deadline=[DateTime]::UtcNow.AddSeconds(1)
  do {
    if ([FocusWitness]::GetForegroundWindow() -eq $gui) { return }
    Start-Sleep -Milliseconds 50
  } while([DateTime]::UtcNow -lt $deadline)
  $out.setupFailure=@{gui=[FocusWitness]::Observe($gui);target=[FocusWitness]::Observe($target);atUtc=[DateTime]::UtcNow.ToString('o')}
  throw 'GUI foreground setup was refused'
}
function Measure-Case([string]$name,[bool]$expectCurrent,[bool]$expectMinimized,[string]$workspace='window',[bool]$expectSuccess=$true) {
  Focus-Gui
  $client=Wait-Client
  $before=[FocusWitness]::Observe($target)
  $guiBefore=[FocusWitness]::Observe($gui)
  if($before.current -ne $expectCurrent -or $before.minimized -ne $expectMinimized) { throw ('Invalid before state for '+$name) }
  $body=@{windowId=$title;workspace=$workspace} | ConvertTo-Json -Compress
  try {
    $response=Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3270/api/adv/sessions/focus' -Headers @{'x-papercusp-workspace'='focus-449b1'} -ContentType 'application/json' -Body $body -TimeoutSec 10
  } catch {
    $response=@{status='error';message=$_.Exception.Message}
    if($_.ErrorDetails.Message){$response.errorDetails=$_.ErrorDetails.Message}
    if($_.Exception.Response){
      $response.httpStatus=[int]$_.Exception.Response.StatusCode
      $reader=New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
      try{$response.body=$reader.ReadToEnd()}finally{$reader.Dispose()}
    }
  }
  $after=[FocusWitness]::Observe($target)
  $expectedDesktop=if($workspace -eq 'window'){$before.desktop}else{$guiBefore.desktop}
  $ok=($response.status -eq 'ok' -and $response.windowId -eq $title -and $after.foreground -eq $after.hwnd -and $after.current -and !$after.minimized -and $after.visible -and $after.cloaked -eq 0 -and $after.desktop -eq $expectedDesktop)
  if(!$expectSuccess){
    $guiAfter=[FocusWitness]::Observe($gui)
    $ok=($response.status -eq 'error' -and $response.httpStatus -eq 500 -and !$after.current -and $after.desktop -eq $before.desktop -and $guiAfter.current -and $guiAfter.desktop -eq $guiBefore.desktop -and $guiAfter.foreground -eq $guiAfter.hwnd)
  }
  $out.cases+=@{name=$name;workspace=$workspace;expectSuccess=$expectSuccess;client=$client;before=$before;guiBefore=$guiBefore;response=$response;after=$after;pass=$ok}
  Save-Receipt
  if(!$ok){throw ('Focus predicate failed for '+$name)}
}
function Select-OwnedDesktop([string]$desktop) {
  $bytes=(Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops').VirtualDesktopIDs
  $ids=@();for($i=0;$i -lt $bytes.Length;$i+=16){$part=New-Object byte[] 16;[Array]::Copy($bytes,$i,$part,0,16);$ids+=([guid]::new($part)).ToString()}
  $current=[FocusWitness]::CurrentDesktopId();$index=[Array]::IndexOf($ids,$current);$destination=[Array]::IndexOf($ids,$desktop)
  if($index -lt 0 -or $destination -lt 0){throw 'Owned desktop selection identity unavailable'}
  while($index -ne $destination){
    $next=if($destination -gt $index){$index+1}else{$index-1}
    [FocusWitness]::DesktopKey($(if($next -gt $index){0x27}else{0x25}))
    Start-Sleep -Milliseconds 600
    if([FocusWitness]::CurrentDesktopId() -ne $ids[$next]){throw 'Owned desktop selection did not converge'}
    $index=$next
  }
}
try {
  $process=Get-Process -Id $GuiPid
  if($process.Path -ne (Join-Path $dir 'papercusp-desktop.exe')){throw 'Refusing an unowned GUI process'}
  if($process.SessionId -ne (Get-Process -Id $PID).SessionId){throw 'Witness must run in the GUI interactive session'}
  $title='Papercusp-Focus-449b1-Target'
  $gui=[FocusWitness]::Window($GuiPid,$GuiTitle)
  $target=[FocusWitness]::Window($TargetPid,$title)
  $out.guiPid=$GuiPid;$out.targetPid=$TargetPid;$out.sessionId=$process.SessionId
  $out.nativeSha256=(Get-FileHash $process.Path -Algorithm SHA256).Hash.ToLowerInvariant()
  $out.initial=@{gui=[FocusWitness]::Observe($gui);target=[FocusWitness]::Observe($target)}
  if($CleanupOwnedDesktops){
    if($ProtectedDesktop -eq [guid]::Empty){throw 'Cleanup requires the original protected desktop identity'}
    $out.deletedDesktops=@()
    foreach($owned in $CleanupOwnedDesktops.Split(',')){
      $identity=([guid]$owned).ToString()
      if($identity -eq $ProtectedDesktop.ToString()){throw 'Refusing to delete the protected original desktop'}
      Select-OwnedDesktop $identity
      if([FocusWitness]::CurrentDesktopId() -ne $identity){throw 'Cleanup desktop identity mismatch'}
      [FocusWitness]::DesktopKey(0x73)
      Start-Sleep -Milliseconds 700
      if([FocusWitness]::CurrentDesktopId() -eq $identity){throw 'Fixture desktop removal did not converge'}
      $out.deletedDesktops+=$identity
      Save-Receipt
    }
    Select-OwnedDesktop $ProtectedDesktop.ToString()
    $out.cleanupOnly=$true;$out.completed=$true
    return
  }
  Install-FocusTrace
  Assert-NativeTransport
  if($SetupOnly){
    Focus-Gui
    $out.setupOnly=$true
    $out.setup=@{client=Wait-Client;gui=[FocusWitness]::Observe($gui);target=[FocusWitness]::Observe($target);currentDesktop=[FocusWitness]::CurrentDesktopId()}
    return
  }
  # Put this fixture on the GUI desktop before the baseline measurement.
  [FocusWitness]::SwitchToThisWindow($target,$false)
  [FocusWitness]::ShowWindow($target,9) | Out-Null
  if($Case -in @('all','same-desktop')){Measure-Case 'same-desktop' $true $false}
  if($Case -in @('all','minimized')){
    [FocusWitness]::ShowWindow($target,6) | Out-Null
    Measure-Case 'minimized' $true $true
  }
  if($Case -notin @('all','other-desktop')){$out.completed=$true;return}
  Focus-Gui
  $old=[FocusWitness]::Observe($target)
  [FocusWitness]::DesktopKey(0x44) # Win+Ctrl+D: fixture setup only.
  Start-Sleep -Milliseconds 900
  $desktopProbe=[FocusWitness]::OpenDesktopProbe()
  $created=[FocusWitness]::DesktopId($desktopProbe)
  if($created -eq $old.desktop){throw 'New virtual desktop setup was not observed'}
  $out.createdDesktop=$created
  Save-Receipt # Own the desktop even if later GUI setup fails.
  $out.probeClick=[FocusWitness]::ClickOwnedCaption($desktopProbe)
  Start-Sleep -Milliseconds 150
  $out.probeBefore=[FocusWitness]::Observe($desktopProbe)
  if($out.probeBefore.foreground -ne $out.probeBefore.hwnd){throw 'Desktop probe foreground setup was refused'}
  # Only the GUI process can reliably move its own window through the public
  # IVirtualDesktopManager API. This is setup; the target remains on its old
  # desktop and its measured focus still goes through the WSL HTTP route.
  $bridge=Get-Content (Join-Path $env:TEMP ('tauri-dev-bridge-'+$GuiPid+'.token')) | ConvertFrom-Json
  $setupJs='window.__TAURI__.core.invoke("focus_window_by_title",{title:'+($GuiTitle|ConvertTo-Json -Compress)+',verification:true,workspace:"current"})'
  $out.guiMoveSetup=Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:'+$bridge.port+'/eval') -ContentType 'application/json' -Body (@{token=$bridge.token;js=$setupJs}|ConvertTo-Json -Compress) -TimeoutSec 8
  [FocusWitness]::DestroyWindow($desktopProbe)|Out-Null
  $desktopProbe=[IntPtr]::Zero
  # Pull only our GUI into the newly created desktop; the target stays behind.
  Focus-Gui
  $new=[FocusWitness]::Observe($gui)
  if($new.desktop -eq $old.desktop){throw 'New virtual desktop setup was not observed'}
  if($new.desktop -ne $out.createdDesktop){throw 'GUI did not reach the owned fixture desktop'}
  Measure-Case 'bring-here-refused' $false $false 'current' $false
  Measure-Case 'other-desktop' $false $false 'window'
  $out.completed=$true
} catch { $out.error=$_.Exception.Message }
finally {
  try {Save-FocusDiagnostics} catch {$out.diagnosticsError=$_.Exception.Message}
  if($desktopProbe -and $desktopProbe -ne [IntPtr]::Zero){[FocusWitness]::DestroyWindow($desktopProbe)|Out-Null}
  # An instrumented WebView may expose bounded callback evidence. Preserve it
  # separately; a trace timeout is diagnostic evidence, never acceptance.
  try {
    $bridge=Get-Content (Join-Path $env:TEMP ('tauri-dev-bridge-'+$GuiPid+'.token')) | ConvertFrom-Json
    $trace=Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:'+$bridge.port+'/eval') -ContentType 'application/json' -Body (@{token=$bridge.token;js='(() => {const snapshot={at:Date.now(),visibility:document.visibilityState,trace:window.__focusTrace?.slice(-300)};window.__focusTraceRestore?.();return snapshot;})()'}|ConvertTo-Json -Compress) -TimeoutSec 8
    $trace.result | Set-Content -Encoding UTF8 (Join-Path $dir ('native-trace-'+$out.attemptId+'.json'))
    $out.trace='native-trace-'+$out.attemptId+'.json'
  } catch { $out.traceError=$_.Exception.Message }
  if($out.createdDesktop){
    Select-OwnedDesktop $out.createdDesktop
    $now=[FocusWitness]::CurrentDesktopId()
    if($now -eq $out.createdDesktop){
      [FocusWitness]::DesktopKey(0x73) # Win+Ctrl+F4: remove only our current fixture desktop.
      $out.desktopCleanup='requested for verified owned desktop'
      Start-Sleep -Milliseconds 700
      $out.desktopAfterCleanup=[FocusWitness]::CurrentDesktopId()
      if($out.desktopAfterCleanup -eq $out.createdDesktop){$out.completed=$false;$out.error='Owned desktop cleanup did not converge'}
    } else { $out.desktopCleanup='refused: owned desktop is not current' }
  }
  Save-Receipt
  Copy-Item $receipt (Join-Path $dir ('wsl-acceptance-'+$out.attemptId+'.json'))
}
