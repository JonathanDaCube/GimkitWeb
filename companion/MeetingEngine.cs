using System.Text.Json;
using System.Text.Json.Serialization;

namespace GimkitWebNotifications;

public sealed class MeetingState
{
    public int Version { get; set; } = 1;
    public long? StartedAt { get; set; }
    public long? LastAttemptedAt { get; set; }
    public long? LastCheckedAt { get; set; }
    public Dictionary<string, bool> SeenActive { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, bool> NotifiedScheduled { get; set; } = new(StringComparer.Ordinal);
    public Dictionary<string, ScheduledMeeting> Scheduled { get; set; } = new(StringComparer.Ordinal);
}

public sealed class ScheduledMeeting
{
    public string Title { get; set; } = "";
    public long ScheduledAt { get; set; }
}

public sealed record Meeting(string Title, long? ScheduledAt, long? CreatedAt, string? ScheduledMeetingId);

public static class MeetingEngine
{
    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public static Dictionary<string, Meeting> ParseMeetings(string json)
    {
        using var document = JsonDocument.Parse(json);
        var result = new Dictionary<string, Meeting>(StringComparer.Ordinal);
        if (document.RootElement.ValueKind == JsonValueKind.Null) return result;
        if (document.RootElement.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Invalid meeting list received from Firebase.");
        foreach (var item in document.RootElement.EnumerateObject())
        {
            if (item.Value.ValueKind != JsonValueKind.Object) continue;
            string? title = StringProperty(item.Value, "title");
            if (string.IsNullOrWhiteSpace(title)) continue;
            result[item.Name] = new Meeting(title, NumberProperty(item.Value, "scheduledAt"),
                NumberProperty(item.Value, "createdAt"), StringProperty(item.Value, "scheduledMeetingId"));
        }
        return result;
    }

    private static string? StringProperty(JsonElement item, string name) =>
        item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static long? NumberProperty(JsonElement item, string name) =>
        item.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number &&
        value.TryGetInt64(out long number) ? number : null;

    public static async Task ProcessAsync(MeetingState state, Dictionary<string, Meeting> active,
        Dictionary<string, Meeting> scheduled, long now, Func<string, Task> notify, Func<MeetingState, Task> save,
        CancellationToken cancellation = default)
    {
        foreach (var (id, meeting) in scheduled)
        {
            if (meeting.ScheduledAt is long time)
                state.Scheduled[id] = new ScheduledMeeting { Title = meeting.Title, ScheduledAt = time };
        }

        if (state.StartedAt is null)
        {
            state.StartedAt = now;
            foreach (string id in active.Keys) state.SeenActive[id] = true;
            await save(state);
            return;
        }

        foreach (var (id, meeting) in active)
        {
            cancellation.ThrowIfCancellationRequested();
            if (state.SeenActive.ContainsKey(id)) continue;
            string? relatedId = FindScheduledId(meeting, state.Scheduled);
            if (relatedId is null || !state.NotifiedScheduled.ContainsKey(relatedId))
            {
                await notify(meeting.Title);
                if (relatedId is not null) state.NotifiedScheduled[relatedId] = true;
            }
            state.SeenActive[id] = true;
            await save(state);
        }

        foreach (var (id, meeting) in scheduled)
        {
            cancellation.ThrowIfCancellationRequested();
            if (meeting.ScheduledAt is not long time || time > now || state.NotifiedScheduled.ContainsKey(id))
                continue;
            if (time < state.StartedAt && !(meeting.CreatedAt >= state.StartedAt)) continue;
            await notify(meeting.Title);
            state.NotifiedScheduled[id] = true;
            await save(state);
        }
        await save(state);
    }

    private static string? FindScheduledId(Meeting meeting, Dictionary<string, ScheduledMeeting> scheduled)
    {
        if (!string.IsNullOrEmpty(meeting.ScheduledMeetingId)) return meeting.ScheduledMeetingId;
        if (meeting.ScheduledAt is null) return null;
        var matches = scheduled.Where(entry =>
            entry.Value.Title == meeting.Title && entry.Value.ScheduledAt == meeting.ScheduledAt).Take(2).ToArray();
        return matches.Length == 1 ? matches[0].Key : null;
    }
}
