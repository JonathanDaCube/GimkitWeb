using System.Diagnostics;
using System.Text.Json;
using GimkitWebNotifications;

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
    }
    finally
    {
        File.Delete(stateFile);
        File.Delete(lockFile);
        Directory.Delete(stateDir);
        Directory.Delete(temporary);
    }
}
Console.WriteLine("Meeting companion tests passed.");
