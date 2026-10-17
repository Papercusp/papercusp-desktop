param([Parameter(Mandatory=$true)][int]$GuiPid, [Parameter(Mandatory=$true)][string]$GuiTitle, [Parameter(Mandatory=$true)][int]$TargetPid, [Parameter(Mandatory=$true)][guid]$ClientId, [switch]$SetupOnly, [ValidateSet('all','same-desktop','minimized','other-desktop')][string]$Case='all')
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
function Measure-Case([string]$name,[bool]$expectCurrent,[bool]$expectMinimized) {
  Focus-Gui
  $client=Wait-Client
  $before=[FocusWitness]::Observe($target)
  $guiBefore=[FocusWitness]::Observe($gui)
  if($before.current -ne $expectCurrent -or $before.minimized -ne $expectMinimized) { throw ('Invalid before state for '+$name) }
  $body=@{windowId=$title;workspace='current'} | ConvertTo-Json -Compress
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
  $ok=($response.status -eq 'ok' -and $response.windowId -eq $title -and $after.foreground -eq $after.hwnd -and $after.current -and !$after.minimized -and $after.visible -and $after.cloaked -eq 0 -and $after.desktop -eq $guiBefore.desktop)
  $out.cases+=@{name=$name;client=$client;before=$before;guiBefore=$guiBefore;response=$response;after=$after;pass=$ok}
  Save-Receipt
  if(!$ok){throw ('Focus predicate failed for '+$name)}
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
  if($SetupOnly){
    Focus-Gui
    $out.setupOnly=$true
    $out.setup=@{client=Wait-Client;gui=[FocusWitness]::Observe($gui);target=[FocusWitness]::Observe($target)}
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
  $created=[FocusWitness]::Observe([FocusWitness]::GetForegroundWindow())
  if($created.desktop -eq $old.desktop -or !$created.current){throw 'New virtual desktop setup was not observed'}
  $out.createdDesktop=$created.desktop
  Save-Receipt # Own the desktop even if later GUI setup fails.
  # Only the GUI process can reliably move its own window through the public
  # IVirtualDesktopManager API. This is setup; the target remains on its old
  # desktop and its measured focus still goes through the WSL HTTP route.
  $bridge=Get-Content (Join-Path $env:TEMP ('tauri-dev-bridge-'+$GuiPid+'.token')) | ConvertFrom-Json
  $setupJs='window.__TAURI__.core.invoke("focus_window_by_title",{title:'+($GuiTitle|ConvertTo-Json -Compress)+',verification:true})'
  $out.guiMoveSetup=Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:'+$bridge.port+'/eval') -ContentType 'application/json' -Body (@{token=$bridge.token;js=$setupJs}|ConvertTo-Json -Compress) -TimeoutSec 8
  # Pull only our GUI into the newly created desktop; the target stays behind.
  Focus-Gui
  $new=[FocusWitness]::Observe($gui)
  if($new.desktop -eq $old.desktop){throw 'New virtual desktop setup was not observed'}
  if($new.desktop -ne $out.createdDesktop){throw 'GUI did not reach the owned fixture desktop'}
  Measure-Case 'other-desktop' $false $false
  $out.completed=$true
} catch { $out.error=$_.Exception.Message }
finally {
  # An instrumented WebView may expose bounded callback evidence. Preserve it
  # separately; a trace timeout is diagnostic evidence, never acceptance.
  try {
    $bridge=Get-Content (Join-Path $env:TEMP ('tauri-dev-bridge-'+$GuiPid+'.token')) | ConvertFrom-Json
    $trace=Invoke-RestMethod -Method Post -Uri ('http://127.0.0.1:'+$bridge.port+'/eval') -ContentType 'application/json' -Body (@{token=$bridge.token;js='({at:Date.now(),visibility:document.visibilityState,trace:window.__focusTrace?.filter(x=>x.kind!=="callback"||x.message?.name==="sse-chunk"||x.kind.includes("error")).slice(-150)})'}|ConvertTo-Json -Compress) -TimeoutSec 8
    $trace.result | Set-Content -Encoding UTF8 (Join-Path $dir ('native-trace-'+$out.attemptId+'.json'))
    $out.trace='native-trace-'+$out.attemptId+'.json'
  } catch { $out.traceError=$_.Exception.Message }
  if($out.createdDesktop){
    $now=[FocusWitness]::Observe([FocusWitness]::GetForegroundWindow())
    if($now.current -and $now.desktop -eq $out.createdDesktop){
      [FocusWitness]::DesktopKey(0x73) # Win+Ctrl+F4: remove only our current fixture desktop.
      $out.desktopCleanup='requested for verified owned desktop'
      Start-Sleep -Milliseconds 700
      $out.desktopAfterCleanup=[FocusWitness]::Observe([FocusWitness]::GetForegroundWindow())
      if($out.desktopAfterCleanup.desktop -eq $out.createdDesktop){$out.completed=$false;$out.error='Owned desktop cleanup did not converge'}
    } else { $out.desktopCleanup='refused: owned desktop is not current' }
  }
  Save-Receipt
  Copy-Item $receipt (Join-Path $dir ('wsl-acceptance-'+$out.attemptId+'.json'))
}
