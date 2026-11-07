using System;
using System.Collections.Generic;
using System.Linq;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
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
        private delegate bool EnumWindow(IntPtr hwnd, IntPtr parameter);
        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindow callback, IntPtr parameter);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
        [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hwnd, int command);
        [DllImport("user32.dll")] private static extern IntPtr GetProcessWindowStation();
        [DllImport("user32.dll", SetLastError = true)] private static extern bool GetUserObjectInformation(
            IntPtr handle, int index, out UserObjectFlags flags, int length, out int required);
        [StructLayout(LayoutKind.Sequential)] private struct UserObjectFlags
        { public int Inherit, Reserved; public uint Flags; }
        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(IntPtr h, int index);
        [DllImport("user32.dll", EntryPoint = "SetWindowLongW")] private static extern int SetWindowLong(IntPtr h, int index, int value);
        private readonly HwndSource messages;
        private readonly Dictionary<string, Binding> bindings = new Dictionary<string, Binding>();
        private readonly Dictionary<string, NativePanel> panels = new Dictionary<string, NativePanel>();
        private int serial;
        private bool disposed;
        private sealed class Binding { public int Id; public Hotkey Key; }
        public static bool HasInteractiveDesktop
        {
            get
            {
                UserObjectFlags flags; int required;
                return GetUserObjectInformation(GetProcessWindowStation(), 1, out flags,
                    Marshal.SizeOf(typeof(UserObjectFlags)), out required) && (flags.Flags & 1) != 0;
            }
        }
        public WorkbenchHost(string pui)
        {
            if (!HasInteractiveDesktop)
                throw new InvalidOperationException("Workbench needs a signed-in interactive Windows desktop. Launch it in the user login session; service and SSH window stations cannot own global shortcuts.");
            var args = new HwndSourceParameters("Papercusp resident Workbench shortcuts")
            { ParentWindow = new IntPtr(-3), WindowStyle = 0, Width = 0, Height = 0 };
            messages = new HwndSource(args); messages.AddHook(Message);
            panels.Add("quick-access", new NativePanel(pui, "Quick Access", "all", Relayout));
            panels.Add("goals", new NativePanel(pui, "Goals", "goals", Relayout));
            panels.Add("accounts", new NativePanel(pui, "Accounts", "accounts", Relayout));
            panels.Add("inbox", new NativePanel(pui, "Inbox", "inbox", Relayout));
        }
        public Window Panel(string name) { return panels[name]; }
        public PanelState State(string name) { return panels[name].State; }
        public int BindingCount { get { return bindings.Count; } }
        public static Rect PanelBounds(Rect area, int count, int index)
        {
            if (count < 1 || index < 0 || index >= count || area.Width <= 0 || area.Height <= 0)
                throw new ArgumentOutOfRangeException("count");
            var gap = Math.Min(12, area.Width / (count * 4 + 2));
            var width = Math.Min(440, (area.Width - gap * (count + 1)) / count);
            var verticalGap = Math.Min(12, area.Height / 4);
            return new Rect(area.Right - gap - width - index * (width + gap),
                area.Top + verticalGap, width, area.Height - 2 * verticalGap);
        }
        private void Relayout()
        {
            var visible = new[] { "quick-access", "goals", "accounts", "inbox" }.Where(name => panels[name].State.Visible).ToArray();
            for (var i = 0; i < visible.Length; ++i)
                panels[visible[i]].Position(PanelBounds(SystemParameters.WorkArea, visible.Length, i));
        }
        private static Dictionary<IntPtr, string> DesktopWindows()
        {
            var windows = new Dictionary<IntPtr, string>();
            if (!EnumWindows((hwnd, parameter) =>
            {
                if (IsWindowVisible(hwnd))
                {
                    var text = new StringBuilder(32768); GetWindowText(hwnd, text, text.Capacity);
                    windows[hwnd] = text.ToString();
                }
                return true;
            }, IntPtr.Zero)) throw new InvalidOperationException("Could not inspect desktop terminals");
            return windows;
        }
        public void Configure(Dictionary<string, Hotkey> desired)
        {
            if (disposed) throw new ObjectDisposedException("WorkbenchHost");
            if (desired.Keys.Any(name => !panels.ContainsKey(name))) throw new ArgumentException("Unsupported Workbench panel");
            if (desired.Values.Any(key => key == null || key.Key == 0 || key.Key > 0xFE ||
                key.Key == 0x7B || (key.Modifiers & ~15u) != 0))
                throw new ArgumentException("Choose a valid shortcut. F12 is reserved by Windows for debuggers.");
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
            private readonly Button resume;
            private readonly AccountState accounts;
            private readonly List<Button> accountControls = new List<Button>();
            private readonly TextBlock accountScope, accountSummary;
            private readonly GoalState goal = new GoalState();
            private readonly WrapPanel goalControls;
            private readonly TextBlock goalStatus;
            private readonly InboxState inbox;
            private readonly StackPanel inboxContent, inboxList, inboxContext, inboxBulk, inboxConfirm;
            private readonly DispatcherTimer inboxTimer;
            private readonly List<Button> inboxControls = new List<Button>();
            private Dictionary<string, object> inboxEnvironment;
            private List<Dictionary<string, object>> inboxConfirmation;
            private string inboxRunId, inboxListKey, inboxContextKey, inboxBulkKey;
            internal Func<string, bool> ConfirmGoal;
            private readonly Action relayout;
            private readonly DispatcherTimer debounce;
            private CancellationTokenSource refresh, detailRead;
            private IntPtr priorWindow;
            private bool shuttingDown, ready, confirmingGoal;
            internal NativePanel(string executable, string title, string scope, Action layoutChanged)
            {
                pui = executable; State.Scope = scope; relayout = layoutChanged;
                Title = "Papercusp Workbench " + title;
                AutomationProperties.SetName(this, Title);
                WindowStyle = WindowStyle.None; ResizeMode = ResizeMode.NoResize;
                ShowInTaskbar = false; Topmost = true;
                Background = Brushes.WhiteSmoke; Foreground = Brushes.Black;
                Width = 440;
                var layout = new DockPanel { Margin = new Thickness(16) }; Content = layout;
                var header = new StackPanel { Orientation = Orientation.Horizontal };
                DockPanel.SetDock(header, Dock.Top); layout.Children.Add(header);
                header.Children.Add(new TextBlock { Text = title, FontSize = 22, Margin = new Thickness(0, 0, 12, 12) });
                var pin = new Button { Content = "Pin", Margin = new Thickness(4) };
                pin.Click += (s, e) => { State.Pinned = !State.Pinned; pin.Content = State.Pinned ? "Unpin" : "Pin"; relayout(); };
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
                AutomationProperties.SetName(status, "Workbench status");
                controls.Children.Add(status);
                if (scope == "accounts")
                {
                    accounts = new AccountState();
                    accountScope = new TextBlock { TextWrapping = TextWrapping.Wrap };
                    AutomationProperties.SetName(accountScope, "Account environment"); controls.Children.Add(accountScope);
                    accountSummary = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8, 0, 8) };
                    AutomationProperties.SetName(accountSummary, "Account steering"); controls.Children.Add(accountSummary);
                    var actions = new WrapPanel(); controls.Children.Add(actions);
                    foreach (var action in new[] { "default", "force", "exclude", "auto" })
                    {
                        var value = action;
                        var button = new Button { Content = Char.ToUpper(action[0]) + action.Substring(1), Margin = new Thickness(4), Tag = action };
                        AutomationProperties.SetName(button, "Account " + action);
                        button.Click += (s, e) => ApplyAccount(value); actions.Children.Add(button); accountControls.Add(button);
                    }
                }
                more = new Button { Content = "Show more results", Visibility = Visibility.Collapsed };
                more.Click += (s, e) => { State.ResultLimit += 26; Render(); };
                DockPanel.SetDock(more, Dock.Bottom); layout.Children.Add(more);
                resume = new Button { Content = "Resume selected session", Visibility = Visibility.Collapsed };
                AutomationProperties.SetName(resume, "Resume selected session");
                resume.Click += (s, e) => { var row = results.SelectedItem as PanelResult; if (row != null) ActivateAgent(row, true); };
                DockPanel.SetDock(resume, Dock.Bottom); layout.Children.Add(resume);
                var goalFooter = new StackPanel(); DockPanel.SetDock(goalFooter, Dock.Bottom); layout.Children.Add(goalFooter);
                goalStatus = new TextBlock { TextWrapping = TextWrapping.Wrap, Visibility = Visibility.Collapsed };
                AutomationProperties.SetName(goalStatus, "Goal control status"); goalFooter.Children.Add(goalStatus);
                goalControls = new WrapPanel { Visibility = Visibility.Collapsed }; goalFooter.Children.Add(goalControls);
                foreach (var action in new[] { "pause", "resume", "start", "reopen", "achieve", "kill" })
                {
                    var value = action;
                    var button = new Button { Content = action == "achieve" ? "Mark achieved" : Char.ToUpper(action[0]) + action.Substring(1),
                        Margin = new Thickness(4), Tag = action, Visibility = Visibility.Collapsed };
                    AutomationProperties.SetName(button, "Goal " + action);
                    button.Click += (s, e) => ApplyGoal(value); goalControls.Children.Add(button);
                }
                ConfirmGoal = message => MessageBox.Show(this, message, "Confirm goal action", MessageBoxButton.YesNo,
                    MessageBoxImage.Question, MessageBoxResult.No) == MessageBoxResult.Yes;
                var body = new Grid(); layout.Children.Add(body);
                if (scope == "inbox")
                {
                    inbox = new InboxState(); inboxContent = new StackPanel();
                    var scroll = new ScrollViewer { Content = inboxContent, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
                    AutomationProperties.SetName(scroll, "Inbox questions and saved run"); body.Children.Add(scroll);
                    var actions = new WrapPanel(); inboxContent.Children.Add(actions);
                    foreach (var operation in new[] { "start", "stop", "resume", "apply" })
                    {
                        var value = operation;
                        var label = operation == "start" ? "Resolve visible" : operation == "apply" ? "Apply selected" : operation == "stop" ? "Stop" : "Resume";
                        inboxControls.Add(InboxButton(actions, label, "Inbox " + operation, () => PrepareInbox(value)));
                    }
                    var runField = new TextBox { Margin = new Thickness(0, 8, 0, 4) };
                    AutomationProperties.SetName(runField, "Saved Inbox run ID"); inboxContent.Children.Add(runField);
                    runField.TextChanged += (s, e) => { inboxConfirmation = null; RenderInboxConfirmation(); };
                    inboxControls.Add(InboxButton(inboxContent, "Open saved run", "Inbox open saved run", () => { inboxRunId = String.IsNullOrWhiteSpace(runField.Text) ? null : runField.Text.Trim(); Refresh(); }));
                    inboxConfirm = new StackPanel(); inboxContent.Children.Add(inboxConfirm);
                    inboxList = new StackPanel(); inboxContent.Children.Add(inboxList);
                    inboxContext = new StackPanel(); inboxContent.Children.Add(inboxContext);
                    inboxBulk = new StackPanel(); inboxContent.Children.Add(inboxBulk);
                    inboxTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
                    inboxTimer.Tick += async (s, e) => { inboxTimer.Stop(); await FollowInboxRun(); };
                }
                results = new ListBox { FontSize = 15 }; body.Children.Add(results);
                if (inbox != null) results.Visibility = Visibility.Collapsed;
                AutomationProperties.SetName(results, "Workbench results");
                results.SelectionChanged += (s, e) =>
                {
                    var row = results.SelectedItem as PanelResult;
                    if (row != null) State.Selection = row.Key;
                    resume.Visibility = row != null && row.Kind == "agents" && PanelState.Text(row.Row, "sessionState") == "ended" ?
                        Visibility.Visible : Visibility.Collapsed;
                    if (accounts != null) UpdateAccountControls();
                };
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
                        if (inbox != null)
                        {
                            if (inboxConfirmation != null) { inboxConfirmation = null; RenderInboxConfirmation(); }
                            else if (inbox.DismissContext()) RenderInbox(); else Dismiss(true);
                            e.Handled = true; return;
                        }
                        CancelDetail();
                        if (State.Escape() == "panel") Dismiss(true); else Render();
                        e.Handled = true;
                    }
                    else if (e.Key == Key.Enter && State.Detail == null && inbox == null) { OpenSelected(); e.Handled = true; }
                    else if ((e.Key == Key.Down || e.Key == Key.Up) && search.IsKeyboardFocusWithin)
                    {
                        var count = results.Items.Count;
                        if (count > 0) results.SelectedIndex = (results.SelectedIndex + (e.Key == Key.Down ? 1 : count - 1) + count) % count;
                        e.Handled = true;
                    }
                };
                Deactivated += (s, e) => { if (!confirmingGoal) { State.OutsideFocus(); if (!State.Visible) Dismiss(false); } };
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
            { if (State.Visible) Dispatcher.BeginInvoke(relayout); }
            internal void Position(Rect bounds)
            {
                Width = bounds.Width; Height = bounds.Height; Left = bounds.Left; Top = bounds.Top;
            }
            internal void Summon()
            {
                priorWindow = GetForegroundWindow(); State.Visible = true; relayout(); Show(); Activate(); search.Focus(); Refresh();
            }
            internal void Dismiss(bool restore)
            {
                State.Visible = false; debounce.Stop();
                if (accounts != null) { ++accounts.Generation; accounts.Busy = false; }
                if (inbox != null) { ++inbox.Generation; inbox.ClearContext(); inboxConfirmation = null; inboxTimer.Stop(); }
                if (refresh != null) { refresh.Cancel(); refresh.Dispose(); refresh = null; }
                ++State.Generation; CancelDetail();
                var ownedFocus = IsActive; Hide();
                relayout();
                if (restore && ownedFocus && IsWindow(priorWindow)) SetForegroundWindow(priorWindow);
            }
            private void Schedule()
            { if (ready && State.Visible) { if (accounts != null) RenderAccounts(); else if (inbox != null) { inboxConfirmation = null; inbox.RetainVisibleSelection(State.Query); RenderInbox(); } else { debounce.Stop(); debounce.Start(); } } }
            private async void Refresh()
            {
                if (!State.Visible) return;
                if (inbox != null && inbox.Pending) return;
                CancelDetail(); State.Detail = null;
                if (refresh != null) { refresh.Cancel(); refresh.Dispose(); }
                refresh = new CancellationTokenSource();
                if (accounts != null) { await RefreshAccounts(refresh.Token); return; }
                if (inbox != null) { await RefreshInbox(refresh.Token); return; }
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
                if (accounts != null) { RenderAccounts(); return; }
                if (inbox != null) { RenderInbox(); return; }
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
                if (State.Detail != null) resume.Visibility = Visibility.Collapsed;
                more.Visibility = State.Detail == null && State.Results(true).Count > rows.Count ? Visibility.Visible : Visibility.Collapsed;
                RenderGoalControls();
            }
            private void CancelDetail()
            {
                ++State.DetailGeneration;
                goal.Clear();
                if (detailRead != null) { detailRead.Cancel(); detailRead.Dispose(); detailRead = null; }
            }
            private static Button InboxButton(Panel parent, string label, string name, Action action, bool enabled = true)
            {
                var button = new Button { Content = label, Margin = new Thickness(4), IsEnabled = enabled };
                AutomationProperties.SetName(button, name); button.Click += (s, e) => action(); parent.Children.Add(button); return button;
            }
            private static void InboxText(Panel parent, string text)
            { parent.Children.Add(new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 5, 0, 5) }); }
            private bool InboxCurrent(int generation, CancellationToken token)
            { return !shuttingDown && State.Visible && !token.IsCancellationRequested && generation == inbox.Generation; }
            private void CheckInboxEnvironment(Dictionary<string, object> payload, Dictionary<string, object> expected)
            {
                if (!AccountState.SameEnvironment(expected, InboxState.Value(payload, "environment") as Dictionary<string, object>))
                    throw new InvalidOperationException("Selected environment changed; refresh Inbox");
            }
            private async Task RefreshInbox(CancellationToken token)
            {
                inboxTimer.Stop(); inboxConfirmation = null; inboxEnvironment = null;
                var generation = inbox.Begin(); var runId = inboxRunId; RenderInbox();
                try
                {
                    var environment = InboxState.One(await PuiReadBridge.ReadAsync(pui, "operator.identity", null, token));
                    if (!AccountState.SameEnvironment(environment, environment)) throw new InvalidOperationException("Selected environment is unavailable");
                    if (!InboxCurrent(generation, token)) return;
                    inboxEnvironment = environment;
                    await Task.WhenAll(new[] { "plans.attention", "plans.attentionBulkRun" }.Select(async name =>
                    {
                        Dictionary<string, object> payload = null; Exception failure = null;
                        try
                        {
                            var args = new Dictionary<string, object>(); if (name == "plans.attentionBulkRun" && runId != null) args["runId"] = runId;
                            payload = await PuiReadBridge.ReadAsync(pui, name, args, token, 22000, environment);
                            CheckInboxEnvironment(payload, environment);
                        }
                        catch (Exception error) { failure = error; }
                        if (!InboxCurrent(generation, token)) return;
                        if (name == "plans.attention") inbox.SettleList(generation, payload, failure);
                        else inbox.SettleBulk(generation, payload, runId, failure);
                        RenderInbox();
                    }));
                    if (InboxCurrent(generation, token))
                    {
                        if (inbox.Selection != null) LoadInboxContext(inbox.Selection);
                        if (inbox.SavedRunId != null) inboxTimer.Start();
                    }
                }
                catch (Exception error)
                {
                    if (!InboxCurrent(generation, token)) return;
                    inbox.SettleList(generation, null, error); inbox.SettleBulk(generation, null, runId, error); RenderInbox();
                }
            }
            private async Task FollowInboxRun()
            {
                if (refresh == null || !State.Visible || inbox.SavedRunId == null) return;
                var token = refresh.Token; var generation = inbox.Generation; var runId = inbox.SavedRunId;
                try
                {
                    if (!inbox.Pending)
                    {
                        var payload = await PuiReadBridge.ReadAsync(pui, "plans.attentionBulkRun", new Dictionary<string, object> { { "runId", runId } }, token, 22000, inboxEnvironment);
                        CheckInboxEnvironment(payload, inboxEnvironment);
                        if (InboxCurrent(generation, token)) inbox.SettleLiveBulk(generation, runId, payload);
                    }
                }
                catch (Exception error) { if (InboxCurrent(generation, token)) inbox.SettleLiveBulk(generation, runId, null, error); }
                if (InboxCurrent(generation, token)) { RenderInbox(); if (inbox.SavedRunId != null) inboxTimer.Start(); }
            }
            private async void LoadInboxContext(string id)
            {
                if (refresh == null || inbox.Pending) return;
                CancelDetail(); inboxConfirmation = null;
                var contextToken = inbox.Select(id); var generation = inbox.Generation;
                detailRead = CancellationTokenSource.CreateLinkedTokenSource(refresh.Token); var token = detailRead.Token;
                var environment = inboxEnvironment; RenderInbox();
                try
                {
                    var payload = await PuiReadBridge.ReadAsync(pui, "plans.attentionItem", new Dictionary<string, object> { { "itemId", id } }, token, 22000, environment);
                    CheckInboxEnvironment(payload, environment);
                    if (InboxCurrent(generation, token)) inbox.SettleContext(contextToken, id, payload);
                }
                catch (Exception error) { if (InboxCurrent(generation, token)) inbox.SettleContext(contextToken, id, null, error); }
                if (InboxCurrent(generation, token)) RenderInbox();
            }
            private void PrepareInbox(string operation, string actionId = null)
            {
                try
                {
                    var requests = operation == "apply" ? inbox.Items.Where(row => inbox.SelectedReviews.Contains(InboxState.Text(row, "itemId")))
                        .Select(row => inbox.Request("apply", inboxEnvironment, itemId: InboxState.Text(row, "itemId"))).ToList() :
                        new List<Dictionary<string, object>> { inbox.Request(operation, inboxEnvironment, State.Query, actionId: actionId, answer: inbox.Answer) };
                    if (requests.Count == 0) throw new InvalidOperationException("Select recommendations first");
                    inboxConfirmation = requests;
                }
                catch (Exception error) { inbox.ActionNotice = error.Message; inboxConfirmation = null; }
                RenderInbox();
            }
            private async void ConfirmInbox()
            {
                var requests = inboxConfirmation; if (requests == null || refresh == null) return;
                inboxConfirmation = null; var actionToken = 0;
                try
                {
                    if (!AccountState.SameEnvironment(inboxEnvironment, InboxState.Value(requests[0], "environment") as Dictionary<string, object>))
                        throw new InvalidOperationException("Selected environment changed; review again");
                    actionToken = inbox.BeginAction(requests); RenderInbox();
                    foreach (var request in requests)
                    {
                        var payload = await PuiReadBridge.InboxAsync(pui, request, refresh.Token);
                        var admitted = inbox.RecordAction(actionToken, request, payload); if (admitted != null) inboxRunId = admitted;
                    }
                    inbox.FinishAction(actionToken);
                }
                catch (Exception error) { if (actionToken != 0) inbox.FinishAction(actionToken, error); else inbox.ActionNotice = error.Message; }
                if (State.Visible) Refresh();
            }
            private void RenderInboxConfirmation()
            {
                if (inboxConfirm == null) return;
                inboxConfirm.Children.Clear(); if (inboxConfirmation == null) return;
                var first = inboxConfirmation[0]; var items = InboxState.Value(first, "items") as System.Collections.IList;
                var expected = InboxState.Value(first, "expected") as Dictionary<string, object>;
                InboxText(inboxConfirm, "Confirm " + InboxState.Text(first, "operation") + ": " +
                    (items != null ? items.Count + " visible questions" : inboxConfirmation.Count > 1 ? inboxConfirmation.Count + " recommendations" : expected != null ? InboxState.Text(expected, "id") : InboxState.Text(first, "runId")));
                InboxButton(inboxConfirm, "Confirm action", "Inbox confirm action", ConfirmInbox, !inbox.Pending);
                InboxButton(inboxConfirm, "Cancel", "Inbox cancel action", () => { inboxConfirmation = null; RenderInboxConfirmation(); });
            }
            private void RenderInbox()
            {
                if (shuttingDown) return;
                inbox.RetainVisibleSelection(State.Query); var rows = inbox.Results(State.Query);
                var runStatus = inbox.BulkError != null ? "Saved run unavailable · " + inbox.BulkError : !inbox.BulkReady ? "Loading saved run…" : "No saved bulk run";
                if (inbox.BulkReady && inbox.Run != null)
                {
                    var c = InboxState.Counts(inbox.Run, inbox.Items);
                    runStatus = "Run " + InboxState.Text(inbox.Run, "runId") + " · " + InboxState.Text(inbox.Run, "phase") + "\n" +
                        c["decided"] + "/" + c["total"] + " decided · " + c["percent"] + "% · " + c["resolved"] + " resolved · " + c["unresolved"] + " need attention · " + c["left"] + " left";
                }
                status.Text = (inbox.ListError != null ? "Inbox unavailable · " + inbox.ListError : inbox.ListReady ? rows.Count + " questions" + (inbox.ListPartial ? " · Partial list" : "") : "Loading questions…") +
                    "\n" + InboxState.Text(inboxEnvironment, "endpoint") + " · " + InboxState.Text(inboxEnvironment, "workspaceId") + "\n" + runStatus +
                    (inbox.Pending ? "\nApplying action…" : "") + (inbox.ActionNotice == null ? "" : "\n" + inbox.ActionNotice);
                foreach (var button in inboxControls) button.IsEnabled = !inbox.Pending;
                RenderInboxConfirmation();
                var json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
                var listKey = json.Serialize(new object[] { rows, inbox.Selection, inbox.Pending });
                if (listKey != inboxListKey)
                {
                    inboxListKey = listKey; inboxList.Children.Clear();
                    foreach (var row in rows)
                    {
                        var id = InboxState.Text(row, "id");
                        InboxButton(inboxList, InboxState.Text(row, "title") == "" ? id : InboxState.Text(row, "title"), "Inbox question " + id, () => LoadInboxContext(id), !inbox.Pending);
                    }
                }
                var contextKey = json.Serialize(new object[] { inbox.Context, inbox.Selection, inbox.ContextError, inbox.Pending });
                if (contextKey != inboxContextKey)
                {
                    inboxContextKey = contextKey; inboxContext.Children.Clear(); var row = inbox.Context;
                    InboxText(inboxContext, row == null ? inbox.ContextError ?? (inbox.Selection == null ? "Select a question to view context." : "Loading selected question…") :
                        String.Join("\n", new[] { "title", "body", "contextMarkdown" }.Select(key => InboxState.Text(row, key))));
                    if (row != null)
                    {
                        var answer = new TextBox { Text = inbox.Answer, AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, IsEnabled = !inbox.Pending };
                        AutomationProperties.SetName(answer, "Answer selected question");
                        answer.TextChanged += (s, e) => { inbox.Answer = answer.Text; inboxConfirmation = null; RenderInboxConfirmation(); }; inboxContext.Children.Add(answer);
                        foreach (var action in InboxState.Actions(row))
                        {
                            var id = InboxState.Text(action, "id");
                            InboxButton(inboxContext, InboxState.Text(action, "label") == "" ? id : InboxState.Text(action, "label"), "Inbox resolve " + id, () => PrepareInbox("resolve", id), !inbox.Pending);
                        }
                    }
                }
                var bulkKey = json.Serialize(new object[] { inbox.Items, InboxState.Text(inbox.Run, "phase"), inbox.Pending });
                if (bulkKey != inboxBulkKey)
                {
                    inboxBulkKey = bulkKey; inboxBulk.Children.Clear(); string previous = null;
                    foreach (var row in inbox.Items.Where(item => !new[] { "auto_resolved", "dismissed" }.Contains(InboxState.Text(item, "outcome"))))
                    {
                        var disposition = InboxState.Disposition(row); if (previous != disposition) { InboxText(inboxBulk, disposition.Replace('_', ' ')); previous = disposition; }
                        var id = InboxState.Text(row, "itemId"); var title = InboxState.Text(row, "title"); if (title == "") title = id;
                        var pick = new CheckBox { Content = title, IsChecked = inbox.SelectedReviews.Contains(id), IsEnabled = inbox.CanSelect(id), Margin = new Thickness(4) };
                        AutomationProperties.SetName(pick, "Inbox review " + id);
                        pick.Click += (s, e) => { if (pick.IsChecked == true) inbox.SelectedReviews.Add(id); else inbox.SelectedReviews.Remove(id); inboxConfirmation = null; RenderInboxConfirmation(); }; inboxBulk.Children.Add(pick);
                        var recommendation = InboxState.Value(row, "recommendation") as Dictionary<string, object>;
                        InboxText(inboxBulk, String.Join("\n", new[] { InboxState.Text(row, "rationale"), InboxState.Text(recommendation, "rationale"), InboxState.Text(row, "error"), InboxState.Text(row, "retryCondition") }));
                        if (InboxState.Reviewable(row) && InboxState.Text(row, "actionId") == "answer")
                        {
                            var draft = new TextBox { Text = inbox.Draft(row), AcceptsReturn = true, TextWrapping = TextWrapping.Wrap, IsEnabled = !inbox.Pending };
                            AutomationProperties.SetName(draft, "Inbox draft " + id);
                            draft.TextChanged += (s, e) => { inbox.Drafts[id] = draft.Text; inboxConfirmation = null; RenderInboxConfirmation(); }; inboxBulk.Children.Add(draft);
                        }
                        else if (!InboxState.Reviewable(row)) InboxText(inboxBulk, "Manual review required; excluded from Apply.");
                    }
                }
            }
            private async void OpenSelected()
            {
                if (inbox != null) return;
                if (accounts != null) return;
                var row = results.SelectedItem as PanelResult;
                if (row == null) return;
                CancelDetail(); var generation = State.DetailGeneration;
                if (row.Kind == "agents")
                {
                    ActivateAgent(row, false); return;
                }
                detailRead = new CancellationTokenSource(); var token = detailRead.Token;
                State.Detail = "Loading…"; Render();
                try
                {
                    Dictionary<string, object> environment = null;
                    var args = PanelState.DetailArgs(row);
                    if (row.Kind == "goals")
                    {
                        environment = AccountState.One(await PuiReadBridge.ReadAsync(pui, "operator.identity", null, token));
                        args["workspaceId"] = environment["workspaceId"];
                    }
                    var payload = await PuiReadBridge.ReadAsync(pui, row.Kind + (row.Kind == "goals" ? ".detail" : ".get"), args, token, 22000, environment);
                    if (generation != State.DetailGeneration || token.IsCancellationRequested) return;
                    if (row.Kind == "goals") goal.Loaded(environment, payload, PanelState.Text(row.Row, "id"));
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
            private void RenderGoalControls()
            {
                var visible = goal.Detail != null && State.Detail != null;
                goalControls.Visibility = goalStatus.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
                if (!visible) return;
                var current = (Dictionary<string, object>)goal.Detail["goal"];
                goalStatus.Text = "Workspace: " + PanelState.Text(goal.Environment, "workspaceId") + " · " +
                    PanelState.Text(goal.Environment, "endpoint") + "\nStatus: " + PanelState.Text(current, "status") +
                    " · " + PanelState.Text(goal.Detail, "effectiveStatus") + " · holder " + PanelState.Text(goal.Detail, "holderLiveness") +
                    (goal.Busy ? "\nChecking goal action…" : goal.Error != null ? "\nUnavailable · " + goal.Error :
                        goal.Warning != null ? "\n" + goal.Warning : "");
                var actions = goal.Actions();
                foreach (Button button in goalControls.Children)
                {
                    button.Visibility = actions.Contains((string)button.Tag) ? Visibility.Visible : Visibility.Collapsed;
                    button.IsEnabled = !goal.Busy && goal.Error == null;
                }
            }
            private async void ApplyGoal(string action)
            {
                if (!goal.Actions().Contains(action)) return;
                var generation = State.DetailGeneration;
                var goalId = PanelState.Text((Dictionary<string, object>)goal.Detail["goal"], "id");
                var message = action == "pause" ? "Pause this goal? Placement stops and attributed sessions are paused. Unattributed activity may remain." :
                    action == "resume" ? "Resume this goal? Placement reopens. Previously paused sessions are not re-armed; new work may spend money." :
                    action == "start" || action == "reopen" ? "Start this goal? Placement reopens and a fresh owning agent may launch and spend money." :
                    action == "achieve" ? "Mark this goal achieved? This is a terminal status change." : "Kill this goal? This is a terminal status change.";
                bool confirmed;
                confirmingGoal = true;
                try { confirmed = ConfirmGoal(message); }
                finally { confirmingGoal = false; }
                if (!confirmed || generation != State.DetailGeneration || !State.Visible || detailRead == null) return;
                var token = detailRead.Token;
                goal.Busy = true; RenderGoalControls();
                try
                {
                    var payload = await PuiReadBridge.GoalAsync(pui, goal.Environment, goal.Detail, action, true, token);
                    if (generation != State.DetailGeneration || token.IsCancellationRequested || !State.Visible) return;
                    goal.Applied(payload, goalId);
                    State.Detail = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 }.Serialize(goal.Detail);
                }
                catch (Exception error)
                {
                    if (generation != State.DetailGeneration || token.IsCancellationRequested || !State.Visible) return;
                    goal.Busy = false; goal.Error = error.Message + " · Refresh Goals to verify server state";
                }
                Render();
            }
            private async Task RefreshAccounts(CancellationToken token)
            {
                var generation = accounts.Begin(); RenderAccounts();
                Dictionary<string, object> environment = null, pool = null, steering = null; Exception failure = null;
                try
                {
                    environment = AccountState.One(await PuiReadBridge.ReadAsync(pui, "operator.identity", null, token));
                    var workspace = PanelState.Text(environment, "workspaceId");
                    var poolRead = PuiReadBridge.ReadAsync(pui, "accounts.pool", new Dictionary<string, object> { { "workspace", workspace } }, token, 22000, environment);
                    var overrideRead = PuiReadBridge.ReadAsync(pui, "accounts.sessionOverride", new Dictionary<string, object> { { "workspaceId", workspace } }, token, 22000, environment);
                    await Task.WhenAll(poolRead, overrideRead); pool = poolRead.Result; steering = overrideRead.Result;
                }
                catch (Exception error) { failure = error; }
                if (!token.IsCancellationRequested && State.Visible && accounts.Settle(generation, environment, pool, steering, failure)) RenderAccounts();
            }
            private void UpdateAccountControls()
            {
                var row = results.SelectedItem as PanelResult;
                foreach (var button in accountControls)
                    button.IsEnabled = accounts.Ready && !accounts.Busy && ((string)button.Tag == "auto" || row != null);
            }
            private void RenderAccounts()
            {
                status.Text = accounts.Busy ? "Checking account state…" : accounts.Error == null ?
                    (accounts.Accounts.Count == 0 ? "No accounts" : accounts.Accounts.Count + " accounts") : "Unavailable · " + accounts.Error;
                accountScope.Text = accounts.Environment == null ? "Environment unavailable" :
                    PanelState.Text(accounts.Environment, "endpoint") + "\nWorkspace: " + PanelState.Text(accounts.Environment, "workspaceId");
                accountSummary.Text = accounts.Override == null ? "Steering unavailable" :
                    "Default: " + (PanelState.Text(accounts.Override, "defaultAccountId") == "" ? "This machine's login" : PanelState.Text(accounts.Override, "defaultAccountId")) +
                    "\nForce: " + String.Join(", ", ((System.Collections.IList)accounts.Override["forcedAccounts"]).Cast<object>()) +
                    "\nExclude: " + String.Join(", ", ((System.Collections.IList)accounts.Override["excludeAccounts"]).Cast<object>()) +
                    "\nAuto clears Force and Exclude; it preserves Default.";
                var query = State.Query.Trim();
                var rows = accounts.Accounts.Where(row => (PanelState.Text(row, "id") + " " + PanelState.Text(row, "label") + " " + PanelState.Text(row, "provider")).IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0)
                    .Select(row => new PanelResult { Kind = "accounts", Key = PanelState.Text(row, "id"), Row = row,
                        Title = (PanelState.Text(row, "label") == "" ? PanelState.Text(row, "id") : PanelState.Text(row, "label")) + " (" + PanelState.Text(row, "id") + ")",
                        Subtitle = PanelState.Text(row, "provider") + " · " + (PanelState.Text(row, "available") == "True" ? "Available" : "Unavailable") +
                            (accounts.Contains("forcedAccounts", PanelState.Text(row, "id")) ? " · Forced" : "") +
                            (accounts.Contains("excludeAccounts", PanelState.Text(row, "id")) ? " · Excluded" : "") }).ToList();
                var selected = State.Selection; results.ItemsSource = rows;
                results.SelectedItem = rows.FirstOrDefault(row => row.Key == selected) ?? rows.FirstOrDefault();
                UpdateAccountControls();
            }
            private async void ApplyAccount(string action)
            {
                if (!accounts.Ready || accounts.Busy) return;
                var row = results.SelectedItem as PanelResult;
                if (action != "auto" && row == null) return;
                var environment = accounts.Environment; var generation = ++accounts.Generation;
                if (refresh != null) { refresh.Cancel(); refresh.Dispose(); }
                refresh = new CancellationTokenSource(); var token = refresh.Token;
                accounts.Busy = true; RenderAccounts();
                Dictionary<string, object> payload = null; Exception failure = null;
                try { payload = await PuiReadBridge.AccountAsync(pui, environment, action, action == "auto" ? null : row.Key, token); }
                catch (Exception error) { failure = error; }
                if (!token.IsCancellationRequested && State.Visible && accounts.Applied(generation, environment, payload, failure)) RenderAccounts();
            }
            private async void ActivateAgent(PanelResult selected, bool resumeSession)
            {
                CancelDetail(); var generation = State.DetailGeneration;
                detailRead = new CancellationTokenSource(); var token = detailRead.Token;
                State.Detail = "Checking selected session…"; Render();
                try
                {
                    var payload = await PuiReadBridge.ReadAsync(pui, "advRoster.list", new Dictionary<string, object>(), token);
                    if (generation != State.DetailGeneration || token.IsCancellationRequested || !State.Visible) return;
                    var row = PanelState.AgentTarget(payload, selected, Environment.MachineName, resumeSession);
                    if (resumeSession)
                    {
                        // Direct executable launch: each argument uses Windows argv quoting;
                        // no command interpreter, credentials or parallel resume implementation.
                        var process = Process.Start(new ProcessStartInfo {
                            FileName = pui, Arguments = PanelState.CommandLine(PanelState.ResumeArguments(row)),
                            UseShellExecute = true, WindowStyle = ProcessWindowStyle.Normal });
                        if (process == null) throw new InvalidOperationException("Could not open the selected session in a terminal");
                        process.Dispose();
                    }
                    else
                    {
                        var hwnd = PanelState.ExactAgentWindow(row, DesktopWindows());
                        ShowWindowAsync(hwnd, 9);
                        if (!SetForegroundWindow(hwnd) || GetForegroundWindow() != hwnd)
                            throw new InvalidOperationException("Could not verify focus on the selected terminal");
                    }
                    State.Detail = null; Dismiss(false);
                }
                catch (Exception error)
                {
                    if (generation != State.DetailGeneration || token.IsCancellationRequested) return;
                    State.Detail = "Unavailable · " + error.Message; Render();
                }
            }
            internal void Shutdown()
            {
                shuttingDown = true; Dismiss(false);
                SystemParameters.StaticPropertyChanged -= SystemChanged; Close();
            }
        }
    }
}
