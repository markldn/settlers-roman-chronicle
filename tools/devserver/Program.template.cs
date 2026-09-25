// Local stand-in for the genhttp.dev platform: hosts server/lambda.cs the way the platform does.
// Generated into .dev-server/ by tools/dev-server.mjs; the snippet goes into Entry.BuildAsync below.
using System.Runtime.InteropServices;

var built = await Entry.BuildAsync();

var handler = built switch
{
    IHandler ready => ready,
    IHandlerBuilder builder => builder.Build(),
    _ => throw new InvalidOperationException("The snippet returned nothing to serve.")
};

var port = ushort.Parse(System.Environment.GetEnvironmentVariable("PORT") ?? "8961");

var host = GenHTTP.Engine.Ioxide.Host.Create().Handler(handler).Defaults().Port(port);

await host.StartAsync();

Console.WriteLine($"Listening on http://localhost:{port}/");

var shutdown = new TaskCompletionSource();

void Stop(PosixSignalContext context)
{
    context.Cancel = true;
    shutdown.TrySetResult();
}

using (PosixSignalRegistration.Create(PosixSignal.SIGTERM, Stop))
using (PosixSignalRegistration.Create(PosixSignal.SIGINT, Stop))
{
    await shutdown.Task;
}

await host.StopAsync();

static class Entry
{
    private static Folder Workspace => Lambda.Workspace;
    private static Folder Assets => Lambda.Assets;

    internal static async Task<object> BuildAsync()
    {
        await Task.CompletedTask;
/*LAMBDA*/
    }
}
