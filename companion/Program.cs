using System.Diagnostics;
using System.Text.Json;
using GimkitWebNotifications;

internal static class Program
{
    private const string Database = "https://gimkit-web-default-rtdb.asia-southeast1.firebasedatabase.app";
    private static readonly string StateDirectory = Path.Combine(
        Environment.GetEnvironmentVariable("LOCALAPPDATA") ??
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GimkitWebNotifications");
    private static readonly string StateFile = Path.Combine(StateDirectory, "state.json");
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(15) };

    private static async Task<int> Main()
    {
        if (!OperatingSystem.IsWindows())
        {
            Console.Error.WriteLine("This companion supports Windows only.");
            return 1;
        }
        try
        {
            var state = await LoadStateAsync();
            Console.WriteLine("Watching for meetings. Commands: check, last, help, quit.");
            using var cancellation = new CancellationTokenSource();
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; cancellation.Cancel(); };
            await CheckAsync(state);
            Task<string?>? input = Task.Run(() => Console.ReadLine());
            Task delay = Task.Delay(TimeSpan.FromSeconds(10), cancellation.Token);
            while (!cancellation.IsCancellationRequested)
            {
                Task finished = input is null ? await Task.WhenAny(delay) : await Task.WhenAny(input, delay);
                if (finished == delay)
                {
                    if (cancellation.IsCancellationRequested) break;
                    await CheckAsync(state);
                    delay = Task.Delay(TimeSpan.FromSeconds(10), cancellation.Token);
                    continue;
                }

                string? command = await input!;
                switch (command?.Trim().ToLowerInvariant())
                {
                    case null: break;
                    case "check":
                        await CheckAsync(state);
                        delay = Task.Delay(TimeSpan.FromSeconds(10), cancellation.Token);
                        break;
                    case "last":
                        Console.WriteLine(state.LastAttemptedAt is long attempt
                            ? $"Last check attempted: {DateTimeOffset.FromUnixTimeMilliseconds(attempt).ToLocalTime():F}"
                            : "No check attempted yet.");
                        Console.WriteLine(state.LastCheckedAt is long time
                            ? $"Last successful check: {DateTimeOffset.FromUnixTimeMilliseconds(time).ToLocalTime():F}"
                            : "No successful check yet.");
                        break;
                    case "help":
                        Console.WriteLine("check: check now | last: check times | quit: exit");
                        break;
                    case "quit": return 0;
                    case "": break;
                    default: Console.WriteLine("Unknown command. Type help for commands."); break;
                }
                input = command is null ? null : Task.Run(() => Console.ReadLine());
            }
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }

    private static async Task<MeetingState> LoadStateAsync()
    {
        if (!File.Exists(StateFile)) return new MeetingState();
        var state = JsonSerializer.Deserialize<MeetingState>(await File.ReadAllTextAsync(StateFile), MeetingEngine.JsonOptions);
        if (state is null || state.Version != 1 ||
            state.SeenActive is null || state.NotifiedScheduled is null || state.Scheduled is null ||
            state.Scheduled.Values.Any(item => item is null || item.Title is null))
            throw new InvalidDataException($"Invalid state file: {StateFile}");
        return state;
    }

    private static async Task SaveStateAsync(MeetingState state)
    {
        try
        {
            Directory.CreateDirectory(StateDirectory);
            string temporary = StateFile + ".tmp";
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(state, MeetingEngine.JsonOptions));
            File.Move(temporary, StateFile, overwrite: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new StateSaveException($"Could not save notification state: {error.Message}", error);
        }
    }

    private static async Task CheckAsync(MeetingState state)
    {
        try
        {
            state.LastAttemptedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            await SaveStateAsync(state);
            var activeTask = Client.GetStringAsync($"{Database}/activeMeetings.json");
            var scheduledTask = Client.GetStringAsync($"{Database}/scheduledMeetings.json");
            await Task.WhenAll(activeTask, scheduledTask);
            var active = MeetingEngine.ParseMeetings(await activeTask);
            var scheduled = MeetingEngine.ParseMeetings(await scheduledTask);
            await MeetingEngine.ProcessAsync(state, active, scheduled, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                NotifyAsync, SaveStateAsync);
            state.LastCheckedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            await SaveStateAsync(state);
            Console.WriteLine("Meeting check completed.");
        }
        catch (StateSaveException) { throw; }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException or
                                      InvalidDataException or NotificationException)
        {
            Console.Error.WriteLine($"Notification check failed; retrying: {error.Message}");
        }
    }

    private static async Task NotifyAsync(string title)
    {
        var start = new ProcessStartInfo("powershell.exe")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true
        };
        foreach (string argument in new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                     "-File", Path.Combine(AppContext.BaseDirectory, "notify.ps1") })
            start.ArgumentList.Add(argument);
        start.Environment["GIMKIT_MEETING_TITLE"] = title;
        try
        {
            using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start PowerShell.");
            Task<string> errors = process.StandardError.ReadToEndAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            try { await process.WaitForExitAsync(timeout.Token); }
            catch (OperationCanceledException)
            {
                process.Kill(entireProcessTree: true);
                throw new NotificationException("Windows notification timed out.");
            }
            if (process.ExitCode != 0) throw new NotificationException($"Windows notification failed: {await errors}");
            Console.WriteLine($"Notification sent: {title}");
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            throw new NotificationException($"Could not start Windows notification: {error.Message}", error);
        }
    }

    private sealed class StateSaveException(string message, Exception inner) : Exception(message, inner);
    private sealed class NotificationException(string message, Exception? inner = null) : Exception(message, inner);
}
