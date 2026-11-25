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
    private static readonly string LockFile = Path.Combine(StateDirectory, "check.lock");
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(15) };

    private static async Task<int> Main(string[] args)
    {
        if (!OperatingSystem.IsWindows())
        {
            Console.Error.WriteLine("This companion supports Windows only.");
            return 1;
        }
        try
        {
            using var cancellation = new CancellationTokenSource();
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; cancellation.Cancel(); };
            if (args.Length > 1)
            {
                PrintHelp();
                return 2;
            }
            switch (args.Length == 0 ? "watch" : args[0].ToLowerInvariant())
            {
                case "check":
                    return await CheckAsync(cancellation.Token) ? 0 : 1;
                case "last":
                    PrintLast(await LoadStateAsync());
                    return 0;
                case "help":
                case "--help":
                case "-h":
                    PrintHelp();
                    return 0;
                case "watch":
                    break;
                default:
                    Console.Error.WriteLine($"Unknown command: {args[0]}");
                    PrintHelp();
                    return 2;
            }

            Console.WriteLine("Watching for meetings. Commands: check, last, help, quit.");
            await CheckAsync(cancellation.Token);
            Task<string?>? input = Task.Run(() => Console.ReadLine());
            Task delay = Task.Delay(TimeSpan.FromSeconds(10), cancellation.Token);
            while (!cancellation.IsCancellationRequested)
            {
                Task finished = input is null ? await Task.WhenAny(delay) : await Task.WhenAny(input, delay);
                if (finished == delay)
                {
                    if (cancellation.IsCancellationRequested) break;
                    await CheckAsync(cancellation.Token);
                    delay = Task.Delay(TimeSpan.FromSeconds(10), cancellation.Token);
                    continue;
                }

                string? command = await input!;
                switch (command?.Trim().ToLowerInvariant())
                {
                    case null: break;
                    case "check":
                        await CheckAsync(cancellation.Token);
                        delay = Task.Delay(TimeSpan.FromSeconds(10), cancellation.Token);
                        break;
                    case "last":
                        PrintLast(await LoadStateAsync());
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

    private static void PrintHelp() =>
        Console.WriteLine("Usage: gimkitapp [watch|check|last|help]\n" +
                          "watch: continuously monitor meetings (default) | check: check now | last: check times");

    private static void PrintLast(MeetingState state)
    {
        Console.WriteLine(state.LastAttemptedAt is long attempt
            ? $"Last check attempted: {DateTimeOffset.FromUnixTimeMilliseconds(attempt).ToLocalTime():F}"
            : "No check attempted yet.");
        Console.WriteLine(state.LastCheckedAt is long time
            ? $"Last successful check: {DateTimeOffset.FromUnixTimeMilliseconds(time).ToLocalTime():F}"
            : "No successful check yet.");
    }

    private static async Task<MeetingState> LoadStateAsync()
    {
        if (!File.Exists(StateFile)) return new MeetingState();
        await using var file = new FileStream(StateFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var state = await JsonSerializer.DeserializeAsync<MeetingState>(file, MeetingEngine.JsonOptions);
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

    private static async Task<FileStream> AcquireCheckLockAsync(CancellationToken cancellation)
    {
        Directory.CreateDirectory(StateDirectory);
        while (true)
        {
            cancellation.ThrowIfCancellationRequested();
            try
            {
                return new FileStream(LockFile, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            }
            catch (IOException error) when ((error.HResult & 0xffff) is 32 or 33)
            {
                await Task.Delay(250, cancellation);
            }
        }
    }

    private static async Task<bool> CheckAsync(CancellationToken cancellation)
    {
        await using var checkLock = await AcquireCheckLockAsync(cancellation);
        try
        {
            var state = await LoadStateAsync();
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
            return true;
        }
        catch (StateSaveException) { throw; }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException or
                                      InvalidDataException or NotificationException)
        {
            Console.Error.WriteLine($"Notification check failed: {error.Message}");
            return false;
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
