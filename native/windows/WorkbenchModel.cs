using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
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
    }
}
