// One browser tab. Everything sent to it goes through an ordered outbox that a single task drains,
// so messages arrive in exactly the order the hub queued them (a turn can never overtake the
// snapshot notice before it), and no two writes ever hit the socket at once.

using System.Threading.Channels;

public sealed class Client
{
    private readonly IReactiveConnection _connection;

    private readonly Channel<object> _outbox = Channel.CreateBounded<object>(new BoundedChannelOptions(4000)
    {
        SingleReader = true,
        FullMode = BoundedChannelFullMode.DropWrite
    });

    private bool _closeSocket = true;

    private double _allowance = 40;

    private DateTime _lastCheck = DateTime.UtcNow;

    public Client(IReactiveConnection connection, string id)
    {
        _connection = connection;
        Id = id;
        _ = Task.Run(PumpAsync);
    }

    public string Id { get; }

    public string Name { get; set; }

    public string Token { get; set; }

    public Room Room { get; set; }

    public Seat Seat { get; set; }

    public DateTime LastChat { get; set; } = DateTime.MinValue;

    public bool Closed { get; private set; }

    /// <summary>Queues a message; never blocks. Call under the hub lock to keep a global order.</summary>
    public void Send(object message)
    {
        if (!Closed && !_outbox.Writer.TryWrite(message))
        {
            // a tab that stopped reading: let it reconnect and catch up properly
            Close();
        }
    }

    /// <summary>Stops sending. The socket is closed too, unless the browser already closed it.</summary>
    public void Close(bool closeSocket = true)
    {
        if (Closed) return;
        Closed = true;
        _closeSocket = closeSocket;
        _outbox.Writer.TryComplete();
    }

    /// <summary>A token bucket: 40 messages at once, 25 a second after that.</summary>
    public bool Allow()
    {
        var now = DateTime.UtcNow;
        _allowance = Math.Min(40, _allowance + (now - _lastCheck).TotalSeconds * 25);
        _lastCheck = now;
        if (_allowance < 1) return false;
        _allowance -= 1;
        return true;
    }

    private async Task PumpAsync()
    {
        try
        {
            await foreach (var message in _outbox.Reader.ReadAllAsync())
            {
                await _connection.WritePayloadAsync(message);
            }
        }
        catch (Exception)
        {
            // the socket is gone; OnClose cleans up
        }

        if (!_closeSocket) return;

        try
        {
            await _connection.CloseAsync();
        }
        catch (Exception)
        {
        }
    }
}
