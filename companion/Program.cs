using System.Diagnostics;
using System.Text.Json;
using GimkitWebNotifications;
using Microsoft.Win32;

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
            switch (args.Length == 0 ? "welcome" : args[0].ToLowerInvariant())
            {
                case "welcome":
                    Console.WriteLine("Welcome to the GimkitWeb meeting companion.");
                    Console.WriteLine("It checks for meetings in the background and shows Windows notifications.");
                    await BackgroundChecker.StartAsync(restart: true);
                    using (var runKey = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run"))
                    {
                        bool added = BackgroundChecker.EnsureStartup(runKey, BackgroundChecker.Executable);
                        Console.WriteLine(added ? "Registered to start when you sign in." : "Already registered to start when you sign in.");
                    }
                    Console.WriteLine("Use gimkitapp query, start, stop, restart, check, or last from a console.");
                    if (!Console.IsInputRedirected)
                    {
                        Console.WriteLine("Press Enter to close this window.");
                        Console.ReadLine();
                    }
                    return 0;
                case "--background":
                    await BackgroundChecker.RunAsync(async stopToken =>
                    {
                        string? failure = null;
                        await CheckAsync(stopToken, reportSuccess: false, onFailure: error => failure = error);
                        return failure;
                    });
                    return 0;
                case "start":
                    await BackgroundChecker.StartAsync(restart: false);
                    return 0;
                case "stop":
                    await BackgroundChecker.StopAsync();
                    return 0;
                case "restart":
                    await BackgroundChecker.StartAsync(restart: true);
                    return 0;
                case "query":
                    var status = await BackgroundChecker.QueryAsync();
                    Console.WriteLine(status is null ? "Background checker: stopped." :
                        $"Background checker: {status.State}{(status.Error is null ? "." : $": {status.Error}")}");
                    return status?.State == "error" ? 1 : 0;
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
                default:
                    Console.Error.WriteLine($"Unknown command: {args[0]}");
                    PrintHelp();
                    return 2;
            }

        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            if (args.Length == 0 && !Console.IsInputRedirected)
            {
                Console.WriteLine("Press Enter to close this window.");
                Console.ReadLine();
            }
            return 1;
        }
    }

    private static void PrintHelp() =>
        Console.WriteLine("Usage: gimkitapp [start|stop|restart|query|check|last|help]\n" +
                          "No arguments: welcome, restart checker, and register it at sign-in.\n" +
                          "start/stop/restart: control the background checker | query: checker status\n" +
                          "check: check now | last: check times");

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

    private static async Task<bool> CheckAsync(CancellationToken cancellation, bool reportSuccess = true, Action<string>? onFailure = null)
    {
        await using var checkLock = await AcquireCheckLockAsync(cancellation);
        try
        {
            var state = await LoadStateAsync();
            state.LastAttemptedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            await SaveStateAsync(state);
            var activeTask = Client.GetStringAsync($"{Database}/activeMeetings.json", cancellation);
            var scheduledTask = Client.GetStringAsync($"{Database}/scheduledMeetings.json", cancellation);
            await Task.WhenAll(activeTask, scheduledTask);
            var active = MeetingEngine.ParseMeetings(await activeTask);
            var scheduled = MeetingEngine.ParseMeetings(await scheduledTask);
            await MeetingEngine.ProcessAsync(state, active, scheduled, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                title => NotifyAsync(title, reportSuccess), SaveStateAsync, cancellation);
            state.LastCheckedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            await SaveStateAsync(state);
            if (reportSuccess) Console.WriteLine("Meeting check completed.");
            return true;
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { throw; }
        catch (StateSaveException) { throw; }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or JsonException or
                                      InvalidDataException or NotificationException)
        {
            if (reportSuccess) Console.Error.WriteLine($"Notification check failed: {error.Message}");
            onFailure?.Invoke(error.Message);
            return false;
        }
    }

    private static async Task NotifyAsync(string title, bool reportSuccess)
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
            if (reportSuccess) Console.WriteLine($"Notification sent: {title}");
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            throw new NotificationException($"Could not start Windows notification: {error.Message}", error);
        }
    }

    private sealed class StateSaveException(string message, Exception inner) : Exception(message, inner);
    private sealed class NotificationException(string message, Exception? inner = null) : Exception(message, inner);
}
