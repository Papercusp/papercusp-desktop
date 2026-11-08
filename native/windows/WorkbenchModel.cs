using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace Papercusp.Workbench
{
    // The same canonical models and identities as native/gnome/panel-model.mjs.
    // No local roster, authorization, account or measurement store is introduced.
    // In-memory projection of the existing chat-protocol v1, not a second
    // conversation store. Every frame/history page is bound to all four backend
    // identity axes and an exact conversation. Failed validation is atomic.
    public sealed class ChatReply
    {
        public readonly Dictionary<string, object> Environment;
        public readonly string ConversationId, Text, UserTurnId, Modality;
        public string TurnId = "", Phase = "connecting", Raw = "", DisplayText = "";
        public long Sequence;
        public bool Complete, Connected = true;
        public Dictionary<string, object> SavedUser;
        public List<string> Tools = new List<string>();
        private Dictionary<long, Dictionary<string, object>> events = new Dictionary<long, Dictionary<string, object>>();
        private static readonly string[] Phases = { "running", "awaiting-input", "completed", "failed", "cancelled", "interrupted", "needs-reconciliation" };
        public ChatReply(Dictionary<string, object> environment, string conversationId, string text, string userTurnId, string modality = "text")
        {
            if (!AccountState.SameEnvironment(environment, environment) || !Uuid(conversationId) || !Uuid(userTurnId) ||
                String.IsNullOrWhiteSpace(text) || Encoding.UTF8.GetByteCount(text) > 32768 || !(modality == "text" || modality == "voice"))
                throw new ArgumentException("Select an exact conversation and bounded message");
            Environment = Copy(environment); ConversationId = conversationId; Text = text; UserTurnId = userTurnId; Modality = modality;
        }
        public static bool Uuid(string value)
        { return value != null && Regex.IsMatch(value, "\\A[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\z"); }
        public static Dictionary<string, object> Copy(Dictionary<string, object> value)
        { var json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 }; return json.Deserialize<Dictionary<string, object>>(json.Serialize(value)); }
        public static object Value(Dictionary<string, object> value, string key)
        { object found; return value != null && value.TryGetValue(key, out found) ? found : null; }
        public static Dictionary<string, object> Object(object value)
        { var row = value as Dictionary<string, object>; if (row == null) throw new InvalidOperationException("Invalid canonical object"); return row; }
        public static long Number(object value)
        {
            if (!(value is int || value is long || value is decimal || value is double)) throw new InvalidOperationException("Invalid canonical sequence");
            var number = Convert.ToDouble(value);
            if (Double.IsNaN(number) || number < 0 || number > 9007199254740991d || number != Math.Floor(number))
                throw new InvalidOperationException("Invalid canonical sequence");
            return Convert.ToInt64(value);
        }
        public static bool Equal(object a, object b)
        {
            var left = a as Dictionary<string, object>; var right = b as Dictionary<string, object>;
            if (left != null && right != null) return left.Count == right.Count && left.All(pair => right.ContainsKey(pair.Key) && Equal(pair.Value, right[pair.Key]));
            var al = a as IList; var bl = b as IList;
            if (al != null && bl != null) return al.Count == bl.Count && al.Cast<object>().Zip(bl.Cast<object>(), Equal).All(same => same);
            return System.Object.Equals(a, b);
        }
        public Dictionary<string, object> SendRequest()
        { return new Dictionary<string, object> { { "environment", Copy(Environment) }, { "conversationId", ConversationId },
            { "operation", "send" }, { "text", Text }, { "userTurnId", UserTurnId }, { "modality", Modality } }; }
        public Dictionary<string, object> Control(string operation)
        {
            if (Complete || TurnId == "" || !(operation == "reconnect" || operation == "cancel"))
                throw new InvalidOperationException("The saved reply identity is unavailable; refresh before sending again");
            var request = new Dictionary<string, object> { { "environment", Copy(Environment) }, { "conversationId", ConversationId },
                { "operation", operation }, { "turnId", TurnId } };
            if (operation == "reconnect") request["afterSequence"] = Sequence;
            return request;
        }
        public void Disconnected() { Connected = false; if (!Complete) Phase = "needs-reconciliation"; }
        private bool Matches(Dictionary<string, object> row)
        { return PanelState.Text(row, "conversationId") == ConversationId && TurnId != "" && PanelState.Text(row, "turnId") == TurnId; }
        private string ReplyState(Dictionary<string, object> row)
        {
            if (Number(Value(row, "schemaVersion")) != 1 || !Matches(row) || !Phases.Contains(PanelState.Text(row, "phase")))
                throw new InvalidOperationException("Invalid saved reply state");
            Number(Value(row, "revision")); Number(Value(row, "lastSequence"));
            var capabilities = Object(Value(row, "capabilities"));
            if (new[] { "connectionReplay", "persistedHistory", "persistedInteractionDecisions", "completedToolCheckpoints", "interruptedTurnRecovery" }
                .Any(key => !(Value(capabilities, key) is bool))) throw new InvalidOperationException("Invalid saved reply capabilities");
            return PanelState.Text(row, "phase");
        }
        public void Receive(Dictionary<string, object> frame)
        {
            var next = (ChatReply)MemberwiseClone();
            next.events = new Dictionary<long, Dictionary<string, object>>(events); next.Tools = new List<string>(Tools);
            next.Reduce(frame);
            TurnId = next.TurnId; Phase = next.Phase; Raw = next.Raw; DisplayText = next.DisplayText; Sequence = next.Sequence;
            Complete = next.Complete; Connected = next.Connected; SavedUser = next.SavedUser; Tools = next.Tools; events = next.events;
        }
        private void Reduce(Dictionary<string, object> frame)
        {
            if (Complete || !AccountState.SameEnvironment(Environment, Value(frame, "environment") as Dictionary<string, object>))
                throw new InvalidOperationException("The reply environment changed or is already complete");
            var data = Object(Value(frame, "data")); var kind = PanelState.Text(frame, "event");
            if (kind == "user-saved")
            {
                var row = Object(Value(data, "turn")); Number(Value(row, "seq"));
                if (PanelState.Text(data, "conversationId") != ConversationId || PanelState.Text(row, "conversationId") != ConversationId ||
                    PanelState.Text(row, "id") != UserTurnId || PanelState.Text(row, "role") != "user" || PanelState.Text(row, "text") != Text)
                    throw new InvalidOperationException("Invalid saved message acknowledgement");
                SavedUser = Copy(row);
            }
            else if (kind == "run-meta")
            {
                if (Number(Value(data, "chatProtocolVersion")) != 1 || PanelState.Text(data, "conversationId") != ConversationId)
                    throw new InvalidOperationException("Unsupported reply protocol or conversation");
            }
            else if (kind == "turn-meta")
            {
                var id = PanelState.Text(data, "turnId");
                if (Number(Value(data, "schemaVersion")) != 1 || PanelState.Text(data, "conversationId") != ConversationId ||
                    !Uuid(id) || TurnId != "" && TurnId != id) throw new InvalidOperationException("Invalid reply identity");
                TurnId = id; Phase = "running"; Connected = true;
            }
            else if (kind == "chat-event")
            {
                var number = Number(Value(data, "sequence"));
                if (Number(Value(data, "schemaVersion")) != 1 || !Matches(data) || number == 0 || PanelState.Text(data, "eventId") == "")
                    throw new InvalidOperationException("Invalid saved reply event");
                if (number <= Sequence)
                {
                    Dictionary<string, object> prior;
                    if (!events.TryGetValue(number, out prior) || !Equal(prior, data)) throw new InvalidOperationException("Conflicting saved reply event");
                    return;
                }
                if (number != Sequence + 1) throw new InvalidOperationException("The saved reply has a sequence gap");
                var item = Object(Value(data, "event")); var type = PanelState.Text(item, "type");
                if (type == "delta")
                {
                    if (!(Value(item, "text") is string) || Encoding.UTF8.GetByteCount(Raw + (string)item["text"]) > 8 * 1024 * 1024)
                        throw new InvalidOperationException("Invalid or oversized reply text");
                    Raw += (string)item["text"];
                    var open = Regex.Match(Raw, "<say>", RegexOptions.IgnoreCase);
                    if (open.Success)
                    {
                        var text = Raw.Substring(open.Index + open.Length); var close = Regex.Match(text, "</say>", RegexOptions.IgnoreCase);
                        if (close.Success) text = text.Substring(0, close.Index);
                        else for (var n = Math.Min(5, text.Length); n > 0; --n)
                            if (text.EndsWith("</say>".Substring(0, n), StringComparison.OrdinalIgnoreCase)) { text = text.Substring(0, text.Length - n); break; }
                        DisplayText = text;
                    }
                }
                else if (type == "tool_call" || type == "tool_result")
                {
                    if (PanelState.Text(item, "name") == "" || PanelState.Text(item, "callId") == "" || type == "tool_result" && !(Value(item, "ok") is bool))
                        throw new InvalidOperationException("Invalid tool activity");
                    Tools.Add(PanelState.Text(item, "name") + (type == "tool_call" ? " · running" : (bool)item["ok"] ? " · complete" : " · failed"));
                }
                else if (type == "lifecycle")
                { if (!Phases.Contains(PanelState.Text(item, "phase"))) throw new InvalidOperationException("Invalid reply lifecycle"); Phase = PanelState.Text(item, "phase"); }
                else if (type == "error") throw new InvalidOperationException(PanelState.Text(item, "message"));
                else if (!new[] { "done", "session", "provenance", "result" }.Contains(type)) throw new InvalidOperationException("Unsupported saved reply event");
                Sequence = number; events[number] = Copy(data); if (events.Count > 5000) events.Remove(number - 5000);
            }
            else if (kind == "turn-state")
            {
                var phase = ReplyState(data);
                if (new[] { "failed", "cancelled", "interrupted", "needs-reconciliation" }.Contains(phase)) throw new InvalidOperationException("The saved reply is " + phase);
                Phase = phase;
            }
            else if (kind == "done")
            {
                var turn = Object(Value(data, "persistedTurn")); Number(Value(turn, "seq"));
                if (!Matches(turn) || Value(data, "phase") != null && PanelState.Text(data, "phase") != "completed")
                    throw new InvalidOperationException("The saved reply acknowledgement was lost or does not match");
                Complete = true; Connected = false; Phase = "completed";
            }
            else if (kind == "cancelled")
            {
                if (!System.Object.Equals(Value(data, "ok"), true) || ReplyState(Object(Value(data, "state"))) != "cancelled")
                    throw new InvalidOperationException("Reply cancellation needs reconciliation");
                Complete = true; Connected = false; Phase = "cancelled";
            }
            else throw new InvalidOperationException(kind == "error" ? PanelState.Text(data, "message") : "Unsupported reply frame");
        }
    }

    public sealed class ChatState
    {
        public int Generation;
        public bool Loading, Loaded, HasMoreEarlier;
        public string Error;
        public Dictionary<string, object> Environment, Conversation;
        public List<Dictionary<string, object>> Turns = new List<Dictionary<string, object>>();
        public ChatReply Reply;
        public List<PanelResult> ReferencePlans = new List<PanelResult>();
        public string ReferenceKey = "", ReferenceError;
        private Dictionary<string, object> referenceEnvironment;
        private string referenceConversation = "";
        private readonly Dictionary<string, string> drafts = new Dictionary<string, string>();
        public string ConversationId { get { return Conversation == null ? "" : PanelState.Text(Conversation, "id"); } }
        public bool Ready { get { return Loaded && ConversationId != "" && AccountState.SameEnvironment(Environment, Environment); } }
        private string DraftKey { get { return ConversationId == "" || !AccountState.SameEnvironment(Environment, Environment) ? null :
            new JavaScriptSerializer().Serialize(new[] { PanelState.Text(Environment, "endpoint"), PanelState.Text(Environment, "workspaceId"),
                PanelState.Text(ChatReply.Object(Environment["store"]), "id"), PanelState.Text(ChatReply.Object(Environment["agentChat"]), "scope"), ConversationId }); } }
        public string Draft
        { get { string text; return DraftKey != null && drafts.TryGetValue(DraftKey, out text) ? text : ""; }
          set { var key = DraftKey; if (key != null) drafts[key] = value ?? ""; } }
        public int Begin()
        { ++Generation; Environment = null; Conversation = null; Turns.Clear(); ReferencePlans.Clear(); ReferenceError = null; Loading = true; Loaded = false; HasMoreEarlier = false; Reply = null; Error = null; return Generation; }
        private static Dictionary<string, object> Row(Dictionary<string, object> payload, Dictionary<string, object> environment)
        {
            if (!AccountState.SameEnvironment(environment, ChatReply.Value(payload, "environment") as Dictionary<string, object>))
                throw new InvalidOperationException("The selected conversation environment changed");
            return AccountState.One(payload);
        }
        public bool Bind(int generation, Dictionary<string, object> environment, Dictionary<string, object> payload)
        {
            if (generation != Generation) return false;
            var row = Row(payload, environment);
            if (!ChatReply.Uuid(PanelState.Text(row, "id")) || PanelState.Text(row, "workspaceId") != PanelState.Text(environment, "workspaceId") ||
                PanelState.Text(row, "subjectKind") != "global" || PanelState.Text(row, "status") != "active")
                throw new InvalidOperationException("The active Papercup conversation is unavailable");
            if (!AccountState.SameEnvironment(referenceEnvironment, environment) || referenceConversation != PanelState.Text(row, "id")) ReferenceKey = "";
            Environment = ChatReply.Copy(environment); Conversation = ChatReply.Copy(row); return true;
        }
        public bool SettleReferencePlans(int generation, Dictionary<string, object> environment, Dictionary<string, object> payload, Exception failure = null)
        {
            if (generation != Generation || !Ready || !AccountState.SameEnvironment(Environment, environment)) return false;
            try
            {
                if (failure != null) throw failure;
                if (payload == null || Object.Equals(ChatReply.Value(payload, "ok"), false) || Object.Equals(ChatReply.Value(payload, "partial"), true) ||
                    !String.IsNullOrEmpty(PanelState.Text(payload, "error")) || !AccountState.SameEnvironment(environment, ChatReply.Value(payload, "environment") as Dictionary<string, object>))
                    throw new InvalidOperationException("Work link contexts are unavailable or incomplete");
                var rows = ChatReply.Value(payload, "rows") as IList;
                if (rows == null) throw new InvalidOperationException("Work link contexts are missing");
                var plans = rows.Cast<object>().Select(row => PanelState.Result("plans", ChatReply.Object(row))).ToList();
                if (plans.Select(plan => plan.Key).Distinct().Count() != plans.Count) throw new InvalidOperationException("Work link contexts contain duplicate plans");
                ReferencePlans = plans; ReferenceError = null;
                if (!plans.Any(plan => plan.Key == ReferenceKey)) ReferenceKey = "";
            }
            catch (Exception error) { ReferencePlans.Clear(); ReferenceKey = ""; ReferenceError = error.Message; }
            return true;
        }
        public void SelectReferencePlan(string key)
        {
            if (!Ready || key != "" && !ReferencePlans.Any(plan => plan.Key == key)) throw new InvalidOperationException("Select a current work link context");
            ReferenceKey = key; referenceEnvironment = ChatReply.Copy(Environment); referenceConversation = ConversationId;
        }
        public string ReferenceHarness
        { get { var selected = ReferencePlans.FirstOrDefault(plan => plan.Key == ReferenceKey); return selected == null ? PanelState.Text(Conversation, "harnessSlug") : PanelState.Text(selected.Row, "harness"); } }
        public string ReferencePlan(string perTurn)
        { var selected = ReferencePlans.FirstOrDefault(plan => plan.Key == ReferenceKey); return !String.IsNullOrEmpty(perTurn) ? perTurn : selected == null ? "" : PanelState.Text(selected.Row, "slug"); }
        public long BeginEarlier()
        {
            if (!Ready || Loading || Reply != null || !HasMoreEarlier || Turns.Count == 0) throw new InvalidOperationException("Earlier messages are unavailable");
            Loading = true; Error = null; return ChatReply.Number(Turns[0]["seq"]);
        }
        public bool Settle(int generation, Dictionary<string, object> environment, string id, Dictionary<string, object> payload, long? before = null)
        {
            if (generation != Generation) return false;
            if (!Loading || !AccountState.SameEnvironment(Environment, environment) || id != ConversationId || id == "")
                throw new InvalidOperationException("The selected Papercup conversation changed");
            var row = Row(payload, environment); var items = ChatReply.Value(row, "turns") as IList;
            if (items == null || !(ChatReply.Value(row, "hasMoreEarlier") is bool) || (bool)row["hasMoreEarlier"] && items.Count == 0)
                throw new InvalidOperationException("Papercup history is incomplete");
            var ids = new HashSet<string>(); var turns = new List<Dictionary<string, object>>(); long previous = -1;
            foreach (var item in items)
            {
                var turn = ChatReply.Object(item); var sequence = ChatReply.Number(ChatReply.Value(turn, "seq"));
                if (PanelState.Text(turn, "id") == "" || !ids.Add(PanelState.Text(turn, "id")) || PanelState.Text(turn, "conversationId") != id ||
                    sequence <= previous || before.HasValue && sequence >= before.Value || !(ChatReply.Value(turn, "text") is string) ||
                    !new[] { "user", "assistant", "system", "tool" }.Contains(PanelState.Text(turn, "role"))) throw new InvalidOperationException("Invalid or foreign history message");
                previous = sequence; turns.Add(ChatReply.Copy(turn));
            }
            if (before.HasValue && (!Loaded || Turns.Count == 0 || ChatReply.Number(Turns[0]["seq"]) != before.Value || Turns.Any(turn => ids.Contains(PanelState.Text(turn, "id")))))
                throw new InvalidOperationException("Earlier messages changed; refresh the conversation");
            if (!before.HasValue && Loaded) throw new InvalidOperationException("History was already loaded");
            if (before.HasValue) turns.AddRange(Turns); Turns = turns;
            HasMoreEarlier = (bool)row["hasMoreEarlier"]; Loading = false; Loaded = true; Error = null; return true;
        }
        public bool CanSend { get { return Ready && !Loading && (Reply == null || Reply.Complete) && !String.IsNullOrWhiteSpace(Draft) && Encoding.UTF8.GetByteCount(Draft) <= 32768; } }
        public Dictionary<string, object> Send(string userTurnId)
        {
            if (!CanSend) throw new InvalidOperationException("Load the conversation and enter a bounded message first");
            Reply = new ChatReply(Environment, ConversationId, Draft, userTurnId); Error = null; return Reply.SendRequest();
        }
        public bool Receive(int generation, Dictionary<string, object> frame)
        {
            if (generation != Generation) return false;
            if (Reply == null) throw new InvalidOperationException("No reply is active");
            Reply.Receive(frame); var row = Reply.SavedUser;
            if (row != null && !Turns.Any(turn => PanelState.Text(turn, "id") == PanelState.Text(row, "id")))
            { Turns.Add(ChatReply.Copy(row)); if (Draft == Reply.Text) Draft = ""; }
            Error = null; return true;
        }
        public void Fail(int generation, Exception error)
        { if (generation == Generation) { Loading = false; Error = error.Message; if (Reply != null) Reply.Disconnected(); } }
    }

    // Windows projection of GNOME NativeCard/NativeCardsState and the shared
    // native-cards contract. The operator owns validation and approval.
    public sealed class NativeCard
    {
        public readonly string RunId, Id, Kind;
        public readonly Dictionary<string, object> Raw, Presentation;
        public readonly List<Dictionary<string, object>> Options;
        public NativeCard(string runId, Dictionary<string, object> raw)
        {
            RunId = runId; Raw = ChatReply.Copy(raw); Id = PanelState.Text(Raw, "correlationId");
            Presentation = ChatReply.Value(Raw, "presentation") as Dictionary<string, object> ?? new Dictionary<string, object>();
            Kind = PanelState.Text(Presentation, "kind"); Options = new List<Dictionary<string, object>>();
            var encoded = ChatReply.Value(Presentation, "options");
            if (encoded is string) encoded = new JavaScriptSerializer().DeserializeObject((string)encoded);
            var options = encoded as IList;
            if (options != null) foreach (var option in options) Options.Add(ChatReply.Object(option));
            if (new[] { "radio", "checkbox", "select" }.Contains(Kind) && (Options.Count == 0 ||
                Options.Any(option => PanelState.Text(option, "id") == "" || PanelState.Text(option, "label") == "") ||
                Options.Select(option => PanelState.Text(option, "id")).Distinct().Count() != Options.Count))
                throw new InvalidOperationException("Card choices are incomplete");
        }
        public bool CanSubmit { get { return new[] { "radio", "checkbox", "select", "text", "date", "slider" }.Contains(Kind); } }
        public bool Expired { get {
            var timeout = ChatReply.Value(Raw, "timeoutMs");
            if (timeout == null) return false;
            var milliseconds = Convert.ToDouble(timeout, System.Globalization.CultureInfo.InvariantCulture);
            return !Double.IsNaN(milliseconds) && !Double.IsInfinity(milliseconds) && milliseconds > 0 &&
                (DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds >= ChatReply.Number(Raw["createdAt"]) + milliseconds;
        } }
        public string SecureLink(Dictionary<string, object> environment)
        {
            Uri origin;
            if (!Regex.IsMatch(Id, @"\A[A-Za-z0-9.\-]+\z") || !AccountState.SameEnvironment(environment, environment) ||
                !Uri.TryCreate(PanelState.Text(environment, "endpoint"), UriKind.Absolute, out origin) ||
                !(origin.Scheme == "http" || origin.Scheme == "https") || origin.UserInfo != "") return null;
            var path = "/api/ui/cards/" + Uri.EscapeDataString(Id) + "/link";
            return PanelState.Text(Presentation, "link") == path ? origin.GetLeftPart(UriPartial.Authority) + path : null;
        }
        public Dictionary<string, object> Answer(IEnumerable<string> selected = null, string value = "")
        {
            value = value ?? ""; var picks = (selected ?? new string[0]).ToArray();
            if (new[] { "radio", "checkbox", "select" }.Contains(Kind))
            {
                var minimum = Object.Equals(ChatReply.Value(Presentation, "allowEmpty"), true) ? 0 : 1;
                if (picks.Length < minimum || picks.Length > (Kind == "checkbox" ? Options.Count : 1) ||
                    picks.Distinct().Count() != picks.Length || picks.Any(id => !Options.Any(option => PanelState.Text(option, "id") == id)))
                    throw new InvalidOperationException("Choose the available answers");
                return new Dictionary<string, object> { { "picks", picks } };
            }
            if (Kind == "text")
            {
                if ((!Object.Equals(ChatReply.Value(Presentation, "allowEmpty"), true) && String.IsNullOrWhiteSpace(value)) ||
                    Encoding.UTF8.GetByteCount(value) > 32768) throw new InvalidOperationException("Enter a bounded answer");
                return new Dictionary<string, object> { { "value", value } };
            }
            if (Kind == "date")
            {
                DateTime date; var minimum = PanelState.Text(Presentation, "min"); var maximum = PanelState.Text(Presentation, "max");
                if (!DateTime.TryParseExact(value, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None, out date) ||
                    minimum != "" && String.CompareOrdinal(value, minimum) < 0 || maximum != "" && String.CompareOrdinal(value, maximum) > 0)
                    throw new InvalidOperationException("Choose a valid date in the displayed range");
                return new Dictionary<string, object> { { "value", value } };
            }
            if (Kind == "slider")
            {
                double number; var minimumValue = ChatReply.Value(Presentation, "min"); var maximumValue = ChatReply.Value(Presentation, "max");
                if (!(minimumValue is ValueType) || !(maximumValue is ValueType) || minimumValue is bool || maximumValue is bool)
                    throw new InvalidOperationException("The question range is unavailable");
                var minimum = Convert.ToDouble(minimumValue); var maximum = Convert.ToDouble(maximumValue);
                var step = Convert.ToDouble(ChatReply.Value(Presentation, "step") ?? 1);
                if (!Double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out number) ||
                    Double.IsNaN(number) || Double.IsInfinity(number) || Double.IsNaN(minimum) || Double.IsInfinity(minimum) ||
                    Double.IsNaN(maximum) || Double.IsInfinity(maximum) || Double.IsNaN(step) || Double.IsInfinity(step) ||
                    step <= 0 || number < minimum || number > maximum || Math.Abs((number - minimum) / step - Math.Round((number - minimum) / step)) > 0.000001)
                    throw new InvalidOperationException("Choose a value on the displayed range and steps");
                return new Dictionary<string, object> { { "value", number } };
            }
            throw new InvalidOperationException("This question requires another supported surface");
        }
    }

    public sealed class NativeCardsState
    {
        public int Generation;
        public Dictionary<string, object> Environment;
        public string ConversationId = "", Error, Pending;
        public bool Connected;
        private readonly Dictionary<string, List<NativeCard>> runs = new Dictionary<string, List<NativeCard>>();
        private readonly Dictionary<string, Dictionary<string, object>> snapshots = new Dictionary<string, Dictionary<string, object>>();
        private readonly HashSet<string> acknowledged = new HashSet<string>();
        public List<NativeCard> Cards { get { return runs.Values.SelectMany(cards => cards).Where(card => !acknowledged.Contains(card.Id))
            .OrderBy(card => ChatReply.Number(card.Raw["createdAt"])).ThenBy(card => card.Id, StringComparer.Ordinal).ToList(); } }
        public int Begin(Dictionary<string, object> environment, string conversationId)
        {
            ++Generation; Environment = environment == null ? null : ChatReply.Copy(environment); ConversationId = conversationId ?? "";
            Connected = false; Error = null; Pending = null; runs.Clear(); snapshots.Clear(); acknowledged.Clear(); return Generation;
        }
        public Dictionary<string, object> Subscription { get { return new Dictionary<string, object> {
            { "environment", Environment }, { "conversationId", ConversationId }, { "operation", "subscribe" } }; } }
        public bool Receive(int token, Dictionary<string, object> frame)
        {
            if (token != Generation) return false;
            var data = ChatReply.Object(ChatReply.Value(frame, "data"));
            if (ConversationId == "" || !AccountState.SameEnvironment(Environment, ChatReply.Value(frame, "environment") as Dictionary<string, object>) ||
                PanelState.Text(data, "workspaceId") != PanelState.Text(Environment, "workspaceId")) throw new InvalidOperationException("The card environment changed");
            if (PanelState.Text(frame, "event") == "reset") { runs.Clear(); snapshots.Clear(); Connected = true; Error = null; return true; }
            var run = PanelState.Text(data, "runId"); var snapshot = ChatReply.Object(ChatReply.Value(data, "snapshot"));
            var rows = ChatReply.Value(snapshot, "openCards") as IList; var version = ChatReply.Number(ChatReply.Value(data, "version"));
            if (PanelState.Text(frame, "event") != "snapshot" || run == "" || rows == null) throw new InvalidOperationException("The card snapshot is unavailable");
            Dictionary<string, object> before;
            if (snapshots.TryGetValue(run, out before) && ChatReply.Number(before["version"]) >= version)
            {
                if (ChatReply.Number(before["version"]) == version && !ChatReply.Equal(before, data)) throw new InvalidOperationException("Conflicting card snapshot");
                return false;
            }
            var ids = new HashSet<string>(); var next = new List<NativeCard>();
            foreach (var item in rows)
            {
                var row = ChatReply.Object(item); var id = PanelState.Text(row, "correlationId");
                if (PanelState.Text(row, "conversationId") != ConversationId || id == "" || !ids.Add(id) || PanelState.Text(row, "prompt") == "")
                    throw new InvalidOperationException("A card has an invalid or foreign identity");
                ChatReply.Number(ChatReply.Value(row, "createdAt")); next.Add(new NativeCard(run, row));
            }
            if (runs.Any(pair => pair.Key != run && pair.Value.Any(card => ids.Contains(card.Id)))) throw new InvalidOperationException("A card belongs to multiple runs");
            runs[run] = next; snapshots[run] = ChatReply.Copy(data); Connected = true; Error = null; return true;
        }
        public Dictionary<string, object> Request(NativeCard card, string action, Dictionary<string, object> payload = null)
        {
            if (!Connected || Pending != null || !Cards.Contains(card) || card.Expired || !new[] { "submit", "decline", "cancel" }.Contains(action) ||
                action == "submit" && !card.CanSubmit || action == "decline" && Object.Equals(ChatReply.Value(card.Raw, "allowDecline"), false))
                throw new InvalidOperationException("This card changed; reconnect before answering");
            // Revalidate the typed value here as well as in the control: a
            // caller cannot bypass choice/range checks with a fabricated body.
            if (action == "submit")
            {
                if (payload == null) throw new InvalidOperationException("Choose an answer first");
                var picks = ChatReply.Value(payload, "picks") as IList;
                payload = card.Answer(picks == null ? null : picks.Cast<object>().Select(value => value as string),
                    Convert.ToString(ChatReply.Value(payload, "value"), System.Globalization.CultureInfo.InvariantCulture));
            }
            var request = Subscription; request["operation"] = "respond"; request["correlationId"] = card.Id; request["action"] = action;
            if (action == "submit") request["payload"] = payload; Pending = card.Id; Error = null; return request;
        }
        public bool Responded(int token, string id, Dictionary<string, object> receipt)
        {
            if (token != Generation) return false;
            var row = AccountState.One(receipt);
            if (Pending != id || !AccountState.SameEnvironment(Environment, ChatReply.Value(receipt, "environment") as Dictionary<string, object>) ||
                !Object.Equals(ChatReply.Value(row, "responded"), true) || PanelState.Text(row, "conversationId") != ConversationId || PanelState.Text(row, "correlationId") != id)
                throw new InvalidOperationException("The card response needs reconciliation");
            acknowledged.Add(id); Pending = null; Error = null; return true;
        }
        public void Failed(int token, Exception error)
        { if (token == Generation) { Pending = null; Connected = false; Error = error.Message; } }
    }

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
            foreach (var kind in Kinds.Where(k => Scope == "all" || Scope == k ||
                Scope == "organizer" && (k == "agents" || k == "goals"))) Sources[kind] = new PanelSource();
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

    public sealed class OrganizerGroup
    {
        public string Kind, Id, Slug, Harness, Key, Label;
        public List<PanelResult> Rows = new List<PanelResult>();
    }
    public sealed class OrganizerRect
    {
        public int X, Y, Width, Height;
        public bool Matches(OrganizerRect other)
        { return other != null && Math.Abs((long)X - other.X) <= 2 && Math.Abs((long)Y - other.Y) <= 2 &&
            Math.Abs((long)Width - other.Width) <= 2 && Math.Abs((long)Height - other.Height) <= 2; }
    }
    public sealed class OrganizerWindow
    {
        public IntPtr Handle, Monitor;
        public string Title, Desktop, Unsupported;
        public OrganizerRect Area, Bounds;
    }
    public sealed class OrganizerReceipt
    {
        public string OwnerId, SessionId, Host, Desktop, Monitor, Status = "failed", Error;
        public OrganizerRect Requested, Observed;
    }
    // Projection of the same canonical grouping and receipts as the GNOME model.
    // Native adapters own window inspection/mutation; no parallel roster is kept.
    public static class OrganizerState
    {
        private static string Text(Dictionary<string, object> row, string key) { return InboxState.Text(row, key); }
        private static string Harness(PanelResult row)
        { var value = Text(row.Row, "potSlug"); return value == "" ? Text(row.Row, "harnessSlug") : value; }
        private static List<Dictionary<string, object>> Rows(object value)
        {
            var list = value as IList;
            if (list == null || list.Cast<object>().Any(row => !(row is Dictionary<string, object>)))
                throw new InvalidOperationException("Canonical links are unavailable");
            return list.Cast<Dictionary<string, object>>().ToList();
        }
        private static List<PanelResult> Roster(Dictionary<string, object> payload)
        {
            var state = new PanelState { Scope = "agents" }; var generation = state.BeginRefresh();
            state.Settle("agents", generation, payload, null); var source = state.Sources["agents"];
            if (source.Status != "ready" || source.Partial)
                throw new InvalidOperationException("Canonical terminal roster is incomplete; refresh before arranging");
            return source.Rows;
        }
        public static List<OrganizerGroup> Groups(IEnumerable<PanelResult> agents, string kind, IEnumerable<PanelResult> goals)
        {
            if (kind == "goal") return goals.Select(row => new OrganizerGroup { Kind = kind,
                Id = Text(row.Row, "id"), Key = row.Key, Label = row.Title }).ToList();
            if (kind != "plan" && kind != "fleet") throw new InvalidOperationException("Unknown organization grouping");
            var groups = new Dictionary<string, OrganizerGroup>();
            foreach (var row in agents)
            {
                var slug = Text(row.Row, kind == "plan" ? "currentPlanSlug" : "fleetSlug");
                var harness = kind == "plan" ? Harness(row) : "";
                if (slug == "" || kind == "plan" && harness == "") continue;
                var key = new JavaScriptSerializer().Serialize(new[] { kind, harness, slug });
                if (!groups.ContainsKey(key)) groups[key] = new OrganizerGroup { Kind = kind, Key = key,
                    Slug = slug, Harness = harness, Label = kind == "plan" ? harness + " / " + slug : slug };
                groups[key].Rows.Add(row);
            }
            return groups.Values.ToList();
        }
        public static List<PanelResult> Members(OrganizerGroup group, Dictionary<string, object> roster,
            Dictionary<string, object> goalPayload = null)
        {
            var rows = Roster(roster);
            if (group.Kind == "goal")
            {
                var detail = InboxState.One(goalPayload);
                var goal = InboxState.Value(detail, "goal") as Dictionary<string, object>;
                if (Text(goal, "id") != group.Id || String.IsNullOrWhiteSpace(group.Id))
                    throw new InvalidOperationException("Canonical goal links changed; refresh before arranging");
                var agents = Rows(InboxState.Value(detail, "agents")); var plans = Rows(InboxState.Value(detail, "plans"));
                return rows.Where(row => agents.Any(agent => Text(agent, "ownerId") != "" &&
                    Text(agent, "ownerId") == Text(row.Row, "ownerId") && Object.Equals(InboxState.Value(agent, "live"), true)) ||
                    plans.Any(plan => Text(plan, "planSlug") != "" && Text(plan, "harnessSlug") != "" &&
                        Text(plan, "planSlug") == Text(row.Row, "currentPlanSlug") && Text(plan, "harnessSlug") == Harness(row))).ToList();
            }
            if (group.Kind != "plan" && group.Kind != "fleet") throw new InvalidOperationException("Unknown organization grouping");
            return rows.Where(row => group.Kind == "plan" ? Text(row.Row, "currentPlanSlug") == group.Slug && Harness(row) == group.Harness :
                Text(row.Row, "fleetSlug") == group.Slug).ToList();
        }
        public static async Task<List<OrganizerReceipt>> ArrangeAsync(OrganizerGroup group, Dictionary<string, object> roster,
            string host, IList<OrganizerWindow> windows, Func<OrganizerWindow, OrganizerRect, Task<OrganizerWindow>> place,
            Dictionary<string, object> goalPayload = null)
        {
            var current = Members(group, roster, goalPayload);
            var selected = group.Kind == "goal" ? current : group.Rows;
            if (selected.Count == 0) throw new InvalidOperationException("No canonical terminals in this group");
            var receipts = new List<OrganizerReceipt>();
            var resolved = new List<Tuple<OrganizerWindow, OrganizerReceipt>>();
            var titles = windows.ToDictionary(window => window.Handle, window => window.Title);
            foreach (var row in selected)
            {
                var receipt = new OrganizerReceipt { OwnerId = Text(row.Row, "ownerId"), SessionId = Text(row.Row, "advSessionId"),
                    Host = Text(row.Row, "host") == "" ? Text(row.Row, "hostname") : Text(row.Row, "host") };
                receipts.Add(receipt);
                try
                {
                    var target = PanelState.AgentTarget(roster, row, host, false);
                    if (!current.Any(candidate => candidate.Key == target.Key && Text(candidate.Row, "ownerId") == receipt.OwnerId &&
                        Text(candidate.Row, "windowId") == Text(row.Row, "windowId")))
                        throw new InvalidOperationException("The selected terminal changed group; refresh before arranging");
                    var handle = PanelState.ExactAgentWindow(target, titles); var window = windows.Single(value => value.Handle == handle);
                    receipt.Desktop = window.Desktop; receipt.Monitor = window.Monitor.ToInt64().ToString();
                    if (window.Unsupported != null) { receipt.Status = "unsupported"; throw new InvalidOperationException(window.Unsupported); }
                    if (String.IsNullOrWhiteSpace(window.Desktop) || window.Monitor == IntPtr.Zero || window.Area == null ||
                        window.Area.Width < 1 || window.Area.Height < 1) throw new InvalidOperationException("Desktop work area is unavailable");
                    resolved.Add(Tuple.Create(window, receipt));
                }
                catch (Exception error)
                {
                    if (receipt.Host != "" && !String.Equals(receipt.Host, host, StringComparison.OrdinalIgnoreCase)) receipt.Status = "unsupported";
                    else if (Text(row.Row, "sessionState") == "ended" || Text(row.Row, "stale") == "True" || Text(row.Row, "revoked") == "True") receipt.Status = "offline";
                    receipt.Error = error.Message;
                }
            }
            var unique = resolved.Where(entry => resolved.Count(other => other.Item1.Handle == entry.Item1.Handle) == 1).ToArray();
            foreach (var entry in resolved.Except(unique)) entry.Item2.Error = "Several selected sessions share this terminal window";
            foreach (var desktop in unique.GroupBy(entry => new { entry.Item1.Desktop, entry.Item1.Monitor }))
            {
                var entries = desktop.ToArray(); var area = entries[0].Item1.Area;
                var columns = Math.Min(entries.Length, Math.Max(1, (int)Math.Ceiling(Math.Sqrt(entries.Length * (double)area.Width / area.Height))));
                var rows = (int)Math.Ceiling(entries.Length / (double)columns);
                for (var index = 0; index < entries.Length; ++index)
                {
                    var window = entries[index].Item1; var receipt = entries[index].Item2;
                    var column = index % columns; var row = index / columns;
                    var x = area.X + (int)Math.Round(column * (double)area.Width / columns);
                    var y = area.Y + (int)Math.Round(row * (double)area.Height / rows);
                    var rect = new OrganizerRect { X = x + 12, Y = y + 12,
                        Width = area.X + (int)Math.Round((column + 1) * (double)area.Width / columns) - x - 24,
                        Height = area.Y + (int)Math.Round((row + 1) * (double)area.Height / rows) - y - 24 };
                    receipt.Requested = rect;
                    try
                    {
                        if (rect.Width < 1 || rect.Height < 1) throw new InvalidOperationException("Too many terminals for this desktop");
                        var actual = await place(window, rect); receipt.Observed = actual == null ? null : actual.Bounds;
                        if (actual == null || actual.Desktop != window.Desktop || actual.Monitor != window.Monitor || !rect.Matches(actual.Bounds))
                            throw new InvalidOperationException("The terminal did not reach its requested layout within its desktop");
                        receipt.Status = "moved";
                    }
                    catch (Exception error) { receipt.Error = error.Message; }
                }
            }
            return receipts;
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
