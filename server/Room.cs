// A room: players sitting together before the game, then the game they play. The server never
// simulates the game itself. It keeps the clock: every 100 ms it closes a turn with the commands
// that arrived since the last one and sends it to every player, whose browsers all apply the same
// commands at the same tick (lockstep). What it keeps besides is what a player needs to get back in:
// the turns since the last snapshot, and the last few snapshots themselves.

public sealed class Seat
{
    public string Id { get; init; }

    public string Token { get; init; }

    public string Name { get; set; }

    public string Nation { get; set; } = "romans";

    public int Team { get; set; }

    public bool Ready { get; set; }

    public int Slot { get; set; } = -1;

    public Client Client { get; set; }

    /// <summary>Left the game for good; the computer plays their realm from now on.</summary>
    public bool Left { get; set; }

    /// <summary>The computer is playing this realm right now.</summary>
    public bool Ai { get; set; }

    public DateTime? DroppedAt { get; set; }

    public bool Connected => Client is { Closed: false };
}

public sealed class Room
{
    public const int MaxSeats = 6;

    public const int TurnMs = 100;

    // simulation ticks per turn for each speed: 0.5x, 1x, 2x, 4x, 8x of 20 ticks a second
    public static readonly int[] TicksPerTurn = [1, 2, 4, 8, 16];

    public string Id { get; init; }

    public string Name { get; set; }

    public Seat Host { get; set; }

    public List<Seat> Seats { get; } = [];

    public JsonElement? Settings { get; set; }

    /// <summary>"lobby" while players gather, "playing" once the host started.</summary>
    public string State { get; set; } = "lobby";

    public List<ChatLine> Chat { get; } = [];

    public int Seed { get; set; }

    public int Turn { get; set; }

    public int Speed { get; set; } = 1;

    public bool Paused { get; set; }

    public List<TurnCmd> Queue { get; set; } = [];

    /// <summary>Every turn after <see cref="SnapTurn"/>: a snapshot plus these is the whole game.</summary>
    public List<TurnMsg> History { get; } = [];

    public SortedDictionary<int, byte[]> Snapshots { get; } = [];

    /// <summary>The turn of the newest snapshot, 0 while there is none (the game is then built from its setup).</summary>
    public int SnapTurn { get; set; }

    public bool SnapPending { get; set; }

    public DateTime SnapAskedAt { get; set; }

    public HashSet<Seat> SnapTargets { get; } = [];

    public string SnapReason { get; set; }

    public Dictionary<int, Dictionary<int, long>> Hashes { get; } = [];

    public DateTime LastResync { get; set; } = DateTime.MinValue;

    /// <summary>Hashes of turns up to here predate the last resync and mean nothing any more.</summary>
    public int HashFloor { get; set; }

    public DateTime? EmptySince { get; set; }

    public CancellationTokenSource Loop { get; set; }

    public int Resyncs { get; set; }

    public IEnumerable<Seat> Present => Seats.Where(s => s.Connected && !s.Left);

    public RoomInfo Info() => new(Id, Name, Host?.Name ?? "", Seats.Count(s => !s.Left), MaxSeats, State, Settings);

    public RoomState Describe() => new(Id, Name, Host?.Id, State,
        Seats.Where(s => !s.Left || State == "playing")
             .Select(s => new SeatInfo(s.Id, s.Name, s.Nation, s.Team, s.Ready, s.Connected, s.Ai, s.Left, s.Slot)).ToList(),
        Settings, MaxSeats);

    public void Broadcast(object message)
    {
        foreach (var seat in Present)
        {
            seat.Client.Send(message);
        }
    }

    public void AddChat(ChatLine line)
    {
        Chat.Add(line);
        if (Chat.Count > 80) Chat.RemoveAt(0);
        Broadcast(new ChatMsg("room", line));
    }

    public void Notice(string text) => AddChat(new ChatLine("", text, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), true));

    /// <summary>
    /// Whoever answers for the game: the host while connected, or else the next player still here -
    /// who then becomes host (pause and speed are theirs to set).
    /// </summary>
    public Seat Authority()
    {
        if (Host is { Connected: true, Left: false }) return Host;
        var next = Present.OrderBy(s => s.Slot).FirstOrDefault();
        if (next != null) Host = next;
        return next;
    }

    public void Inject(SysCmd command, JsonSerializerOptions json)
    {
        Queue.Add(new TurnCmd(-1, 0, JsonSerializer.SerializeToElement(command, json)));
    }

    /// <summary>Closes the current turn and sends it out. Called by the room's clock.</summary>
    public TurnMsg Step()
    {
        Turn++;
        var turn = new TurnMsg(Turn, Paused ? 0 : TicksPerTurn[Speed], Queue);
        Queue = [];
        History.Add(turn);
        Broadcast(turn);
        return turn;
    }

    public void StoreSnapshot(int turn, byte[] bytes)
    {
        Snapshots[turn] = bytes;
        while (Snapshots.Count > 3) Snapshots.Remove(Snapshots.Keys.First());
        SnapTurn = turn;
        History.RemoveAll(t => t.N <= turn);
    }

    /// <summary>Tells players to load the newest snapshot there is (or to build from setup) and replay since.</summary>
    public void SendStored(IEnumerable<Seat> targets, string reason)
    {
        var message = new SnapMsg(SnapTurn, History.ToList(), reason);
        foreach (var seat in targets.Where(s => s.Connected))
        {
            seat.Client.Send(message);
        }
    }

    public int SettingsSeed()
    {
        if (Settings is { ValueKind: JsonValueKind.Object } s && s.TryGetProperty("seed", out var seed) && seed.TryGetInt32(out var value) && value > 0)
        {
            return value;
        }
        return Random.Shared.Next(1, 99999);
    }
}
