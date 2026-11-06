param([Parameter(Mandatory=$true)][string]$SourceDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw 'Native WPF fixture requires -STA' }
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml, System.Web.Extensions
$references = @('System.dll','System.Core.dll','System.Xaml.dll','System.Web.Extensions.dll',
    [Windows.Window].Assembly.Location, [Windows.Media.Brushes].Assembly.Location,
    [Windows.Threading.Dispatcher].Assembly.Location, [Windows.Automation.AutomationProperties].Assembly.Location)
$fixture = @'
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using Papercusp.Workbench;
public static class WorkbenchNativeHostFixture
{
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int Style(IntPtr h, int n);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr h, uint msg, IntPtr a, IntPtr b);
    private static readonly List<string> cases = new List<string>();
    private static Dictionary<string, object> Json(string text)
    { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(text); }
    private static void Check(bool ok, string name)
    {
        if (!ok) throw new Exception(name);
        cases.Add(name); Console.Error.WriteLine("PASS " + name);
    }
    private static void Pump()
    {
        var frame = new DispatcherFrame();
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(100) };
        timer.Tick += (s, e) => { timer.Stop(); frame.Continue = false; };
        timer.Start(); Dispatcher.PushFrame(frame);
    }
    public static string Run()
    {
        var state = new PanelState(); var g = state.BeginRefresh();
        state.Settle("plans", g, Json("{\"rows\":[{\"harness\":\"one\",\"slug\":\"same\",\"title\":\"Shared title\"},{\"harness\":\"two\",\"slug\":\"same\",\"title\":\"Shared title\"}],\"version\":\"canonical\"}"), null);
        Check(state.Results().Count == 2 && state.Results()[0].Key != state.Results()[1].Key, "plan identity includes canonical harness and slug");
        Check(state.Sources["plans"].Version.Equals("canonical"), "canonical version retained");
        state.Query = "shared same"; Check(state.Results().Count == 2, "all search terms match canonical text");
        state.Query = "unmatched"; Check(state.Results().Count == 0, "unmatched query returns no results"); state.Query = "";
        state.Settle("agents", g, Json("{\"rows\":[{\"active\":[],\"ended\":[{\"id\":41,\"coordOwnerId\":\"exact\",\"host\":\"remote\"}],\"pending\":[],\"starting\":[]}] }"), null);
        var ended = state.Sources["agents"].Rows.Single();
        Check(ended.Row["advSessionId"].Equals(41) && ended.Row["ownerId"].Equals("exact") && ended.Row["sessionState"].Equals("ended"), "ended roster preserves launch owner and host identity");
        var old = g; g = state.BeginRefresh();
        Check(!state.Settle("plans", old, Json("{\"rows\":[]}"), null) && state.Sources["plans"].Status == "loading", "stale refresh cannot replace a newer request");
        state.Settle("plans", g, Json("{\"rows\":[{\"slug\":\"missing-harness\"}]}"), null);
        Check(state.Sources["plans"].Status == "unavailable", "missing canonical identity fails closed");
        state.Settle("reports", g, Json("{\"rows\":[],\"ok\":false}"), null);
        state.Settle("goals", g, Json("{\"rows\":[{\"goals\":[],\"partial\":true}]}"), null);
        Check(state.Sources["reports"].Status == "unavailable" && state.Sources["goals"].Status == "ready" && state.Sources["goals"].Partial, "unavailable empty and partial are distinct");
        var many = new List<object>(); for (var i = 0; i < 30; ++i) many.Add(new { report_id = "r" + i, title = "Report " + i });
        state.Settle("reports", g, new Dictionary<string, object> { { "rows", new JavaScriptSerializer().DeserializeObject(new JavaScriptSerializer().Serialize(many)) } }, null);
        Check(state.Results().Count == 26 && state.Results(true).Count == 30, "result paging retains undisplayed canonical rows");
        state.ResultLimit += 26; Check(state.Results().Count == 30, "show more exposes the remaining results");
        state.Selection = "retained"; state.Query = "draft"; state.Visible = true; state.Pinned = true; state.OutsideFocus();
        Check(state.Visible && state.Query == "draft" && state.Selection == "retained", "pinned outside focus retains draft and selection");
        state.Detail = "detail";
        Check(state.Escape() == "detail" && state.Visible && state.Escape() == "panel" && !state.Visible, "Escape closes detail before panel");
        var plan = PanelState.Result("plans", Json("{\"harness\":\"selected\",\"slug\":\"literal +/=\"}"));
        Check(PanelState.DetailArgs(plan)["harness"].Equals("selected") && PanelState.DetailArgs(plan)["slug"].Equals("literal +/="), "detail routes exact harness and literal identity");
        using (var host = new WorkbenchHost("C:\\nonexistent-workbench-fixture-pui.exe"))
        using (var collision = new WorkbenchHost("C:\\nonexistent-workbench-fixture-pui.exe"))
        {
            var keys = new Dictionary<string, Hotkey> { { "quick-access", new Hotkey(7, 0x7A) }, { "goals", new Hotkey(7, 0x7B) } };
            host.Configure(keys);
            var refused = false;
            try { collision.Configure(keys); } catch (InvalidOperationException) { refused = true; }
            Check(refused && collision.BindingCount == 0 && host.BindingCount == 2, "native shortcut collision preserves live owner");
            var duplicate = false;
            try { host.Configure(new Dictionary<string, Hotkey> { { "quick-access", new Hotkey(7, 0x7A) }, { "goals", new Hotkey(7, 0x7A) } }); }
            catch (ArgumentException) { duplicate = true; }
            Check(duplicate && host.BindingCount == 2, "duplicate shortcut edit preserves both prior bindings");
            host.Toggle("quick-access"); Pump();
            var panel = host.Panel("quick-access"); var hwnd = new WindowInteropHelper(panel).Handle;
            Check(panel.IsVisible && panel.WindowStyle == WindowStyle.None && !panel.ShowInTaskbar &&
                (Style(hwnd, -20) & 0x80) != 0 && (Style(hwnd, -20) & 0x40000) == 0 &&
                (Style(hwnd, -16) & 0xC00000) == 0, "real HWND is chrome-free tool window without taskbar identity");
            Check(host.State("quick-access").Sources.Values.All(source => source.Status == "unavailable"), "failed PUI reads remain visible as unavailable");
            host.State("quick-access").Query = "draft";
            host.Toggle("quick-access"); Pump(); host.Toggle("quick-access"); Pump();
            Check(host.Panel("quick-access") == panel && host.State("quick-access").Query == "draft", "shortcut toggle retains resident window and query");
            host.State("quick-access").Pinned = true; host.Toggle("goals"); Pump();
            Check(host.State("quick-access").Visible && host.State("goals").Visible, "independent pin permits both surfaces");
            host.Configure(new Dictionary<string, Hotkey> { { "goals", keys["quick-access"] }, { "quick-access", keys["goals"] } });
            Check(host.BindingCount == 2, "atomic shortcut swap reuses native registrations");
            host.Configure(new Dictionary<string, Hotkey>());
            collision.Configure(keys);
            Check(host.BindingCount == 0 && collision.BindingCount == 2, "disable releases shortcuts for another native owner");
        }
        return new JavaScriptSerializer().Serialize(new { ok = true, platform = "windows", cases = cases.ToArray(), count = cases.Count,
            processSessionId = System.Diagnostics.Process.GetCurrentProcess().SessionId, scope = "native-model-and-WPF-HWND-fixture" });
    }
}
'@
$fixtureFile = Join-Path ([IO.Path]::GetTempPath()) ('workbench-host-' + [Guid]::NewGuid().ToString('N') + '.cs')
try {
    [IO.File]::WriteAllText($fixtureFile, $fixture)
    Add-Type -Path @((Join-Path $SourceDirectory 'PuiReadBridge.cs'),
        (Join-Path $SourceDirectory 'WorkbenchModel.cs'), (Join-Path $SourceDirectory 'WorkbenchHost.cs'), $fixtureFile) -ReferencedAssemblies $references
} finally { if (Test-Path -LiteralPath $fixtureFile) { Remove-Item -LiteralPath $fixtureFile -Force } }
try { [WorkbenchNativeHostFixture]::Run() }
catch { [Console]::Error.WriteLine($_.Exception.ToString()); throw }
