using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

namespace Papercusp.Workbench
{
    public sealed class Hotkey
    {
        public uint Modifiers, Key;
        public Hotkey(uint modifiers, uint key) { Modifiers = modifiers; Key = key; }
        public string Identity { get { return Modifiers + ":" + Key; } }
    }

    // A hidden Win32 message window owns global shortcuts for the signed-in
    // session. WPF tool windows are created once and remain resident when hidden.
    public sealed class WorkbenchHost : IDisposable
    {
        [DllImport("user32.dll", SetLastError = true)] private static extern bool RegisterHotKey(IntPtr h, int id, uint modifiers, uint key);
        [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr h, int id);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr h);
        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(IntPtr h, int index);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongW")] private static extern int SetWindowLong(IntPtr h, int index, int value);
        private readonly HwndSource messages;
        private readonly Dictionary<string, Binding> bindings = new Dictionary<string, Binding>();
        private readonly Dictionary<string, NativePanel> panels = new Dictionary<string, NativePanel>();
        private int serial;
        private bool disposed;
        private sealed class Binding { public int Id; public Hotkey Key; }
        public WorkbenchHost(string pui)
        {
            var args = new HwndSourceParameters("Papercusp resident Workbench shortcuts")
            { ParentWindow = new IntPtr(-3), WindowStyle = 0, Width = 0, Height = 0 };
            messages = new HwndSource(args); messages.AddHook(Message);
            panels.Add("quick-access", new NativePanel(pui, "Quick Access", "all"));
            panels.Add("goals", new NativePanel(pui, "Goals", "goals"));
        }
        public Window Panel(string name) { return panels[name]; }
        public PanelState State(string name) { return panels[name].State; }
        public int BindingCount { get { return bindings.Count; } }
        public void Configure(Dictionary<string, Hotkey> desired)
        {
            if (disposed) throw new ObjectDisposedException("WorkbenchHost");
            if (desired.Keys.Any(name => !panels.ContainsKey(name))) throw new ArgumentException("Unsupported Workbench panel");
            if (desired.Values.Select(key => key.Identity).Distinct().Count() != desired.Count)
                throw new ArgumentException("Each Workbench panel needs a different shortcut");
            var next = new Dictionary<string, Binding>();
            var acquired = new List<Binding>();
            try
            {
                foreach (var pair in desired)
                {
                    var binding = bindings.Values.FirstOrDefault(b => b.Key.Identity == pair.Value.Identity);
                    if (binding == null)
                    {
                        binding = new Binding { Id = ++serial, Key = pair.Value };
                        // MOD_NOREPEAT prevents a held shortcut from toggling repeatedly.
                        if (!RegisterHotKey(messages.Handle, binding.Id, pair.Value.Modifiers | 0x4000, pair.Value.Key))
                        {
                            var error = new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                            throw new InvalidOperationException("Shortcut unavailable; previous bindings retained (" +
                                pair.Value.Identity + ": " + error.Message + ")", error);
                        }
                        acquired.Add(binding);
                    }
                    next.Add(pair.Key, binding);
                }
            }
            catch
            {
                foreach (var binding in acquired) UnregisterHotKey(messages.Handle, binding.Id);
                throw;
            }
            foreach (var binding in bindings.Values.Where(b => !next.Values.Contains(b)))
                UnregisterHotKey(messages.Handle, binding.Id);
            bindings.Clear(); foreach (var pair in next) bindings.Add(pair.Key, pair.Value);
        }
        private IntPtr Message(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            if (message == 0x0312)
            {
                var match = bindings.FirstOrDefault(pair => pair.Value.Id == wParam.ToInt32());
                if (match.Key != null) Toggle(match.Key);
                handled = true;
            }
            return IntPtr.Zero;
        }
        public void Toggle(string surface)
        {
            var panel = panels[surface];
            if (panel.State.Visible) { panel.Dismiss(true); return; }
            foreach (var other in panels.Values.Where(p => p != panel && !p.State.Pinned)) other.Dismiss(false);
            panel.Summon();
        }
        public void Dispose()
        {
            if (disposed) return; disposed = true;
            foreach (var binding in bindings.Values) UnregisterHotKey(messages.Handle, binding.Id);
            bindings.Clear(); messages.RemoveHook(Message); messages.Dispose();
            foreach (var panel in panels.Values) panel.Shutdown();
        }

        private sealed class NativePanel : Window
        {
            internal readonly PanelState State = new PanelState();
            private readonly string pui;
            private readonly TextBox search, detail;
            private readonly TextBlock status;
            private readonly ListBox results;
            private readonly Button more;
            private readonly DispatcherTimer debounce;
            private CancellationTokenSource refresh, detailRead;
            private IntPtr priorWindow;
            private bool shuttingDown, ready;
            internal NativePanel(string executable, string title, string scope)
            {
                pui = executable; State.Scope = scope;
                Title = "Papercusp Workbench " + title;
                AutomationProperties.SetName(this, Title);
                WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
                ShowInTaskbar = false; Topmost = true;
                Background = Brushes.WhiteSmoke; Foreground = Brushes.Black;
                Width = 440; MinWidth = 200;
                var layout = new DockPanel { Margin = new Thickness(16) }; Content = layout;
                var header = new StackPanel { Orientation = Orientation.Horizontal };
                DockPanel.SetDock(header, Dock.Top); layout.Children.Add(header);
                header.Children.Add(new TextBlock { Text = title, FontSize = 22, Margin = new Thickness(0, 0, 12, 12) });
                var pin = new Button { Content = "Pin", Margin = new Thickness(4) };
                pin.Click += (s, e) => { State.Pinned = !State.Pinned; pin.Content = State.Pinned ? "Unpin" : "Pin"; };
                header.Children.Add(pin);
                var reload = new Button { Content = "Refresh", Margin = new Thickness(4) };
                reload.Click += (s, e) => Refresh(); header.Children.Add(reload);
                var close = new Button { Content = "Close", Margin = new Thickness(4) };
                close.Click += (s, e) => Dismiss(true); header.Children.Add(close);
                var controls = new StackPanel(); DockPanel.SetDock(controls, Dock.Top); layout.Children.Add(controls);
                search = new TextBox { FontSize = 16, Margin = new Thickness(0, 8, 0, 8) };
                AutomationProperties.SetName(search, "Search Workbench"); controls.Children.Add(search);
                if (scope == "all")
                {
                    var filter = new ComboBox { ItemsSource = new[] { "all", "plans", "agents", "reports", "goals" }, SelectedIndex = 0 };
                    AutomationProperties.SetName(filter, "Search scope"); controls.Children.Add(filter);
                    filter.SelectionChanged += (s, e) => { State.Scope = (string)filter.SelectedItem; Schedule(); };
                }
                status = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8, 0, 8) };
                controls.Children.Add(status);
                more = new Button { Content = "Show more results", Visibility = Visibility.Collapsed };
                more.Click += (s, e) => { State.ResultLimit += 26; Render(); };
                DockPanel.SetDock(more, Dock.Bottom); layout.Children.Add(more);
                var body = new Grid(); layout.Children.Add(body);
                results = new ListBox { FontSize = 15 }; body.Children.Add(results);
                AutomationProperties.SetName(results, "Workbench results");
                results.SelectionChanged += (s, e) => { var row = results.SelectedItem as PanelResult; if (row != null) State.Selection = row.Key; };
                results.MouseDoubleClick += (s, e) => OpenSelected();
                detail = new TextBox { IsReadOnly = true, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap,
                    VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Visibility = Visibility.Collapsed };
                AutomationProperties.SetName(detail, "Canonical item detail"); body.Children.Add(detail);
                debounce = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(180) };
                debounce.Tick += (s, e) => { debounce.Stop(); Refresh(); };
                search.TextChanged += (s, e) => { State.Query = search.Text; Schedule(); };
                PreviewKeyDown += (s, e) =>
                {
                    if (e.Key == Key.Escape)
                    {
                        CancelDetail();
                        if (State.Escape() == "panel") Dismiss(true); else Render();
                        e.Handled = true;
                    }
                    else if (e.Key == Key.Enter && State.Detail == null) { OpenSelected(); e.Handled = true; }
                    else if ((e.Key == Key.Down || e.Key == Key.Up) && search.IsKeyboardFocusWithin)
                    {
                        var count = results.Items.Count;
                        if (count > 0) results.SelectedIndex = (results.SelectedIndex + (e.Key == Key.Down ? 1 : count - 1) + count) % count;
                        e.Handled = true;
                    }
                };
                Deactivated += (s, e) => { State.OutsideFocus(); if (!State.Visible) Dismiss(false); };
                SourceInitialized += (s, e) =>
                {
                    var h = new WindowInteropHelper(this).Handle;
                    SetWindowLong(h, -20, (GetWindowLong(h, -20) | 0x80) & ~0x40000);
                };
                Closing += (s, e) => { if (!shuttingDown) { e.Cancel = true; Dismiss(true); } };
                SystemParameters.StaticPropertyChanged += SystemChanged;
                ready = true;
            }
            private void SystemChanged(object sender, System.ComponentModel.PropertyChangedEventArgs e)
            { if (State.Visible) Dispatcher.BeginInvoke(new Action(Position)); }
            private void Position()
            {
                var area = SystemParameters.WorkArea;
                Width = Math.Min(440, Math.Max(200, area.Width - 24));
                Height = Math.Max(160, area.Height - 24); Left = area.Right - Width - 12; Top = area.Top + 12;
            }
            internal void Summon()
            {
                priorWindow = GetForegroundWindow(); State.Visible = true; Position(); Show(); Activate(); search.Focus(); Refresh();
            }
            internal void Dismiss(bool restore)
            {
                State.Visible = false; debounce.Stop();
                if (refresh != null) { refresh.Cancel(); refresh.Dispose(); refresh = null; }
                ++State.Generation; CancelDetail();
                var ownedFocus = IsActive; Hide();
                if (restore && ownedFocus && IsWindow(priorWindow)) SetForegroundWindow(priorWindow);
            }
            private void Schedule() { if (ready && State.Visible) { debounce.Stop(); debounce.Start(); } }
            private async void Refresh()
            {
                if (!State.Visible) return;
                if (refresh != null) { refresh.Cancel(); refresh.Dispose(); }
                refresh = new CancellationTokenSource();
                var token = refresh.Token; var generation = State.BeginRefresh();
                Render();
                var tasks = State.Sources.Keys.ToArray().Select(async kind =>
                {
                    Dictionary<string, object> payload = null; Exception failure = null;
                    var args = new Dictionary<string, object>();
                    if (kind == "reports" || kind == "goals")
                    { args["query"] = State.Query; args["limit"] = kind == "goals" ? 500 : 200; }
                    try { payload = await PuiReadBridge.ReadAsync(pui, PanelState.Models[kind], args, token); }
                    catch (Exception error) { failure = error; }
                    if (!token.IsCancellationRequested && State.Settle(kind, generation, payload, failure)) Render();
                }).ToArray();
                await Task.WhenAll(tasks);
            }
            private void Render()
            {
                if (shuttingDown) return;
                status.Text = String.Join("\n", PanelState.Kinds.Where(k => State.Sources.ContainsKey(k)).Select(k =>
                {
                    var source = State.Sources[k];
                    return k + ": " + (source.Status == "ready" ?
                        (source.Rows.Count == 0 ? "No results" : source.Rows.Count + " returned") +
                        (source.Partial ? " · Partial results" : "") + (source.Error == null ? "" : " · " + source.Error) :
                        source.Status + (source.Error == null ? "" : " · " + source.Error));
                }));
                var rows = State.Results(); var selected = State.Selection;
                results.ItemsSource = rows;
                results.SelectedItem = rows.FirstOrDefault(row => row.Key == selected) ?? rows.FirstOrDefault();
                detail.Text = State.Detail ?? "";
                detail.Visibility = State.Detail == null ? Visibility.Collapsed : Visibility.Visible;
                results.Visibility = State.Detail == null ? Visibility.Visible : Visibility.Collapsed;
                more.Visibility = State.Detail == null && State.Results(true).Count > rows.Count ? Visibility.Visible : Visibility.Collapsed;
            }
            private void CancelDetail()
            {
                ++State.DetailGeneration;
                if (detailRead != null) { detailRead.Cancel(); detailRead.Dispose(); detailRead = null; }
            }
            private async void OpenSelected()
            {
                var row = results.SelectedItem as PanelResult;
                if (row == null) return;
                CancelDetail(); var generation = State.DetailGeneration;
                if (row.Kind == "agents")
                {
                    State.Detail = "Exact terminal focus/resume is not yet available in this Windows host.\n" + row.Title;
                    Render(); return;
                }
                detailRead = new CancellationTokenSource(); var token = detailRead.Token;
                State.Detail = "Loading…"; Render();
                try
                {
                    var payload = await PuiReadBridge.ReadAsync(pui, row.Kind + (row.Kind == "goals" ? ".detail" : ".get"), PanelState.DetailArgs(row), token);
                    if (generation != State.DetailGeneration || token.IsCancellationRequested) return;
                    // Native selectable text keeps canonical report/plan content intact.
                    var json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
                    State.Detail = String.Join("\n\n", ((System.Collections.IList)payload["rows"]).Cast<object>().Select(item =>
                    {
                        var map = item as Dictionary<string, object>; object body;
                        return map != null && (map.TryGetValue("body_md", out body) || map.TryGetValue("content", out body)) && body is string ?
                            (string)body : json.Serialize(item);
                    }));
                }
                catch (Exception error)
                {
                    if (generation != State.DetailGeneration || token.IsCancellationRequested) return;
                    State.Detail = "Unavailable · " + error.Message;
                }
                Render();
            }
            internal void Shutdown()
            {
                shuttingDown = true; Dismiss(false);
                SystemParameters.StaticPropertyChanged -= SystemChanged; Close();
            }
        }
    }
}
