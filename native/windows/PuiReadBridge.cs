// Windows Workbench uses the existing PUI discovery/auth/query path. This
// adapter owns only JSON framing and a bounded child lifetime, never a server
// or a second credential store. Compatible with Windows PowerShell/.NET 4.8.
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace Papercusp.Workbench
{
    public static class PuiReadBridge
    {
        private const int MaxRequestBytes = 64 * 1024;
        private const int MaxResponseBytes = 16 * 1024 * 1024;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private static readonly HashSet<string> Models = new HashSet<string>(StringComparer.Ordinal)
        {
            "plans.list", "plans.get", "advRoster.list", "reports.list", "reports.get",
            "goals.list", "goals.detail", "planSessions.list", "operator.identity",
            "accounts.pool", "accounts.sessionOverride", "plans.attention",
            "plans.attentionItem", "plans.attentionBulkRun", "operatorConversations.current", "operatorTurns.page"
        };

        private static void Stop(Process process)
        {
            StopIfRunning(() => process.HasExited, () => process.Kill());
        }

        private static void StopIfRunning(Func<bool> hasExited, Action kill)
        {
            try { if (!hasExited()) kill(); }
            catch (InvalidOperationException) { /* exited between the two calls */ }
            catch (Win32Exception error)
            {
                // TerminateProcess returns access denied for an already-exited
                // process on .NET Framework. Re-check the owned process after
                // that failure; an actual live-process denial must still surface.
                if (error.NativeErrorCode != 5 || !hasExited()) throw;
            }
        }

        private static async Task<string> ReadOutput(Stream stream, Process process)
        {
            try
            {
                using (var bytes = new MemoryStream())
                {
                    var buffer = new byte[8192];
                    int count;
                    while ((count = await stream.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) != 0)
                    {
                        if (bytes.Length + count > MaxResponseBytes)
                            throw new InvalidDataException("PUI output exceeds the native panel limit");
                        bytes.Write(buffer, 0, count);
                    }
                    return Utf8.GetString(bytes.ToArray());
                }
            }
            catch { Stop(process); throw; }
        }

        public static Task<Dictionary<string, object>> ReadAsync(
            string pui, string name, Dictionary<string, object> args,
            CancellationToken cancellation, int timeoutMilliseconds = 22000,
            Dictionary<string, object> environment = null)
        {
            if (!Models.Contains(name ?? "")) throw new ArgumentException("Unsupported native read model", "name");
            return InvokeAsync(pui, "native-read", new Dictionary<string, object> {
                { "name", name }, { "args", args ?? new Dictionary<string, object>() }, { "environment", environment }
            }, cancellation, timeoutMilliseconds);
        }

        public static Task<Dictionary<string, object>> AccountAsync(string pui,
            Dictionary<string, object> environment, string action, string accountId, CancellationToken cancellation)
        {
            if (environment == null || !(action == "default" || action == "force" || action == "exclude" || action == "auto"))
                throw new ArgumentException("Select an environment and account control");
            return InvokeAsync(pui, "native-account", new Dictionary<string, object> {
                { "environment", environment }, { "action", action }, { "accountId", accountId }
            }, cancellation, 22000);
        }

        public static Task<Dictionary<string, object>> GoalAsync(string pui,
            Dictionary<string, object> environment, Dictionary<string, object> detail,
            string action, bool confirmed, CancellationToken cancellation)
        {
            if (environment == null || detail == null || !confirmed ||
                !(action == "pause" || action == "resume" || action == "start" || action == "reopen" || action == "achieve" || action == "kill"))
                throw new ArgumentException("Select a goal and confirm its control");
            var goal = detail["goal"] as Dictionary<string, object>;
            if (goal == null) throw new ArgumentException("Canonical goal detail is unavailable");
            return InvokeAsync(pui, "native-goal", new Dictionary<string, object> {
                { "environment", environment }, { "goalId", goal["id"] }, { "action", action },
                { "expectedStatus", goal["status"] }, { "expectedEffectiveStatus", detail["effectiveStatus"] },
                { "expectedHolderLiveness", detail["holderLiveness"] }, { "confirmed", confirmed }
            }, cancellation, 22000);
        }

        public static Task<Dictionary<string, object>> InboxAsync(string pui,
            Dictionary<string, object> request, CancellationToken cancellation)
        {
            object confirmed, operation, environment;
            if (request == null || !request.TryGetValue("confirmed", out confirmed) || !Object.Equals(confirmed, true) ||
                !request.TryGetValue("operation", out operation) || !(operation is string) ||
                !new HashSet<string> { "start", "stop", "resume", "apply", "resolve" }.Contains((string)operation) ||
                !request.TryGetValue("environment", out environment) || !(environment is Dictionary<string, object>))
                throw new ArgumentException("Select an environment and confirm the Inbox action");
            return InvokeAsync(pui, "native-inbox", request, cancellation, 22000);
        }

        // PUI owns discovery, credentials, saved turns and replay. Frames are
        // delivered as they arrive; callers marshal them to their UI thread.
        // Cancelling this pipe never claims to cancel the saved operator turn.
        public static Task ChatAsync(string pui, Dictionary<string, object> request,
            Action<Dictionary<string, object>> receive, CancellationToken cancellation,
            int timeoutMilliseconds = 615000)
        {
            object environment, operation;
            if (request == null || receive == null || !request.TryGetValue("environment", out environment) ||
                !(environment is Dictionary<string, object>) || !request.TryGetValue("operation", out operation) ||
                !new[] { "send", "reconnect", "cancel" }.Contains(Convert.ToString(operation)))
                throw new ArgumentException("Select a conversation and reply operation");
            return InvokeAsync(pui, "native-chat", request, cancellation, timeoutMilliseconds, receive);
        }

        private static async Task<string> ReadFrames(Stream stream, Process process,
            Action<Dictionary<string, object>> receive)
        {
            try
            {
                var json = new JavaScriptSerializer { MaxJsonLength = MaxResponseBytes };
                using (var line = new MemoryStream())
                {
                    var buffer = new byte[8192]; var total = 0; var frames = 0; int count;
                    while ((count = await stream.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) != 0)
                    {
                        total += count;
                        if (total > MaxResponseBytes) throw new InvalidDataException("PUI stream exceeds the native panel limit");
                        for (var i = 0; i < count; ++i)
                        {
                            if (buffer[i] != 10)
                            {
                                if (line.Length >= 1024 * 1024) throw new InvalidDataException("PUI frame exceeds the native panel limit");
                                line.WriteByte(buffer[i]); continue;
                            }
                            var frame = json.DeserializeObject(Utf8.GetString(line.ToArray())) as Dictionary<string, object>;
                            object kind, environment;
                            if (frame == null || !frame.TryGetValue("event", out kind) || !(kind is string) ||
                                String.IsNullOrWhiteSpace((string)kind) || !frame.ContainsKey("data") ||
                                !frame.TryGetValue("environment", out environment) || !(environment is Dictionary<string, object>))
                                throw new InvalidDataException("PUI returned an invalid reply frame");
                            receive(frame); ++frames; line.SetLength(0);
                        }
                    }
                    if (line.Length != 0) throw new InvalidDataException("PUI returned an incomplete reply frame");
                    if (frames == 0) throw new InvalidDataException("PUI returned no reply frames");
                }
                return "";
            }
            catch { Stop(process); throw; }
        }

        private static async Task<Dictionary<string, object>> InvokeAsync(string pui, string command,
            Dictionary<string, object> body, CancellationToken cancellation, int timeoutMilliseconds,
            Action<Dictionary<string, object>> receive = null)
        {
            cancellation.ThrowIfCancellationRequested();
            if (String.IsNullOrWhiteSpace(pui) || !Path.IsPathRooted(pui) || !File.Exists(pui))
                throw new ArgumentException("Select an installed PUI executable", "pui");
            if (timeoutMilliseconds < 1) throw new ArgumentOutOfRangeException("timeoutMilliseconds");
            var json = new JavaScriptSerializer { MaxJsonLength = MaxResponseBytes };
            var request = Utf8.GetBytes(json.Serialize(body));
            if (request.Length > MaxRequestBytes)
                throw new ArgumentException("native panel request exceeds 64 KiB", "body");

            using (var process = new Process())
            using (var deadline = new CancellationTokenSource())
            {
                process.StartInfo = new ProcessStartInfo
                {
                    FileName = pui,
                    Arguments = command,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                if (!process.Start()) throw new IOException("Could not start PUI native-read");
                using (cancellation.Register(() => Stop(process)))
                {
                    var stdout = receive == null ? ReadOutput(process.StandardOutput.BaseStream, process) :
                        ReadFrames(process.StandardOutput.BaseStream, process, receive);
                    var stderr = ReadOutput(process.StandardError.BaseStream, process);
                    var exit = Task.Run(() => process.WaitForExit(timeoutMilliseconds));
                    var timer = Task.Delay(timeoutMilliseconds, deadline.Token);
                    using (cancellation.Register(() => deadline.Cancel()))
                    {
                        try
                        {
                            // Write UTF-8 bytes directly: Windows PowerShell's console
                            // code page must never recode canonical IDs or report text.
                            var write = process.StandardInput.BaseStream.WriteAsync(request, 0, request.Length);
                            if (await Task.WhenAny(write, timer).ConfigureAwait(false) != write)
                            {
                                cancellation.ThrowIfCancellationRequested();
                                throw new TimeoutException("The selected operator did not respond in time");
                            }
                            await write.ConfigureAwait(false);
                            process.StandardInput.Close();
                            var finished = Task.WhenAll(stdout, stderr, (Task)exit);
                            if (await Task.WhenAny(finished, timer).ConfigureAwait(false) != finished)
                            {
                                cancellation.ThrowIfCancellationRequested();
                                throw new TimeoutException("The selected operator did not respond in time");
                            }
                            await finished.ConfigureAwait(false);
                            cancellation.ThrowIfCancellationRequested();
                            if (!exit.Result) throw new TimeoutException("PUI did not exit in time");
                            if (process.ExitCode != 0)
                                throw new IOException(String.IsNullOrWhiteSpace(stderr.Result)
                                    ? "PUI native-read failed" : stderr.Result.Trim());
                            if (receive != null) return null;
                            var payload = json.DeserializeObject(stdout.Result) as Dictionary<string, object>;
                            object rows, ok, error;
                            if (payload == null || !payload.TryGetValue("rows", out rows) ||
                                !(rows is IList) ||
                                (payload.TryGetValue("ok", out ok) && Object.Equals(ok, false)) ||
                                (payload.TryGetValue("error", out error) && error != null &&
                                    !Object.Equals(error, false) && !Object.Equals(error, "")))
                                throw new InvalidDataException("PUI returned an unavailable or invalid row envelope");
                            return payload;
                        }
                        finally
                        {
                            deadline.Cancel();
                            Stop(process);
                            // Reap the owned helper on timeout/cancel as well as success.
                            // No terminal or third-party agent process is targeted.
                            process.WaitForExit(2000);
                        }
                    }
                }
            }
        }
    }
}
