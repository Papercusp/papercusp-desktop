param(
    [Parameter(Mandatory=$true)][string]$BridgeSource,
    [ValidateSet('fixture', 'chat', 'cards', 'operator', 'startup')][string]$Phase = 'fixture',
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
    if ($Phase -eq 'startup') {
        Assert-True ([IO.File]::Exists($PuiExecutable)) 'Startup phase requires the actual PUI executable'
        # Exercise the native loader before any network request. A successful
        # cross-build can still depend on an absent Visual C++ redistributable.
        $version = & $PuiExecutable --version 2>&1
        Assert-True ($LASTEXITCODE -eq 0) ('PUI failed before startup: native exit ' + $LASTEXITCODE)
        $passed.Add('standalone PUI starts on the native Windows installation')
        Assert-True (($version -join "`n") -match '^pui\s+\d+\.\d+\.\d+') 'PUI did not return its version'
        $passed.Add('standalone PUI returns its version without an operator request')
        [pscustomobject]@{ok=$true; platform='windows'; phase='startup'; cases=$passed.ToArray();
            count=$passed.Count; puiSha256=(Get-FileHash -LiteralPath $PuiExecutable -Algorithm SHA256).Hash.ToLowerInvariant();
            version=($version -join "`n")} | ConvertTo-Json -Depth 8 -Compress
        return
    }
    if ($Phase -in @('chat', 'cards')) {
        $nativeAssembly = Join-Path $temp 'native-chat.dll'
        Add-Type -Path @($BridgeSource, (Join-Path (Split-Path -Parent $BridgeSource) 'WorkbenchModel.cs')) -ReferencedAssemblies System.Web.Extensions,System.Core -OutputAssembly $nativeAssembly
        # Load from bytes so .NET Framework does not hold the emitted DLL open
        # past the fixture's finally cleanup. Keep the file for compiler refs.
        [void][Reflection.Assembly]::Load([IO.File]::ReadAllBytes($nativeAssembly))
    } else { Add-Type -Path $BridgeSource -ReferencedAssemblies System.Web.Extensions }
    if ($Phase -eq 'cards') {
        $pui = Join-Path $temp "cards ' literal.exe"
        Add-Type -OutputAssembly $pui -OutputType ConsoleApplication -ReferencedAssemblies System.Web.Extensions -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Web.Script.Serialization;
public static class CardChild {
    public static int Main(string[] argv) {
        if(argv.Length!=1 || argv[0]!="native-cards") return 23;
        var json=new JavaScriptSerializer(); var utf8=new UTF8Encoding(false,true);
        var request=json.Deserialize<Dictionary<string,object>>(new StreamReader(Console.OpenStandardInput(),utf8).ReadToEnd());
        Console.OutputEncoding=utf8;
        if(Object.Equals(request["operation"],"subscribe")) {
            Console.WriteLine(json.Serialize(new {environment=request["environment"], @event="reset", data=new {workspaceId="w"}}));
            Console.Out.Flush();
            Console.WriteLine(json.Serialize(new {environment=request["environment"], @event="snapshot", data=new {
                workspaceId="w",runId="run",version=1,snapshot=new {openCards=new object[0]}}}));
        } else {
            Console.Write(json.Serialize(new {environment=request["environment"],rows=new[]{new {responded=true,
                conversationId=request["conversationId"],correlationId=request["correlationId"]}}}));
        }
        return 0;
    }
}
'@
        Add-Type -ReferencedAssemblies @('System.dll','System.Core.dll','System.Web.Extensions.dll', $nativeAssembly) -TypeDefinition @'
using System;
using System.Linq;
using System.Threading;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using Papercusp.Workbench;
public static class NativeCardsFixture {
    static readonly List<string> cases=new List<string>();
    const string cid="c88bf103-8399-42ee-93ae-19e73114e3fd";
    const string other="a88bf103-8399-42ee-93ae-19e73114e3fd";
    static Dictionary<string,object> D(string json) { return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(json); }
    static Dictionary<string,object> E() { return D("{\"endpoint\":\"http://selected/path\",\"workspaceId\":\"w\",\"store\":{\"id\":\"s\"},\"agentChat\":{\"scope\":\"workspace:w\"}}"); }
    static Dictionary<string,object> Row(string id="card",string kind="text") {
        return new Dictionary<string,object>{{"correlationId",id},{"conversationId",cid},{"prompt","literal ' $() \u03bb\u4e2d"},
            {"createdAt",1},{"presentation",new Dictionary<string,object>{{"kind",kind}}}};
    }
    static Dictionary<string,object> Frame(int version,object[] rows,string run="run") {
        return D(new JavaScriptSerializer().Serialize(new {environment=E(),@event="snapshot",data=new {workspaceId="w",runId=run,version=version,snapshot=new {openCards=rows}}}));
    }
    static void Check(bool ok,string name) {if(!ok) throw new Exception(name);cases.Add(name);}
    static void Refuse(Action action,string name) {var refused=false;try{action();}catch{refused=true;}Check(refused,name);}
    static NativeCard Card(string kind) { return new NativeCard("run",Row("card",kind)); }
    static Dictionary<string,object> Presentation(Dictionary<string,object> row) {return (Dictionary<string,object>)row["presentation"];}
    public static string Run(string pui) {
        var state=new NativeCardsState();var token=state.Begin(E(),cid);
        var frames=new List<Dictionary<string,object>>();
        PuiReadBridge.CardsAsync(pui,state.Subscription,frame=>frames.Add(frame),CancellationToken.None,5000).GetAwaiter().GetResult();
        Check(frames.Count==2,"native card transport returns both canonical frames");
        Check(state.Receive(token,frames[0]) && state.Connected,"canonical card reset opens the connection");
        Check(state.Receive(token,frames[1]) && state.Cards.Count==0,"empty native card snapshot is observed");
        Refuse(()=>PuiReadBridge.CardsAsync(pui,new Dictionary<string,object>(),frame=>{},CancellationToken.None),"card stream rejects unscoped input before launching helper");
        Refuse(()=>PuiReadBridge.RespondToCardAsync(pui,state.Subscription,CancellationToken.None),"card response rejects subscribe operation");
        var row=Row();var snapshot=Frame(2,new object[]{row});
        Check(state.Receive(token,snapshot) && state.Cards.Count==1,"native state projects canonical card");
        var card=state.Cards[0];
        Check((string)card.Raw["prompt"]=="literal ' $() \u03bb\u4e2d","card prompt preserves Unicode and shell-looking text");
        Check(!state.Receive(token,snapshot) && Object.ReferenceEquals(card,state.Cards[0]),"identical snapshot replay preserves card and draft identity");
        Check(!state.Receive(token,Frame(1,new object[0])),"older snapshot cannot remove a newer question");
        var changed=Row();changed["prompt"]="changed";
        Refuse(()=>state.Receive(token,Frame(2,new object[]{changed})),"conflicting same-version snapshot is rejected");
        Check(Object.ReferenceEquals(card,state.Cards[0]),"conflicting snapshot leaves prior card unchanged");
        var foreign=Row();foreign["conversationId"]=other;
        Refuse(()=>state.Receive(token,Frame(3,new object[]{foreign})),"foreign conversation card is rejected");
        var wrong=Frame(3,new object[0]);((Dictionary<string,object>)wrong["environment"])["workspaceId"]="other";
        Refuse(()=>state.Receive(token,wrong),"foreign backend frame cannot clear cards");
        Refuse(()=>state.Receive(token,Frame(3,new object[]{row,row})),"duplicate card identity is rejected atomically");
        Refuse(()=>state.Receive(token,Frame(1,new object[]{row},"second-run")),"one card cannot belong to multiple runs");
        Refuse(()=>card.Answer(value:" "),"text question rejects empty required answer");
        Refuse(()=>card.Answer(value:new string('\u03bb',17000)),"text answer uses UTF8 byte bound");
        Check((string)card.Answer(value:"answer ' $() \u03bb")["value"]=="answer ' $() \u03bb","literal text answer stays data");
        var request=state.Request(card,"submit",card.Answer(value:"answer"));
        Check((string)request["correlationId"]=="card" && (string)request["conversationId"]==cid && state.Pending=="card","response binds exact card and conversation");
        Refuse(()=>state.Request(card,"submit",card.Answer(value:"again")),"pending answer blocks duplicate submission");
        var receipt=PuiReadBridge.RespondToCardAsync(pui,request,CancellationToken.None).GetAwaiter().GetResult();
        var badReceipt=ChatReply.Copy(receipt);((Dictionary<string,object>)badReceipt["environment"])["endpoint"]="http://other";
        Refuse(()=>state.Responded(token,"card",badReceipt),"foreign acknowledgement cannot remove a pending question");
        Check(state.Pending=="card" && state.Cards.Count==1,"unacknowledged answer remains visible and pending");
        Check(state.Responded(token,"card",receipt) && state.Cards.Count==0 && state.Pending==null,"only canonical exact acknowledgement removes question");
        state.Receive(token,Frame(3,new object[]{row}));
        Check(state.Cards.Count==0,"late pre-response snapshot cannot resurrect answered question");
        token=state.Begin(E(),cid);state.Receive(token,Frame(1,new object[]{row}));card=state.Cards[0];
        state.Failed(token,new Exception("disconnected"));
        Refuse(()=>state.Request(card,"cancel"),"disconnected question cannot be answered without reconciliation");
        Check(state.Cards.Count==1 && state.Error=="disconnected","disconnect preserves displayed question");
        state.Receive(token,Frame(2,new object[0]));Check(state.Cards.Count==0 && state.Connected && state.Error==null,"new empty snapshot reconciles removed question");
        var previous=token;token=state.Begin(E(),other);
        Check(!state.Receive(previous,snapshot) && state.Cards.Count==0,"late A snapshot cannot enter B");
        Check(!state.Responded(previous,"card",receipt),"late A response cannot affect B");
        var choices=Row("choices","radio");Presentation(choices)["options"]=new[]{new{id="a",label="same"},new{id="b",label="same"}};
        var radio=new NativeCard("run",choices);
        Check((string)((string[])radio.Answer(new[]{"b"})["picks"])[0]=="b","same-label options preserve canonical option identity");
        Refuse(()=>radio.Answer(new[]{"a","b"}),"radio rejects multiple answers");
        Refuse(()=>radio.Answer(new[]{"foreign"}),"choice rejects unknown option identity");
        Refuse(()=>radio.Answer(new string[0]),"choice enforces required answer");
        Presentation(choices)["kind"]="checkbox";var check=new NativeCard("run",choices);
        Check(((string[])check.Answer(new[]{"a","b"})["picks"]).Length==2,"checkbox accepts distinct available answers");
        Refuse(()=>check.Answer(new[]{"a","a"}),"checkbox rejects duplicate picks");
        Presentation(choices)["options"]="[{\"id\":\"x\",\"label\":\"encoded\"}]";
        Check(new NativeCard("run",choices).Options.Count==1,"historical JSON-string options reuse canonical decoder contract");
        Presentation(choices)["options"]=new[]{new{id="a",label="x"},new{id="a",label="y"}};
        Refuse(()=>new NativeCard("run",choices),"duplicate option identities are rejected");
        Refuse(()=>Card("date").Answer(value:"2026-02-30"),"date refuses invalid calendar day");
        Check((string)Card("date").Answer(value:"2028-02-29")["value"]=="2028-02-29","date accepts valid leap day");
        var dateRow=Row("date","date");Presentation(dateRow)["min"]="2027-01-01";
        Refuse(()=>new NativeCard("run",dateRow).Answer(value:"2026-12-31"),"date enforces displayed bound");
        var sliderRow=Row("slider","slider");var p=Presentation(sliderRow);p["min"]=1;p["max"]=5;p["step"]=2;
        var slider=new NativeCard("run",sliderRow);
        Check((double)slider.Answer(value:"3")["value"]==3,"slider accepts displayed step");
        Refuse(()=>slider.Answer(value:"2"),"slider rejects off-step answer");
        Refuse(()=>slider.Answer(value:"NaN"),"slider rejects non-finite value");
        Refuse(()=>slider.Answer(value:"7"),"slider rejects out-of-range value");
        var secure=Row("token-1");Presentation(secure)["link"]="/api/ui/cards/token-1/link";
        Check(new NativeCard("run",secure).SecureLink(E())=="http://selected/api/ui/cards/token-1/link","secure link stays on selected operator origin");
        Presentation(secure)["link"]="https://foreign/steal";
        Check(new NativeCard("run",secure).SecureLink(E())==null,"foreign secure-link target remains inert");
        var unsupported=Row("unsupported","unknown");
        Refuse(()=>new NativeCard("run",unsupported).Answer(value:"yes"),"unsupported question cannot fabricate submit payload");
        token=state.Begin(E(),cid);var expired=Row("expired");expired["timeoutMs"]=1;
        state.Receive(token,Frame(1,new object[]{expired}));
        Refuse(()=>state.Request(state.Cards[0],"cancel"),"expired question cannot send a response");
        token=state.Begin(E(),cid);var deny=Row("deny");deny["allowDecline"]=false;state.Receive(token,Frame(1,new object[]{deny}));
        Refuse(()=>state.Request(state.Cards[0],"decline"),"question decline restriction is honored");
        Refuse(()=>state.Request(state.Cards[0],"submit",new Dictionary<string,object>()),"typed request revalidates fabricated empty payload");
        var stale=state.Cards[0];state.Receive(token,Frame(2,new object[]{deny}));
        Refuse(()=>state.Request(stale,"cancel"),"replaced card control cannot submit stale input");
        return new JavaScriptSerializer().Serialize(new{ok=true,platform="windows",phase="cards",count=cases.Count,cases=cases.ToArray()});
    }
}
'@
        [NativeCardsFixture]::Run($pui)
        return
    }
    if ($Phase -eq 'chat') {
        $pui = Join-Path $temp "chat ' literal.exe"
        Add-Type -OutputAssembly $pui -OutputType ConsoleApplication -ReferencedAssemblies System.Web.Extensions -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Collections.Generic;
using System.Web.Script.Serialization;
public static class ChatChild {
    public static int Main(string[] argv) {
        if (argv.Length != 1 || argv[0] != "native-chat") return 23;
        var utf8 = new UTF8Encoding(false, true); var json = new JavaScriptSerializer();
        var request = json.Deserialize<Dictionary<string, object>>(new StreamReader(Console.OpenStandardInput(), utf8).ReadToEnd());
        File.WriteAllText((string)request["pidFile"], Process.GetCurrentProcess().Id.ToString());
        var mode = (string)request["mode"];
        if (mode == "timeout" || mode == "cancel") Thread.Sleep(60000);
        if (mode == "exit") { Console.Error.Write("canonical send refused"); return 7; }
        if (mode == "empty") return 0;
        var stream = Console.OpenStandardOutput();
        if (mode == "oversize") { var huge = new byte[1024 * 1024 + 1]; for (var i=0;i<huge.Length;i++) huge[i]=120; stream.Write(huge,0,huge.Length); return 0; }
        var text = mode == "malformed" ? "{\n" : mode == "shape" ? "{}\n" :
            json.Serialize(new { environment = request["environment"], @event = "test", data = request["text"] }) + (mode == "partial" ? "" : "\n");
        var bytes = utf8.GetBytes(text);
        // Split every byte, including multibyte Unicode, across pipe writes.
        foreach (var b in bytes) { stream.WriteByte(b); stream.Flush(); }
        if (mode == "incremental") {
            var ack = (string)request["ackFile"]; var until = DateTime.UtcNow.AddSeconds(5);
            while (!File.Exists(ack)) { if(DateTime.UtcNow > until) return 31; Thread.Sleep(10); }
            Console.Error.Write(new string('x', 100000));
            stream.Write(bytes,0,bytes.Length);
        }
        return 0;
    }
}
'@
        # Worker callbacks stay in C#: PowerShell delegates have no runspace on
        # redirected-pipe completion threads. This tests the production adapter.
        Add-Type -ReferencedAssemblies @('System.dll','System.Core.dll','System.Web.Extensions.dll', $nativeAssembly) -TypeDefinition @'
using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Diagnostics;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using Papercusp.Workbench;
public static class NativeChatFixture {
    static readonly List<string> cases = new List<string>();
    const string conversation = "c88bf103-8399-42ee-93ae-19e73114e3fd";
    const string other = "a88bf103-8399-42ee-93ae-19e73114e3fd";
    const string user = "088bf103-8399-42ee-93ae-19e73114e3fd";
    const string turn = "b88bf103-8399-42ee-93ae-19e73114e3fd";
    static Dictionary<string,object> D(string json) { return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(json); }
    static Dictionary<string,object> E() { return D("{\"endpoint\":\"http://selected\",\"workspaceId\":\"w\",\"store\":{\"id\":\"s\"},\"agentChat\":{\"scope\":\"workspace:w\"}}"); }
    static Dictionary<string,object> Envelope(object row, Dictionary<string,object> env = null) {
        return D(new JavaScriptSerializer().Serialize(new Dictionary<string,object> { {"environment",env??E()}, {"rows",new object[]{row}}, {"version","v1"} }));
    }
    static Dictionary<string,object> Frame(string kind, Dictionary<string,object> data) {
        return new Dictionary<string,object>{{"environment",E()},{"event",kind},{"data",data}};
    }
    static Dictionary<string,object> Event(int sequence, string json) {
        return Frame("chat-event",new Dictionary<string,object>{{"schemaVersion",1},{"conversationId",conversation},{"turnId",turn},
            {"sequence",sequence},{"eventId","event-"+sequence},{"event",D(json)}});
    }
    static void Check(bool ok,string name) { if(!ok) throw new Exception(name); cases.Add(name); }
    static void Refuse(Action action,string name) { var refused=false; try{action();}catch{refused=true;} Check(refused,name); }
    static Dictionary<string,object> Message(string id, int seq, string cid = conversation) {
        return new Dictionary<string,object>{{"id",id},{"seq",seq},{"conversationId",cid},{"role","user"},{"text","literal ' $() \u03bb\u4e2d"}};
    }
    static void Load(ChatState state,string cid=conversation) {
        var token=state.Begin();
        state.Bind(token,E(),Envelope(new Dictionary<string,object>{{"id",cid},{"workspaceId","w"},{"subjectKind","global"},{"status","active"}}));
        state.Settle(token,E(),cid,Envelope(new {turns=new object[]{Message("old",5,cid)},hasMoreEarlier=true}));
    }
    static Task Stream(string pui,string directory,string mode,Action<Dictionary<string,object>> receive,CancellationToken token,int timeout=5000) {
        return PuiReadBridge.ChatAsync(pui,new Dictionary<string,object>{{"environment",E()},{"conversationId",conversation},{"operation","send"},
            {"text","literal ' $() \u03bb\u4e2d"},{"mode",mode},{"pidFile",Path.Combine(directory,mode+".pid")},{"ackFile",Path.Combine(directory,"ack")}},receive,token,timeout);
    }
    static void Reaped(string directory,string mode) {
        var pid=Int32.Parse(File.ReadAllText(Path.Combine(directory,mode+".pid"))); var alive=false;
        try { using(var child=Process.GetProcessById(pid)) alive=!child.HasExited; } catch(ArgumentException) {}
        Check(!alive,"chat helper reaped: "+mode);
    }
    public static string Run(string pui,string directory) {
        var observed=new List<Dictionary<string,object>>();
        Stream(pui,directory,"incremental",frame=>{observed.Add(frame); File.WriteAllText(Path.Combine(directory,"ack"),"seen");},CancellationToken.None).GetAwaiter().GetResult();
        Check(observed.Count==2 && (string)observed[0]["data"]=="literal ' $() \u03bb\u4e2d","native frames arrive before child exit and preserve split UTF8");
        Reaped(directory,"incremental");
        foreach(var mode in new[]{"malformed","shape","partial","empty","oversize","exit"}) {
            Refuse(()=>Stream(pui,directory,mode,frame=>{},CancellationToken.None).GetAwaiter().GetResult(),"reject native stream "+mode); Reaped(directory,mode);
        }
        Refuse(()=>Stream(pui,directory,"timeout",frame=>{},CancellationToken.None,1200).GetAwaiter().GetResult(),"stream deadline is enforced"); Reaped(directory,"timeout");
        using(var cancel=new CancellationTokenSource()) {
            var pending=Stream(pui,directory,"cancel",frame=>{},cancel.Token); var watch=Stopwatch.StartNew();
            while(!File.Exists(Path.Combine(directory,"cancel.pid"))) { if(watch.ElapsedMilliseconds>4000) throw new Exception("chat child missing"); Thread.Sleep(10); }
            cancel.Cancel(); Refuse(()=>pending.GetAwaiter().GetResult(),"pipe cancellation stays a transport failure"); Reaped(directory,"cancel");
        }
        Refuse(()=>Stream(pui,directory,"callback",frame=>{throw new Exception("invalid scope");},CancellationToken.None).GetAwaiter().GetResult(),"refused callback terminates stream"); Reaped(directory,"callback");
        var state=new ChatState(); Load(state); var generation=state.Generation;
        Check(state.Ready && state.Turns.Count==1,"canonical conversation and history bind");
        state.Draft="draft A"; Load(state,other); Check(state.Draft=="","conversation B cannot inherit A draft");
        state.Draft="draft B"; Load(state); Check(state.Draft=="draft A","return to conversation A restores its draft");
        var before=state.BeginEarlier();
        state.Settle(state.Generation,E(),conversation,Envelope(new {turns=new object[]{Message("earlier",3)},hasMoreEarlier=false}),before);
        Check(state.Turns.Count==2 && (string)state.Turns[0]["id"]=="earlier","earlier history preserves exact ordered cursor");
        Load(state); var badPage=Envelope(new {turns=new object[]{Message("foreign",1,other)},hasMoreEarlier=false});
        // Fresh load for the negative page; preserve the failing page's atomicity.
        var token=state.Begin(); state.Bind(token,E(),Envelope(new {id=conversation,workspaceId="w",subjectKind="global",status="active"}));
        Refuse(()=>state.Settle(token,E(),conversation,badPage),"foreign history rejected");
        Check(state.Turns.Count==0 && !state.Loaded,"invalid history cannot partially mutate state");
        foreach(var axis in new[]{"endpoint","workspaceId","store","agentChat"}) {
            var env=E(); env[axis]=axis=="store" ? (object)D("{\"id\":\"other\"}") : axis=="agentChat" ? (object)D("{\"scope\":\"other\"}") : "other";
            Refuse(()=>state.Bind(token,E(),Envelope(new {id=conversation,workspaceId="w",subjectKind="global",status="active"},env)),"refuse changed "+axis);
        }
        Load(state); state.Draft="failed send draft"; token=state.Generation; state.Send(user);
        state.Fail(token,new Exception("canonical send refused"));
        Check(state.Draft=="failed send draft" && !state.CanSend && state.Reply.Phase=="needs-reconciliation","failed send retains draft and blocks duplicate resend");
        Refuse(()=>state.Reply.Control("reconnect"),"unknown saved turn cannot be replayed or resent");
        Load(state); state.Draft="literal ' $() \u03bb\u4e2d"; token=state.Generation; state.Send(user);
        state.Receive(token,Frame("user-saved",new Dictionary<string,object>{{"conversationId",conversation},{"turn",Message(user,6)}}));
        Check(state.Draft=="" && state.Turns.Count==2,"only exact saved-user acknowledgement clears draft");
        state.Receive(token,Frame("turn-meta",new Dictionary<string,object>{{"schemaVersion",1},{"conversationId",conversation},{"turnId",turn}}));
        var delta=Event(1,"{\"type\":\"delta\",\"text\":\"<think>private</think><sa\"}"); state.Receive(token,delta);
        state.Receive(token,Event(2,"{\"type\":\"delta\",\"text\":\"y>**Hello** \u03bb</sa\"}"));
        Check(state.Reply.DisplayText=="**Hello** \u03bb","stream hides private text and partial closing tags");
        state.Receive(token,Event(3,"{\"type\":\"delta\",\"text\":\"y>\"}"));
        var raw=state.Reply.Raw; Refuse(()=>state.Receive(token,Event(5,"{\"type\":\"delta\",\"text\":\"BAD\"}")),"reply sequence gaps are refused");
        Check(state.Reply.Sequence==3 && state.Reply.Raw==raw,"refused reply frame leaves cursor and text unchanged");
        state.Receive(token,delta); Check(state.Reply.Sequence==3 && state.Reply.Raw==raw,"identical replay is idempotent");
        Refuse(()=>state.Receive(token,Event(1,"{\"type\":\"delta\",\"text\":\"changed\"}")),"conflicting replay is refused");
        state.Receive(token,Event(4,"{\"type\":\"tool_call\",\"name\":\"plans:get\",\"callId\":\"call\"}"));
        Check(state.Reply.Tools.Single()=="plans:get \u00b7 running","canonical tool activity projected");
        state.Reply.Disconnected(); var control=state.Reply.Control("reconnect");
        Check((long)control["afterSequence"]==4 && (string)control["turnId"]==turn && !control.ContainsKey("text"),"reconnect uses saved identity and sequence without resend");
        var wrongDone=Frame("done",new Dictionary<string,object>{{"persistedTurn",new {conversationId=other,turnId=turn,seq=7}}});
        // Serialize anonymous fixture rows into the same dictionary shapes as PUI.
        wrongDone=D(new JavaScriptSerializer().Serialize(wrongDone));
        Refuse(()=>state.Receive(token,wrongDone),"foreign completion cannot claim success");
        state.Receive(token,Frame("done",new Dictionary<string,object>{{"phase","completed"},{"persistedTurn",new Dictionary<string,object>{{"conversationId",conversation},{"turnId",turn},{"seq",7}}}}));
        Check(state.Reply.Complete && state.Reply.Phase=="completed","exact durable completion acknowledgement permits next send");
        Load(state,other); state.Draft="B stays B";
        Check(!state.Receive(token,delta) && state.Draft=="B stays B" && state.Reply==null,"late A reply cannot enter B or clear its draft");
        return new JavaScriptSerializer().Serialize(new {ok=true,platform="windows",phase="chat",count=cases.Count,cases=cases.ToArray()});
    }
}
'@
        [NativeChatFixture]::Run($pui, $temp)
        return
    }
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
        if (argv.Length == 1 && argv[0] == "stop-fixture") { Console.ReadLine(); return 0; }
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
    # Force the real .NET Framework termination race at the OS boundary, then
    # inject the same denial while a real owned helper remains alive. This
    # distinguishes safe exit-race recovery from swallowing a cleanup failure.
    Add-Type -ReferencedAssemblies System.Core -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
public static class NativeStopFixture {
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    public static string[] Run(Type bridge, string executable) {
        var stop = bridge.GetMethod("Stop", BindingFlags.NonPublic | BindingFlags.Static);
        var guarded = bridge.GetMethod("StopIfRunning", BindingFlags.NonPublic | BindingFlags.Static);
        var cases = new List<string>();
        using (var child = new Process()) {
            child.StartInfo = new ProcessStartInfo(executable, "stop-fixture") {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true
            };
            child.Start();
            try {
                if (child.HasExited) throw new Exception("Owned helper did not stay alive");
                var refused = false;
                try {
                    guarded.Invoke(null, new object[] { (Func<bool>)(() => child.HasExited),
                        (Action)(() => { throw new Win32Exception(5); }) });
                } catch (TargetInvocationException error) {
                    var failure = error.InnerException as Win32Exception;
                    refused = failure != null && failure.NativeErrorCode == 5;
                }
                if (!refused || child.HasExited) throw new Exception("Live helper termination failure was hidden");
                cases.Add("live owned helper access-denied remains a failure");
                var actualCode = 0;
                var handle = child.Handle;
                guarded.Invoke(null, new object[] { (Func<bool>)(() => child.HasExited), (Action)(() => {
                    child.StandardInput.WriteLine("exit"); child.StandardInput.Close();
                    if (!child.WaitForExit(5000)) throw new Exception("Owned helper did not exit");
                    // Process.Kill returns early once .NET has cached an exit.
                    // Call its native termination primitive with the retained
                    // owned handle to force the post-check OS race instead.
                    if (!TerminateProcess(handle, 0)) {
                        actualCode = Marshal.GetLastWin32Error();
                        throw new Win32Exception(actualCode);
                    }
                }) });
                if (actualCode != 5 || !child.HasExited)
                    throw new Exception("Expected actual exited-helper Win32 error 5, got " + actualCode);
                cases.Add("actual exited-helper Win32 error 5 is confirmed and safely reaped");
                stop.Invoke(null, new object[] { child });
                cases.Add("already-exited owned helper shutdown is idempotent");
                var unrelated = false;
                try {
                    guarded.Invoke(null, new object[] { (Func<bool>)(() => false),
                        (Action)(() => { throw new Win32Exception(6); }) });
                } catch (TargetInvocationException error) {
                    var failure = error.InnerException as Win32Exception;
                    unrelated = failure != null && failure.NativeErrorCode == 6;
                }
                if (!unrelated) throw new Exception("Unrelated termination failure was hidden");
                cases.Add("unrelated native termination failure remains visible");
            } finally {
                if (!child.HasExited) { child.Kill(); child.WaitForExit(5000); }
            }
        }
        return cases.ToArray();
    }
}
'@
    foreach ($case in [NativeStopFixture]::Run([Papercusp.Workbench.PuiReadBridge], $pui)) { $passed.Add($case) }
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
