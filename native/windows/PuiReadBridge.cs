// Windows Workbench uses the existing PUI discovery/auth/query path. This
// adapter owns only JSON framing and a bounded child lifetime, never a server
// or a second credential store. Compatible with Windows PowerShell/.NET 4.8.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
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
            "accounts.pool", "accounts.sessionOverride"
        };

        private static void Stop(Process process)
        {
            try { if (!process.HasExited) process.Kill(); }
            catch (InvalidOperationException) { /* exited between the two calls */ }
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

        private static async Task<Dictionary<string, object>> InvokeAsync(string pui, string command,
            Dictionary<string, object> body, CancellationToken cancellation, int timeoutMilliseconds)
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
                    var stdout = ReadOutput(process.StandardOutput.BaseStream, process);
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
