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
Console.WriteLine("Meeting companion tests passed.");
