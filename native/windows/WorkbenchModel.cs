using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace Papercusp.Workbench
{
    // The same canonical models and identities as native/gnome/panel-model.mjs.
    // No local roster, authorization, account or measurement store is introduced.
    public sealed class PanelResult
    {
        public string Kind, Key, Title, Subtitle;
        public Dictionary<string, object> Row;
        public override string ToString() { return Title + "\n" + Subtitle; }
    }

    public sealed class PanelSource
    {
        public string Status = "loading", Error;
        public object Version;
        public bool Partial;
        public List<PanelResult> Rows = new List<PanelResult>();
    }

    public sealed class PanelState
    {
        public static readonly string[] Kinds = { "plans", "agents", "reports", "goals" };
        public static readonly Dictionary<string, string> Models = new Dictionary<string, string>
        {
            { "plans", "plans.list" }, { "agents", "advRoster.list" },
            { "reports", "reports.list" }, { "goals", "goals.list" }
        };
        public bool Visible, Pinned;
        public string Query = "", Scope = "all", Selection, Detail;
        public int Generation, DetailGeneration, ResultLimit = 26;
        private string resultQuery;
        public readonly Dictionary<string, PanelSource> Sources = new Dictionary<string, PanelSource>();

        public static string Text(Dictionary<string, object> row, string key)
        {
            object value;
            return row.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : "";
        }
        private static string Required(Dictionary<string, object> row, string key)
        {
            var value = Text(row, key);
            if (String.IsNullOrWhiteSpace(value)) throw new ArgumentException("Missing canonical " + key);
            return value;
        }
        private static List<Dictionary<string, object>> Rows(object value)
        {
            var rows = value as IList;
            if (rows == null) throw new ArgumentException("The operator returned no row envelope");
            var result = new List<Dictionary<string, object>>();
            foreach (var row in rows)
            {
                var item = row as Dictionary<string, object>;
                if (item == null) throw new ArgumentException("Invalid canonical row");
                result.Add(item);
            }
            return result;
        }
        private static bool PositiveId(object id)
        {
            // Preserve JS safe integer identity across the canonical JSON seam.
            if (!(id is int) && !(id is long) && !(id is decimal) && !(id is double)) return false;
            var n = Convert.ToDouble(id);
            return n > 0 && n <= 9007199254740991d && n == Math.Floor(n);
        }
        public static PanelResult Result(string kind, Dictionary<string, object> row)
        {
            object id;
            object[] identity;
            string title, subtitle;
            if (kind == "plans")
            {
                identity = new object[] { kind, Required(row, "harness"), Required(row, "slug") };
                title = Text(row, "title");
                if (title == "") title = Text(row, "slug");
                subtitle = String.Join(" · ", new[] { Text(row, "status"), Text(row, "harness"), Text(row, "nextAction") }.Where(s => s != ""));
            }
            else if (kind == "agents")
            {
                identity = row.TryGetValue("advSessionId", out id) && PositiveId(id) ?
                    new object[] { kind, "adv", id } : new object[] { kind, "owner", Required(row, "ownerId") };
                title = new[] { Text(row, "label"), Text(row, "agent"), Text(row, "ownerId"), "Session " + Text(row, "advSessionId") }.First(s => s != "");
                subtitle = String.Join(" · ", new[] { Text(row, "intent"), Text(row, "sessionState"), Text(row, "host"), Text(row, "workspaceName") }.Where(s => s != ""));
            }
            else if (kind == "reports")
            {
                identity = new object[] { kind, Required(row, "report_id") };
                title = Text(row, "title"); subtitle = Text(row, "summary");
            }
            else if (kind == "goals")
            {
                identity = new object[] { kind, Required(row, "id") };
                title = Text(row, "title"); subtitle = Text(row, "effectiveStatus");
                if (title == "") title = Text(row, "id");
                if (subtitle == "") subtitle = Text(row, "status");
            }
            else throw new ArgumentException("Unsupported source");
            return new PanelResult { Kind = kind, Key = new JavaScriptSerializer().Serialize(identity),
                Title = title, Subtitle = subtitle, Row = row };
        }
        public int BeginRefresh()
        {
            var signature = new JavaScriptSerializer().Serialize(new[] { Query, Scope });
            if (signature != resultQuery) { ResultLimit = 26; resultQuery = signature; }
            ++Generation; Sources.Clear();
            foreach (var kind in Kinds.Where(k => Scope == "all" || Scope == k)) Sources[kind] = new PanelSource();
            return Generation;
        }
        public bool Settle(string kind, int generation, Dictionary<string, object> payload, Exception error)
        {
            if (generation != Generation) return false;
            var source = new PanelSource();
            try
            {
                if (error != null) throw error;
                object value;
                if (payload == null || (payload.TryGetValue("ok", out value) && Object.Equals(value, false)) ||
                    (payload.TryGetValue("error", out value) && value != null && !Object.Equals(value, false) && !Object.Equals(value, "")) ||
                    !payload.TryGetValue("rows", out value)) throw new ArgumentException("The operator is unavailable");
                var rows = Rows(value);
                Dictionary<string, object> aggregate = null;
                if (kind == "agents" || kind == "goals")
                {
                    if (rows.Count != 1) throw new ArgumentException("Canonical portfolio is unavailable");
                    aggregate = rows[0];
                    if (kind == "goals") rows = Rows(aggregate["goals"]);
                    else
                    {
                        rows = Rows(aggregate["active"]);
                        foreach (var original in Rows(aggregate["ended"]))
                        {
                            var ended = new Dictionary<string, object>(original);
                            if (ended.TryGetValue("id", out value)) ended["advSessionId"] = value;
                            if (ended.TryGetValue("coordOwnerId", out value)) ended["ownerId"] = value;
                            ended["sessionState"] = "ended"; rows.Add(ended);
                        }
                        foreach (var tier in new[] { "pending", "starting" })
                            if (aggregate.TryGetValue(tier, out value)) rows.AddRange(Rows(value));
                    }
                }
                source.Rows = rows.Select(row => Result(kind, row)).ToList();
                source.Status = "ready";
                payload.TryGetValue("version", out source.Version);
                source.Partial = payload.TryGetValue("partial", out value) && Object.Equals(value, true);
                if (aggregate != null)
                {
                    foreach (var flag in new[] { "partial", "truncatedByLimit" })
                        source.Partial |= aggregate.TryGetValue(flag, out value) && Object.Equals(value, true);
                    foreach (var flag in new[] { "degradedFields", "unavailable", "errors" })
                        if (aggregate.TryGetValue(flag, out value) && value != null &&
                            !Object.Equals(value, false) && (!(value is IList) || ((IList)value).Count > 0))
                        { source.Partial = true; source.Error = new JavaScriptSerializer().Serialize(value); }
                }
            }
            catch (Exception cause) { source.Status = "unavailable"; source.Error = cause.Message; }
            Sources[kind] = source; return true;
        }
        public List<PanelResult> Results(bool unlimited = false)
        {
            var terms = Query.Trim().ToLowerInvariant().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            var results = new List<PanelResult>();
            foreach (var kind in Kinds)
            {
                PanelSource source;
                if ((Scope != "all" && Scope != kind) || !Sources.TryGetValue(kind, out source)) continue;
                var matches = source.Rows.Where(row =>
                {
                    var text = (row.Title + " " + row.Subtitle + " " + Text(row.Row, "slug") + " " +
                        Text(row.Row, "ownerId") + " " + Text(row.Row, "currentPlanSlug")).ToLowerInvariant();
                    return terms.All(term => text.Contains(term));
                });
                results.AddRange(unlimited ? matches : matches.Take(ResultLimit));
            }
            return results;
        }
        public string Escape()
        {
            ++DetailGeneration;
            if (Detail != null) { Detail = null; return "detail"; }
            Visible = false; return "panel";
        }
        public void OutsideFocus() { if (!Pinned) Visible = false; }
        public static Dictionary<string, object> DetailArgs(PanelResult row)
        {
            if (row.Kind == "plans") return new Dictionary<string, object> {
                { "harness", Required(row.Row, "harness") }, { "slug", Required(row.Row, "slug") } };
            if (row.Kind == "reports") return new Dictionary<string, object> { { "reportId", Required(row.Row, "report_id") } };
            if (row.Kind == "goals") return new Dictionary<string, object> { { "goalId", Required(row.Row, "id") } };
            throw new InvalidOperationException("Use the exact agent terminal route");
        }
        public static PanelResult AgentTarget(Dictionary<string, object> payload, PanelResult selected, string localHost, bool resume)
        {
            if (selected.Kind != "agents" || String.IsNullOrWhiteSpace(localHost))
                throw new ArgumentException("Select an exact agent session");
            object id;
            var hasId = selected.Row.TryGetValue("advSessionId", out id) && PositiveId(id);
            var owner = Text(selected.Row, "ownerId"); var window = Text(selected.Row, "windowId");
            if ((!hasId && (resume || window == "")) || (!resume && owner == ""))
                throw new InvalidOperationException("The selected row has no exact session identity; refresh the results");
            var state = new PanelState(); var generation = state.BeginRefresh();
            state.Settle("agents", generation, payload, null);
            var source = state.Sources["agents"];
            if (source.Status != "ready" || source.Partial) throw new InvalidOperationException("Agent roster is unavailable or incomplete");
            var matches = source.Rows.Where(row => hasId ?
                row.Row.ContainsKey("advSessionId") && PositiveId(row.Row["advSessionId"]) &&
                    Convert.ToInt64(row.Row["advSessionId"]) == Convert.ToInt64(id) :
                Text(row.Row, "ownerId") == owner && Text(row.Row, "windowId") == window).ToArray();
            if (matches.Length != 1) throw new InvalidOperationException("The selected session is unavailable or ambiguous");
            var target = matches[0];
            var host = Text(target.Row, "host"); if (host == "") host = Text(target.Row, "hostname");
            var selectedHost = Text(selected.Row, "host"); if (selectedHost == "") selectedHost = Text(selected.Row, "hostname");
            if (host == "" || host != selectedHost || Text(target.Row, "ownerId") != owner ||
                Text(target.Row, "revoked") == "True" || Text(target.Row, "stale") == "True")
                throw new InvalidOperationException("The selected session changed; refresh the results");
            var status = Text(target.Row, "sessionState");
            if (resume)
            {
                if (status != "ended" || Text(target.Row, "pidAlive") == "True" ||
                    source.Rows.Any(row => row != target && owner != "" && Text(row.Row, "ownerId") == owner &&
                        new[] { "live", "parked", "starting" }.Contains(Text(row.Row, "sessionState"))))
                    throw new InvalidOperationException("The selected session is running or cannot be resumed; refresh the results");
            }
            else if (!new[] { "live", "parked" }.Contains(status) || Text(selected.Row, "sessionState") == "ended" ||
                Text(selected.Row, "endedAt") != "" || Text(target.Row, "isLocal") == "False" ||
                !String.Equals(host, localHost, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The selected session is ended or on another machine; use its saved connection to resume it");
            if (!resume && window != "" && Text(target.Row, "windowId") != window)
                throw new InvalidOperationException("The selected terminal window changed; refresh the results");
            return target;
        }
        public static string[] ResumeArguments(PanelResult target)
        {
            object id;
            if (!target.Row.TryGetValue("advSessionId", out id) || !PositiveId(id)) throw new ArgumentException("Missing session identity");
            var host = Text(target.Row, "host"); if (host == "") host = Text(target.Row, "hostname");
            if (!Regex.IsMatch(host, @"^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$")) throw new ArgumentException("Invalid session host");
            return new[] { "workbench", "resume", Convert.ToInt64(id).ToString(), host, Text(target.Row, "ownerId") };
        }
        public static string CommandLine(IEnumerable<string> arguments)
        {
            return String.Join(" ", arguments.Select(value =>
            {
                var quoted = new StringBuilder("\""); var slashes = 0;
                foreach (var c in value)
                {
                    if (c == '\\') { ++slashes; continue; }
                    quoted.Append('\\', c == '"' ? slashes * 2 + 1 : slashes); quoted.Append(c); slashes = 0;
                }
                quoted.Append('\\', slashes * 2); quoted.Append('"'); return quoted.ToString();
            }));
        }
        public static IntPtr ExactAgentWindow(PanelResult target, IDictionary<IntPtr, string> windows)
        {
            var recorded = Text(target.Row, "windowId");
            var marker = Text(target.Row, "advSessionId"); marker = marker == "" ? null : "[adv:" + marker + "]";
            long handle; var numeric = recorded.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ?
                Int64.TryParse(recorded.Substring(2), System.Globalization.NumberStyles.HexNumber, null, out handle) :
                Int64.TryParse(recorded, out handle);
            var matches = windows.Where(pair => recorded != "" ?
                (numeric ? pair.Key.ToInt64() == handle : pair.Value == recorded) :
                marker != null && pair.Value.Contains(marker)).ToArray();
            if (matches.Length != 1) throw new InvalidOperationException("The exact terminal window is unavailable or ambiguous");
            if (marker != null && Regex.IsMatch(matches[0].Value, @"\[adv:\d+\]") && !matches[0].Value.Contains(marker))
                throw new InvalidOperationException("The recorded terminal handle conflicts with the selected session");
            return matches[0].Key;
        }
    }

    public sealed class GoalState
    {
        public bool Busy;
        public string Error, Warning;
        public Dictionary<string, object> Environment, Detail;
        public void Clear() { Busy = false; Error = null; Warning = null; Environment = null; Detail = null; }
        public static Dictionary<string, object> One(Dictionary<string, object> payload, string goalId)
        {
            object rows, partial, value;
            if (payload == null || !payload.TryGetValue("rows", out rows) || !(rows is IList) || ((IList)rows).Count != 1 ||
                (payload.TryGetValue("partial", out partial) && Object.Equals(partial, true)))
                throw new InvalidOperationException("Canonical goal detail is unavailable or incomplete");
            var detail = ((IList)rows)[0] as Dictionary<string, object>;
            var goal = detail != null && detail.TryGetValue("goal", out value) ? value as Dictionary<string, object> : null;
            if (goal == null || PanelState.Text(goal, "id") != goalId || String.IsNullOrWhiteSpace(goalId) ||
                !new[] { "active", "paused", "achieved", "killed" }.Contains(PanelState.Text(goal, "status")) ||
                PanelState.Text(detail, "effectiveStatus") == "" ||
                !new[] { "held", "unheld", "lost", "unknown" }.Contains(PanelState.Text(detail, "holderLiveness")))
                throw new InvalidOperationException("Selected goal is unavailable or changed");
            return detail;
        }
        public string[] Actions()
        {
            if (Busy || Error != null || Detail == null || !AccountState.SameEnvironment(Environment, Environment) ||
                PanelState.Text(Detail, "holderLiveness") == "unknown") return new string[0];
            var goal = (Dictionary<string, object>)Detail["goal"];
            var status = PanelState.Text(goal, "status");
            if (status == "achieved" || status == "killed") return new[] { "reopen" };
            if (status == "paused") return new[] { "resume", "achieve", "kill" };
            var holder = PanelState.Text(Detail, "holderLiveness");
            return new[] { PanelState.Text(Detail, "effectiveStatus") == "dormant" || holder == "unheld" || holder == "lost" ? "start" : "pause", "achieve", "kill" };
        }
        public void Loaded(Dictionary<string, object> environment, Dictionary<string, object> payload, string goalId)
        {
            if (!AccountState.SameEnvironment(environment, environment)) throw new InvalidOperationException("Selected goal environment is unavailable");
            Detail = One(payload, goalId); Environment = environment; Error = null; Warning = null; Busy = false;
        }
        public void Applied(Dictionary<string, object> payload, string goalId)
        {
            object environment, degraded, reasons;
            if (!payload.TryGetValue("environment", out environment) || !AccountState.SameEnvironment(Environment, environment as Dictionary<string, object>))
                throw new InvalidOperationException("Goal environment changed; refresh before applying another control");
            var detail = One(payload, goalId);
            Warning = payload.TryGetValue("degraded", out degraded) && Object.Equals(degraded, true) ?
                "Goal action was incomplete · " + (payload.TryGetValue("degradedReasons", out reasons) && reasons is IList ?
                    String.Join(" · ", ((IList)reasons).Cast<object>()) : "Refresh and check goal activity") : null;
            Detail = detail; Error = null; Busy = false;
        }
    }

    // Projection of the canonical attention models. PUI alone authorizes and
    // executes actions; this state freezes what the person actually reviewed.
    public sealed class InboxState
    {
        public int Generation, ContextGeneration, ActionGeneration;
        public bool ListReady, BulkReady, ListPartial, Pending;
        public string Selection, SavedRunId, ListError, BulkError, ContextError, ActionNotice, Answer = "";
        public Dictionary<string, object> Context, Run;
        public List<Dictionary<string, object>> Rows = new List<Dictionary<string, object>>(), Items = new List<Dictionary<string, object>>();
        public readonly HashSet<string> SelectedReviews = new HashSet<string>(), Applied = new HashSet<string>();
        public readonly Dictionary<string, string> Drafts = new Dictionary<string, string>();
        public static object Value(Dictionary<string, object> row, string key)
        { object value; return row != null && row.TryGetValue(key, out value) ? value : null; }
        public static string Text(Dictionary<string, object> row, string key)
        { return row == null ? "" : PanelState.Text(row, key); }
        private static string Required(Dictionary<string, object> row, string key)
        { var value = Text(row, key); if (String.IsNullOrWhiteSpace(value)) throw new InvalidOperationException("Missing canonical " + key); return value; }
        public static Dictionary<string, object> Clone(Dictionary<string, object> row)
        { var json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 }; return json.Deserialize<Dictionary<string, object>>(json.Serialize(row)); }
        private static bool Equal(object a, object b)
        {
            var left = a as Dictionary<string, object>; var right = b as Dictionary<string, object>;
            if (left != null || right != null) return left != null && right != null && left.Count == right.Count &&
                left.All(pair => right.ContainsKey(pair.Key) && Equal(pair.Value, right[pair.Key]));
            var la = a as IList; var ra = b as IList;
            if (la != null || ra != null) return la != null && ra != null && la.Count == ra.Count &&
                la.Cast<object>().Zip(ra.Cast<object>(), Equal).All(same => same);
            return Object.Equals(a, b);
        }
        private static List<Dictionary<string, object>> RowList(object value)
        {
            var list = value as IList;
            if (list == null || list.Cast<object>().Any(row => !(row is Dictionary<string, object>)))
                throw new InvalidOperationException("Canonical rows are unavailable");
            return list.Cast<Dictionary<string, object>>().ToList();
        }
        private static List<Dictionary<string, object>> ReadRows(Dictionary<string, object> payload)
        {
            var error = Value(payload, "error");
            if (payload == null || Object.Equals(Value(payload, "ok"), false) ||
                (error != null && !Object.Equals(error, false) && !Object.Equals(error, "")))
                throw new InvalidOperationException("Inbox is unavailable");
            return RowList(Value(payload, "rows"));
        }
        public static Dictionary<string, object> One(Dictionary<string, object> payload)
        {
            var rows = ReadRows(payload);
            if (Object.Equals(Value(payload, "partial"), true) || rows.Count != 1)
                throw new InvalidOperationException("Canonical Inbox state is incomplete");
            return rows[0];
        }
        public void ClearContext() { ++ContextGeneration; Context = null; ContextError = null; }
        public int Begin()
        {
            Rows.Clear(); Items.Clear(); Run = null; ListReady = BulkReady = ListPartial = false;
            ListError = BulkError = null; ClearContext(); return ++Generation;
        }
        public bool SettleList(int token, Dictionary<string, object> payload, Exception error = null)
        {
            if (token != Generation) return false;
            try
            {
                if (error != null) throw error;
                var seen = new Dictionary<string, Dictionary<string, object>>();
                var partial = Object.Equals(Value(payload, "partial"), true);
                foreach (var group in ReadRows(payload))
                {
                    partial |= Object.Equals(Value(Value(group, "_meta") as Dictionary<string, object>, "hasMore"), true);
                    foreach (var row in RowList(Value(group, "items")))
                    {
                        var id = Required(row, "id"); Required(row, "kind");
                        if (!(Value(row, "ref") is Dictionary<string, object>)) throw new InvalidOperationException("Missing canonical item reference");
                        if (seen.ContainsKey(id) && !Equal(seen[id], row)) throw new InvalidOperationException("Conflicting Inbox identities");
                        seen[id] = row;
                    }
                }
                var selected = Rows.FirstOrDefault(row => Text(row, "id") == Selection);
                Dictionary<string, object> next = null;
                if (Selection != null) seen.TryGetValue(Selection, out next);
                if (next == null || (selected != null && (!Equal(Value(selected, "ref"), Value(next, "ref")) || Text(selected, "kind") != Text(next, "kind")))) ClearContext();
                Rows = seen.Values.ToList(); ListReady = true; ListPartial = partial; ListError = null;
                if (next == null) Selection = null;
            }
            catch (Exception cause) { Rows.Clear(); ListReady = false; ListError = cause.Message; ClearContext(); }
            return true;
        }
        public List<Dictionary<string, object>> Results(string query = "")
        {
            var terms = query.Trim().ToLowerInvariant().Split((char[])null, StringSplitOptions.RemoveEmptyEntries);
            return Rows.Where(row => { var text = String.Join(" ", new[] { "id", "title", "body", "kind", "harnessSlug", "planSlug" }.Select(key => Text(row, key))).ToLowerInvariant(); return terms.All(text.Contains); }).ToList();
        }
        public bool DismissContext() { if (Selection == null) return false; Selection = null; ClearContext(); return true; }
        public void RetainVisibleSelection(string query)
        { if (Selection != null && !Results(query).Any(row => Text(row, "id") == Selection)) DismissContext(); }
        public int Select(string id)
        {
            if (!ListReady || !Rows.Any(row => Text(row, "id") == id)) throw new InvalidOperationException("Select a current Inbox item");
            if (Selection != id) Answer = "";
            Selection = id; ClearContext(); return ContextGeneration;
        }
        public bool SettleContext(int token, string id, Dictionary<string, object> payload, Exception error = null)
        {
            if (token != ContextGeneration || Selection != id) return false;
            try
            {
                if (error != null) throw error;
                var detail = One(payload); var selected = Rows.FirstOrDefault(row => Text(row, "id") == id);
                if (selected == null || Text(detail, "id") != id || Text(detail, "kind") != Text(selected, "kind") || !Equal(Value(detail, "ref"), Value(selected, "ref")))
                    throw new InvalidOperationException("The selected question changed; refresh its context");
                Context = detail; ContextError = null;
            }
            catch (Exception cause) { Context = null; ContextError = cause.Message; }
            return true;
        }
        public bool SettleBulk(int token, Dictionary<string, object> payload, string runId = null, Exception error = null)
        {
            if (token != Generation) return false;
            try
            {
                if (error != null) throw error;
                var row = One(payload); var items = RowList(Value(row, "items")); var run = Value(row, "run") as Dictionary<string, object>;
                if (run == null) { if (items.Count != 0 || runId != null || !row.ContainsKey("run")) throw new InvalidOperationException("The selected saved run is unavailable"); }
                else
                {
                    Required(run, "runId");
                    if ((runId != null && Text(run, "runId") != runId) || !new[] { "pending", "running", "review", "complete", "failed" }.Contains(Text(run, "phase")))
                        throw new InvalidOperationException("Saved run identity or phase changed");
                    Counts(run, items);
                }
                var nextId = run == null ? null : Text(run, "runId");
                if (SavedRunId != nextId) { SelectedReviews.Clear(); Drafts.Clear(); }
                SavedRunId = nextId; Run = run; Items = items; BulkReady = true; BulkError = null;
                SelectedReviews.RemoveWhere(id => !Items.Any(item => Text(item, "itemId") == id && Reviewable(item)));
            }
            catch (Exception cause) { Run = null; Items.Clear(); BulkReady = false; BulkError = cause.Message; }
            return true;
        }
        public bool SettleLiveBulk(int token, string runId, Dictionary<string, object> payload, Exception error = null)
        { return !Pending && runId == SavedRunId && SettleBulk(token, payload, runId, error); }
        public static string Disposition(Dictionary<string, object> row)
        { var recommendation = Value(row, "recommendation") as Dictionary<string, object>; return Text(row, "outcome") == "recommended" && Text(recommendation, "kind") != "" ? Text(recommendation, "kind") : Text(row, "disposition") != "" ? Text(row, "disposition") : Text(row, "outcome"); }
        public static bool Reviewable(Dictionary<string, object> row) { return Text(row, "outcome") == "recommended" && Disposition(row) == "recommended"; }
        public static bool Retryable(Dictionary<string, object> row)
        { return new[] { "pending", "failed" }.Contains(Text(row, "outcome")) || Text(row, "outcome") == "skipped" && new[] { "", "retry_needed" }.Contains(Text(row, "disposition")); }
        public static List<Dictionary<string, object>> Actions(Dictionary<string, object> row)
        {
            var actions = new List<Dictionary<string, object>>(); var reference = Value(row, "ref") as Dictionary<string, object>;
            foreach (var action in RowList(Value(row, "actions") ?? new object[0]))
            {
                if (Text(reference, "kind") != "coord-escalation" || !new[] { "resolve", "mark-done" }.Contains(Text(action, "id"))) actions.Add(action);
                else
                {
                    var options = RowList(Value(reference, "options") ?? new object[0]).Where(option => !String.IsNullOrWhiteSpace(Text(option, "id"))).ToList();
                    if (options.Count > 0) actions.AddRange(options);
                    else if (!String.IsNullOrWhiteSpace(Text(reference, "conversationId"))) actions.Add(new Dictionary<string, object> { { "id", "answer" }, { "label", "Answer" } });
                    else actions.Add(action);
                }
            }
            return actions.Where(action => Text(action, "id") != "" && !new[] { "chat", "discuss", "view-log", "open", "message-owner" }.Contains(Text(action, "id"))).ToList();
        }
        public bool CanSelect(string id)
        { return !Pending && !Applied.Contains(id) && Text(Run, "phase") == "review" && Items.Any(row => Text(row, "itemId") == id && Reviewable(row)); }
        public string Draft(Dictionary<string, object> row)
        { string draft; return Drafts.TryGetValue(Text(row, "itemId"), out draft) ? draft : Text(row, "draftAnswer"); }
        public Dictionary<string, object> Request(string operation, Dictionary<string, object> environment,
            string query = "", string itemId = null, string actionId = null, string answer = null)
        {
            if (Pending || !AccountState.SameEnvironment(environment, environment)) throw new InvalidOperationException("Wait for the current action and select an environment");
            var body = new Dictionary<string, object> { { "environment", environment }, { "operation", operation }, { "confirmed", true } };
            var active = new[] { "pending", "running" }.Contains(Text(Run, "phase"));
            if (operation == "start")
            {
                var visible = Results(query);
                if (!ListReady || !BulkReady || active || Text(Run, "phase") == "review" || visible.Count == 0 || visible.Count > 2000)
                    throw new InvalidOperationException("Load a visible batch and finish the current run first");
                body["items"] = visible.Select(row => new Dictionary<string, object> { { "itemId", row["id"] }, { "kind", row["kind"] }, { "title", Value(row, "title") }, { "ref", row["ref"] }, { "ownerAgentId", Value(row, "ownerAgentId") } }).ToArray();
                body["filter"] = new Dictionary<string, object> { { "tier", null }, { "kinds", new object[0] }, { "query", query }, { "shownCount", visible.Count } };
            }
            else if (operation == "stop" || operation == "resume")
            {
                if (!BulkReady || Run == null || (operation == "stop" ? !active : active)) throw new InvalidOperationException("Load a saved run in the appropriate phase");
                body["runId"] = Required(Run, "runId");
                if (operation == "resume") { var ids = Items.Where(Retryable).Select(row => Text(row, "itemId")).ToArray(); if (ids.Length == 0) throw new InvalidOperationException("No retryable items remain"); body["itemIds"] = ids; }
            }
            else if (operation == "apply" || operation == "resolve")
            {
                var row = operation == "apply" ? Items.FirstOrDefault(item => Text(item, "itemId") == itemId) : Context;
                var id = Text(row, operation == "apply" ? "itemId" : "id");
                if (row == null || Applied.Contains(id)) throw new InvalidOperationException("Select a current question");
                if (operation == "apply")
                {
                    if (!BulkReady || !CanSelect(id) || !SelectedReviews.Contains(id) || Text(row, "actionId") == "") throw new InvalidOperationException("Select a current recommendation");
                    body["runId"] = Run["runId"]; actionId = Text(row, "actionId"); answer = Draft(row);
                }
                else if (id != Selection || !Actions(row).Any(action => Text(action, "id") == actionId)) throw new InvalidOperationException("Select an offered action");
                body["expected"] = new Dictionary<string, object> { { "id", id }, { "kind", row["kind"] }, { "ref", row["ref"] } }; body["actionId"] = actionId;
                if (actionId == "answer") { if (String.IsNullOrWhiteSpace(answer)) throw new InvalidOperationException("Enter an answer"); body["answer"] = answer.Trim(); }
            }
            else throw new InvalidOperationException("Unknown Inbox operation");
            return Clone(body);
        }
        public int BeginAction(IList<Dictionary<string, object>> requests)
        { if (Pending || requests.Count == 0) throw new InvalidOperationException("An Inbox action is already pending"); Pending = true; ActionNotice = null; return ++ActionGeneration; }
        public string RecordAction(int token, Dictionary<string, object> request, Dictionary<string, object> payload)
        {
            if (!Pending || token != ActionGeneration || !AccountState.SameEnvironment(Value(request, "environment") as Dictionary<string, object>, Value(payload, "environment") as Dictionary<string, object>))
                throw new InvalidOperationException("Action environment changed; refresh before retrying");
            var receipt = One(payload);
            if (!Object.Equals(Value(receipt, "ok"), true)) throw new InvalidOperationException("Action was not confirmed; refresh before retrying");
            if (new[] { "apply", "resolve" }.Contains(Text(request, "operation")))
            {
                var id = Text(Value(request, "expected") as Dictionary<string, object>, "id");
                if (!Object.Equals(Value(receipt, "resolved"), true) || Text(receipt, "itemId") != id) throw new InvalidOperationException("Question resolution was not confirmed");
                Applied.Add(id); SelectedReviews.Remove(id);
            }
            if (Object.Equals(Value(receipt, "recorded"), false)) throw new InvalidOperationException("Action succeeded; bookkeeping is unconfirmed. Refresh and reconcile; do not repeat the action.");
            return Text(request, "operation") == "start" ? Required(receipt, "runId") : null;
        }
        public void FinishAction(int token, Exception error = null)
        { if (token != ActionGeneration) return; Pending = false; ActionNotice = error == null ? "Action confirmed. Refreshing saved state…" : error.Message; }
        public static Dictionary<string, int> Counts(Dictionary<string, object> run, IList<Dictionary<string, object>> items)
        {
            var value = Value(run, "totalItems");
            if (!(value is int || value is long || value is decimal || value is double) || Convert.ToDouble(value) < 0 ||
                Convert.ToDouble(value) > Int32.MaxValue || Convert.ToDouble(value) != Math.Floor(Convert.ToDouble(value)) || items.Count > Convert.ToDouble(value))
                throw new InvalidOperationException("Invalid bulk total");
            var counts = new[] { "resolved", "forReview", "pending", "failed", "skipped", "dismissed", "decided", "ownerAction", "cleanupCandidate", "retryNeeded", "routed", "investigate" }.ToDictionary(key => key, key => 0);
            var seen = new HashSet<string>();
            foreach (var item in items)
            {
                var outcome = Text(item, "outcome");
                if (!seen.Add(Required(item, "itemId")) || Text(item, "runId") != Required(run, "runId") ||
                    !new[] { "pending", "auto_resolved", "recommended", "skipped", "failed", "dismissed" }.Contains(outcome)) throw new InvalidOperationException("Invalid bulk item identity or outcome");
                var bucket = outcome == "auto_resolved" ? "resolved" : outcome;
                if (counts.ContainsKey(bucket)) ++counts[bucket];
                if (outcome != "pending") ++counts["decided"];
                if (Reviewable(item)) ++counts["forReview"];
                var disposition = Disposition(item); var key = disposition == "owner_action" ? "ownerAction" : disposition == "cleanup_candidate" ? "cleanupCandidate" : disposition == "retry_needed" ? "retryNeeded" : disposition;
                if (new[] { "ownerAction", "cleanupCandidate", "retryNeeded", "routed", "investigate" }.Contains(key)) ++counts[key];
            }
            counts["total"] = Convert.ToInt32(value); counts["left"] = counts["total"] - counts["decided"];
            counts["percent"] = counts["total"] == 0 ? 0 : (int)Math.Floor(100d * counts["decided"] / counts["total"] + 0.5);
            counts["unresolved"] = new[] { "forReview", "pending", "failed", "ownerAction", "cleanupCandidate", "retryNeeded", "routed", "investigate" }.Sum(key => counts[key]);
            return counts;
        }
    }

    public sealed class AccountState
    {
        public int Generation;
        public bool Busy;
        public string Error, Selection;
        public Dictionary<string, object> Environment, Override;
        public List<Dictionary<string, object>> Accounts = new List<Dictionary<string, object>>();
        public bool Ready { get { return Environment != null && Override != null && Error == null; } }
        public int Begin()
        { Busy = true; Error = null; Environment = null; Override = null; Accounts.Clear(); return ++Generation; }
        public static Dictionary<string, object> One(Dictionary<string, object> payload)
        {
            object value;
            if (payload == null || !payload.TryGetValue("rows", out value) || !(value is IList) || ((IList)value).Count != 1 ||
                !(((IList)value)[0] is Dictionary<string, object>)) throw new InvalidOperationException("Canonical account state is unavailable");
            return (Dictionary<string, object>)((IList)value)[0];
        }
        public static bool SameEnvironment(Dictionary<string, object> a, Dictionary<string, object> b)
        {
            if (a == null || b == null) return false;
            foreach (var key in new[] { "endpoint", "workspaceId" })
                if (PanelState.Text(a, key) == "" || PanelState.Text(a, key) != PanelState.Text(b, key)) return false;
            foreach (var key in new[] { "store", "agentChat" })
            {
                object av, bv;
                if (!a.TryGetValue(key, out av) || !b.TryGetValue(key, out bv) ||
                    !(av is Dictionary<string, object>) || !(bv is Dictionary<string, object>)) return false;
                var field = key == "store" ? "id" : "scope";
                if (PanelState.Text((Dictionary<string, object>)av, field) == "" ||
                    PanelState.Text((Dictionary<string, object>)av, field) != PanelState.Text((Dictionary<string, object>)bv, field)) return false;
            }
            return true;
        }
        public static void ValidateOverride(Dictionary<string, object> value)
        {
            foreach (var key in new[] { "forcedAccounts", "excludeAccounts" })
            {
                object items;
                if (!value.TryGetValue(key, out items) || !(items is IList) || ((IList)items).Cast<object>().Any(item => !(item is string)))
                    throw new InvalidOperationException("Canonical account steering is unavailable");
            }
        }
        public bool Settle(int generation, Dictionary<string, object> environment,
            Dictionary<string, object> pool, Dictionary<string, object> steering, Exception failure)
        {
            if (generation != Generation) return false;
            Busy = false;
            try
            {
                if (failure != null) throw failure;
                if (!SameEnvironment(environment, environment)) throw new InvalidOperationException("Selected account environment is unavailable");
                object rows, partial;
                if (!pool.TryGetValue("rows", out rows) || !(rows is IList) ||
                    (pool.TryGetValue("partial", out partial) && Object.Equals(partial, true))) throw new InvalidOperationException("Account pool is unavailable or incomplete");
                var accounts = ((IList)rows).Cast<Dictionary<string, object>>().ToList();
                if (accounts.Any(row => PanelState.Text(row, "id") == "") || accounts.Select(row => PanelState.Text(row, "id")).Distinct().Count() != accounts.Count)
                    throw new InvalidOperationException("Account identity is missing or ambiguous");
                var current = One(steering); ValidateOverride(current);
                Environment = environment; Accounts = accounts; Override = current; Error = null;
            }
            catch (Exception error) { Environment = null; Override = null; Accounts.Clear(); Error = error.Message; }
            return true;
        }
        public bool Applied(int generation, Dictionary<string, object> expected, Dictionary<string, object> payload, Exception failure)
        {
            if (generation != Generation) return false;
            Busy = false;
            try
            {
                if (failure != null) throw failure;
                object actual;
                if (!payload.TryGetValue("environment", out actual) || !SameEnvironment(expected, actual as Dictionary<string, object>) ||
                    !SameEnvironment(Environment, expected)) throw new InvalidOperationException("Account environment changed; refresh before applying another control");
                var current = One(payload); ValidateOverride(current); Override = current; Error = null;
            }
            catch (Exception error) { Error = error.Message; }
            return true;
        }
        public bool Contains(string field, string id)
        { return Override != null && ((IList)Override[field]).Cast<object>().Any(value => Object.Equals(value, id)); }
    }
}
