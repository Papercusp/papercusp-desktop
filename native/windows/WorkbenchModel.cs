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
}
