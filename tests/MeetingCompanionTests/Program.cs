using System.Diagnostics;
using System.Text.Json;
using GimkitWebNotifications;
using Microsoft.Win32;

static Dictionary<string, Meeting> Parse(string json) => MeetingEngine.ParseMeetings(json);
static void Equal<T>(T expected, T actual)
{
    if (!EqualityComparer<T>.Default.Equals(expected, actual))
        throw new Exception($"Expected {expected}; got {actual}");
}

var messages = new List<string>();
MeetingState state = new();
string? saved = null;
Task Save(MeetingState value) { saved = JsonSerializer.Serialize(value, MeetingEngine.JsonOptions); return Task.CompletedTask; }
Task Notify(string title) { messages.Add(title); return Task.CompletedTask; }
Task Check(string active, string scheduled, long time, Func<string, Task>? notify = null) =>
    MeetingEngine.ProcessAsync(state, Parse(active), Parse(scheduled), time, notify ?? Notify, Save);

const string scheduled = """{"s":{"title":"Meeting","scheduledAt":200,"createdAt":1}}""";
await Check("""{"old":{"title":"Already active"}}""",
    """{"past":{"title":"Past","scheduledAt":50},"s":{"title":"Meeting","scheduledAt":200}}""", 100);
await Check("""{"old":{"title":"Already active"}}""", scheduled, 200);
await Check("""{"old":{"title":"Already active"}}""", scheduled, 210);
Equal("Meeting", string.Join(",", messages));

state = JsonSerializer.Deserialize<MeetingState>(saved!, MeetingEngine.JsonOptions)!;
await Check("""{"a":{"title":"Meeting","scheduledAt":200,"scheduledMeetingId":"s"}}""", "null", 220);
Equal(1, messages.Count);

state = new(); messages.Clear();
await Check("null", scheduled, 100);
await Check("""{"a":{"title":"Meeting","scheduledAt":200,"scheduledMeetingId":"s"}}""", scheduled, 150);
await Check("null", scheduled, 200);
Equal(1, messages.Count);

state = new(); messages.Clear();
await Check("null", scheduled, 100);
await Check("null", scheduled, 200);
await Check("""{"a":{"title":"Meeting","scheduledAt":200}}""", "null", 210);
Equal(1, messages.Count);

state = new(); messages.Clear();
const string twins = """{"first":{"title":"Meeting","scheduledAt":200},"second":{"title":"Meeting","scheduledAt":200}}""";
await Check("null", twins, 100);
await Check("""{"a":{"title":"Meeting","scheduledAt":200,"scheduledMeetingId":"first"}}""", twins, 200);
Equal(2, messages.Count);

state = new(); messages.Clear();
await Check("null", """{"s":{"title":"Meeting","scheduledAt":200}}""", 100);
await Check("null", """{"s":{"title":"Rescheduled","scheduledAt":300}}""", 200);
await Check("null", "null", 300);
await Check("""{"a":{"title":"New"}}""", "null", 310);
Equal("New", string.Join(",", messages));

state = new(); messages.Clear();
await Check("null", "null", 100);
try
{
    await Check("""{"a":{"title":"Retry"}}""", "null", 110, _ => throw new InvalidOperationException("failed"));
    throw new Exception("Delivery failure was not propagated.");
}
catch (InvalidOperationException error) when (error.Message == "failed") { }
await Check("""{"a":{"title":"Retry"}}""", "null", 120);
Equal("Retry", string.Join(",", messages));
try { Parse("[]"); throw new Exception("Invalid list was accepted."); }
catch (InvalidDataException) { }

state = new MeetingState { StartedAt = 100 };
using (var cancel = new CancellationTokenSource())
{
    try
    {
        await MeetingEngine.ProcessAsync(state,
            Parse("""{"a":{"title":"First"},"b":{"title":"Second"}}"""), Parse("null"), 120,
            _ => { cancel.Cancel(); return Task.CompletedTask; }, Save, cancel.Token);
        throw new Exception("Cancellation was not propagated.");
    }
    catch (OperationCanceledException) { }
    Equal(true, state.SeenActive.ContainsKey("a"));
    Equal(false, state.SeenActive.ContainsKey("b"));
}

const string oldState = """{"version":1,"startedAt":100,"seenActive":{"a":true},"notifiedScheduled":{"s":true},"scheduled":{"s":{"title":"Meeting","scheduledAt":200}}}""";
state = JsonSerializer.Deserialize<MeetingState>(oldState, MeetingEngine.JsonOptions)!;
Equal(true, state.SeenActive.ContainsKey("a"));
Equal(true, state.NotifiedScheduled.ContainsKey("s"));
Equal<long?>(null, state.LastCheckedAt);

if (OperatingSystem.IsWindows())
{
    string temporary = Path.Combine(Path.GetTempPath(), "gimkitapp-test-" + Guid.NewGuid().ToString("N"));
    string stateDir = Path.Combine(temporary, "GimkitWebNotifications");
    string stateFile = Path.Combine(stateDir, "state.json");
    string lockFile = Path.Combine(stateDir, "check.lock");
    Directory.CreateDirectory(stateDir);
    try
    {
        await File.WriteAllTextAsync(stateFile,
            """{"version":1,"startedAt":100,"lastAttemptedAt":1000,"lastCheckedAt":2000}""");
        Process Start(string command)
        {
            var start = new ProcessStartInfo(Path.Combine(AppContext.BaseDirectory, "gimkitapp.exe"))
            {
                WorkingDirectory = temporary,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            start.Environment["LOCALAPPDATA"] = temporary;
            start.ArgumentList.Add(command);
            return Process.Start(start)!;
        }

        using (var last = Start("last"))
        {
            string output = await last.StandardOutput.ReadToEndAsync();
            await last.WaitForExitAsync();
            Equal(0, last.ExitCode);
            Equal(true, output.Contains("Last check attempted:") && output.Contains("Last successful check:"));
        }
        using (var invalid = Start("invalid"))
        {
            await invalid.StandardError.ReadToEndAsync();
            await invalid.StandardOutput.ReadToEndAsync();
            await invalid.WaitForExitAsync();
            Equal(2, invalid.ExitCode);
        }

        await File.WriteAllTextAsync(stateFile, "invalid json");
        using var checkLock = new FileStream(lockFile, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        using var check = Start("check");
        Task exit = check.WaitForExitAsync();
        await Task.Delay(1000);
        bool waitedForLock = !exit.IsCompleted;
        checkLock.Dispose();
        string error = await check.StandardError.ReadToEndAsync();
        await check.StandardOutput.ReadToEndAsync();
        await exit;
        Equal(true, waitedForLock);
        Equal(1, check.ExitCode);
        Equal(true, error.Contains("Notification check failed:"));

        async Task<(int ExitCode, string Output, string Error)> Run(string command)
        {
            using var process = Start(command);
            Task<string> outputTask = process.StandardOutput.ReadToEndAsync();
            Task<string> errorTask = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(30));
            return (process.ExitCode, await outputTask, await errorTask);
        }

        try
        {
            var stopped = await Run("query");
            Equal(true, stopped.Output.Contains("stopped"));
            var started = await Run("start");
            Equal(0, started.ExitCode);
            Equal(true, started.Output.Contains("started"));
            var duplicate = await Run("start");
            Equal(true, duplicate.Output.Contains("already running"));
            (int ExitCode, string Output, string Error) status = (0, "", "");
            for (int i = 0; i < 30; i++)
            {
                status = await Run("query");
                if (status.Output.Contains("error:")) break;
                await Task.Delay(100);
            }
            Equal(1, status.ExitCode);
            Equal(true, status.Output.Contains("error:"));
            var restarted = await Run("restart");
            Equal(0, restarted.ExitCode);
            Equal(true, restarted.Output.Contains("started"));
            var stop = await Run("stop");
            Equal(0, stop.ExitCode);
            Equal(true, stop.Output.Contains("stopped"));
            Equal(true, (await Run("query")).Output.Contains("stopped"));
            Equal(true, (await Run("stop")).Output.Contains("stopped"));
        }
        finally
        {
            await Run("stop");
        }

        string registryPath = @"Software\GimkitWebNotificationsTests-" + Guid.NewGuid().ToString("N");
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(registryPath);
            Equal(true, BackgroundChecker.EnsureStartup(key, @"C:\Program Files\Gimkit\gimkitapp.exe"));
            Equal("\"C:\\Program Files\\Gimkit\\gimkitapp.exe\" start", key.GetValue("GimkitWebNotifications") as string);
            Equal(false, BackgroundChecker.EnsureStartup(key, @"C:\Program Files\Gimkit\gimkitapp.exe"));
            Equal(true, BackgroundChecker.EnsureStartup(key, @"C:\New\gimkitapp.exe"));
        }
        finally
        {
            Registry.CurrentUser.DeleteSubKey(registryPath);
        }
    }
    finally
    {
        File.Delete(stateFile);
        File.Delete(lockFile);
        File.Delete(Path.Combine(stateDir, "control.lock"));
        File.Delete(Path.Combine(stateDir, "worker.lock"));
        Directory.Delete(stateDir);
        string cache = Path.Combine(temporary, "Microsoft", "Windows", "Caches");
        if (Directory.Exists(cache)) Directory.Delete(cache);
        string windows = Path.Combine(temporary, "Microsoft", "Windows");
        if (Directory.Exists(windows)) Directory.Delete(windows);
        string microsoft = Path.Combine(temporary, "Microsoft");
        if (Directory.Exists(microsoft)) Directory.Delete(microsoft);
        Directory.Delete(temporary);
    }
}
Console.WriteLine("Meeting companion tests passed.");
