using System.Diagnostics;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Runtime.Versioning;
using Microsoft.Win32;

namespace GimkitWebNotifications;

internal sealed record CheckerStatus(string State, string? Error = null);

internal static class BackgroundChecker
{
    private static readonly string StateDirectory = Path.Combine(
        Environment.GetEnvironmentVariable("LOCALAPPDATA") ??
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GimkitWebNotifications");
    private static readonly string ControlLock = Path.Combine(StateDirectory, "control.lock");
    private static readonly string WorkerLock = Path.Combine(StateDirectory, "worker.lock");
    private static readonly string PipeName = "GimkitWeb-" + Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(StateDirectory).ToUpperInvariant())))[..24];
    internal static string Executable => Path.Combine(AppContext.BaseDirectory, "gimkitapp.exe");

    internal static async Task<CheckerStatus?> QueryAsync()
    {
        return await SendAsync("query", 500);
    }

    private static async Task<CheckerStatus?> SendAsync(string command, int timeoutMilliseconds)
    {
        using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        try { await pipe.ConnectAsync(timeoutMilliseconds); }
        catch (TimeoutException) { return null; }
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(command == "stop" ? 120 : 5));
        using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
        using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);
        await writer.WriteLineAsync(command.AsMemory(), timeout.Token);
        string? response = await reader.ReadLineAsync(timeout.Token);
        return JsonSerializer.Deserialize<CheckerStatus>(response ?? throw new IOException("Checker closed the connection."))
            ?? throw new InvalidDataException("Invalid checker response.");
    }

    private static async Task<FileStream> AcquireAsync(string path)
    {
        Directory.CreateDirectory(StateDirectory);
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (true)
        {
            try { return new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
            catch (IOException error) when ((error.HResult & 0xffff) is 32 or 33 && DateTime.UtcNow < deadline)
            {
                await Task.Delay(100);
            }
        }
    }

    internal static async Task StartAsync(bool restart)
    {
        await using var control = await AcquireAsync(ControlLock);
        var existing = await QueryAsync();
        if (existing is not null)
        {
            if (!restart)
            {
                Console.WriteLine("Background checker is already running.");
                return;
            }
            await StopWorkerAsync();
        }

        if (!File.Exists(Executable)) throw new FileNotFoundException("Cannot find the companion executable.", Executable);
        var start = new ProcessStartInfo(Executable)
        {
            UseShellExecute = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = AppContext.BaseDirectory
        };
        start.ArgumentList.Add("--background");
        using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start the background checker.");
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (DateTime.UtcNow < deadline)
        {
            if (await QueryAsync() is not null)
            {
                Console.WriteLine("Background checker started.");
                return;
            }
            if (process.HasExited)
                throw new InvalidOperationException($"Background checker exited with code {process.ExitCode}.");
            await Task.Delay(100);
        }
        throw new TimeoutException("Background checker did not respond. Run gimkitapp query to check its status.");
    }

    internal static async Task StopAsync()
    {
        await using var control = await AcquireAsync(ControlLock);
        if (await QueryAsync() is null)
        {
            Console.WriteLine("Background checker is stopped.");
            return;
        }
        await StopWorkerAsync();
        Console.WriteLine("Background checker stopped.");
    }

    private static async Task StopWorkerAsync()
    {
        var result = await SendAsync("stop", 1000);
        if (result?.State != "stopped")
            throw new IOException("Could not stop the background checker.");
    }

    internal static async Task RunAsync(Func<CancellationToken, Task<string?>> check)
    {
        await using var worker = await AcquireAsync(WorkerLock);
        using var stopping = new CancellationTokenSource();
        CheckerStatus status = new("started");
        async Task PollAsync()
        {
            while (!stopping.IsCancellationRequested)
            {
                Volatile.Write(ref status, new CheckerStatus("started"));
                try
                {
                    string? error = await check(stopping.Token);
                    Volatile.Write(ref status, error is null ? new CheckerStatus("idle") : new CheckerStatus("error", error));
                }
                catch (OperationCanceledException) when (stopping.IsCancellationRequested) { break; }
                catch (Exception error)
                {
                    Volatile.Write(ref status, new CheckerStatus("error", error.Message));
                }
                try { await Task.Delay(TimeSpan.FromMinutes(1), stopping.Token); }
                catch (OperationCanceledException) when (stopping.IsCancellationRequested) { break; }
            }
        }

        Task polling = PollAsync();
        while (true)
        {
            using var pipe = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 1,
                PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            await pipe.WaitForConnectionAsync();
            using var reader = new StreamReader(pipe, Encoding.UTF8, leaveOpen: true);
            using var writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            try
            {
                string? command = await reader.ReadLineAsync(timeout.Token);
                if (command == "stop")
                {
                    stopping.Cancel();
                    await polling;
                    await worker.DisposeAsync();
                    await writer.WriteLineAsync(JsonSerializer.Serialize(new CheckerStatus("stopped")));
                    break;
                }
                await writer.WriteLineAsync(JsonSerializer.Serialize(
                    command == "query" ? Volatile.Read(ref status) : new CheckerStatus("error", "Unknown command.")));
            }
            catch (OperationCanceledException) when (timeout.IsCancellationRequested) { }
            catch (IOException error)
            {
                if (stopping.IsCancellationRequested) break;
                Volatile.Write(ref status, new CheckerStatus("error", $"Control connection failed: {error.Message}"));
            }
        }
    }

    [SupportedOSPlatform("windows")]
    internal static bool EnsureStartup(RegistryKey runKey, string executable)
    {
        string command = $"\"{executable}\" start";
        const string name = "GimkitWebNotifications";
        if (string.Equals(runKey.GetValue(name) as string, command, StringComparison.OrdinalIgnoreCase)) return false;
        runKey.SetValue(name, command, RegistryValueKind.String);
        return true;
    }
}
