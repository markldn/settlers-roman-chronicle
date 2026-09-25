// The websocket handler behind the lobby, the rooms, the chat and the turn clock. One instance
// serves every socket. All shared state is changed under one lock, and nothing under the lock ever
// waits: a Client only queues what it is given and writes it out on its own task.

using System.Security.Cryptography;

public sealed class Hub : IReactiveHandler
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static readonly string[] Nations = ["romans", "vikings", "nubians", "japanese"];

    private readonly object _lock = new();

    private readonly Dictionary<IReactiveConnection, Client> _clients = [];

    private readonly Dictionary<string, Room> _rooms = [];

    private readonly List<ChatLine> _lobbyChat = [];

    private int _nextId;

    // ------------------------------------------------------------------ sockets

    public ValueTask OnConnected(IReactiveConnection connection)
    {
        lock (_lock)
        {
            _clients[connection] = new Client(connection, "c" + (++_nextId).ToString(CultureInfo.InvariantCulture));
        }
        return ValueTask.CompletedTask;
    }

    public async ValueTask OnMessage(IReactiveConnection connection, IWebsocketFrame frame)
    {
        Incoming message;

        try
        {
            message = await frame.ReadPayloadAsync<Incoming>();
        }
        catch (Exception e)
        {
            Console.WriteLine($"unreadable frame: {e.Message}");
            return;
        }

        if (message?.Type == null) return;

        lock (_lock)
        {
            if (!_clients.TryGetValue(connection, out var client) || !client.Allow()) return;

            try
            {
                Handle(client, message);
            }
            catch (Exception e)
            {
                Console.WriteLine($"error handling {message.Type}: {e}");
            }
        }
    }

    public ValueTask OnClose(IReactiveConnection connection, IWebsocketFrame frame)
    {
        lock (_lock)
        {
            if (_clients.Remove(connection, out var client))
            {
                client.Close(false);
                Disconnected(client);
                BroadcastLobby();
            }
        }
        return ValueTask.CompletedTask;
    }

    private void Handle(Client client, Incoming m)
    {
        if (m.Type == "hello")
        {
            Hello(client, m);
            return;
        }

        if (client.Name == null) return; // everything else needs a hello first

        switch (m.Type)
        {
            case "ping": client.Send(new Pong()); break;
            case "name": Rename(client, m.Name); break;
            case "chat": Chat(client, m.Text); break;
            case "create": Create(client, m.Name); break;
            case "join": Join(client, m.Room); break;
            case "leave": Leave(client, true); break;
            case "seat": SeatChange(client, m); break;
            case "settings": SettingsChange(client, m.Settings); break;
            case "kick": Kick(client, m.Id); break;
            case "start": Start(client); break;
            case "cmd": Command(client, m.I ?? 0, m.C); break;
            case "speed": SpeedChange(client, m.Speed, m.Paused); break;
            case "hash": Hash(client, m.N ?? -1, m.H ?? 0); break;
        }
    }

    // ------------------------------------------------------------------ identity

    private void Hello(Client client, Incoming m)
    {
        if (client.Name != null) return;

        client.Name = CleanName(m.Name);
        client.Token = m.Token is { Length: 32 } t && t.All(Uri.IsHexDigit) ? t : Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

        client.Send(new Welcome(new Person(client.Id, client.Name), client.Token, Online()));

        // a player coming back to a game that is still running gets their seat back
        var (room, seat) = FindSeat(client.Token);

        if (room != null)
        {
            Rejoin(client, room, seat, m.Turn);
        }
        else
        {
            client.Send(new ChatLog("lobby", _lobbyChat.ToList()));
        }

        BroadcastLobby();
    }

    private (Room, Seat) FindSeat(string token)
    {
        foreach (var room in _rooms.Values.Where(r => r.State == "playing"))
        {
            var seat = room.Seats.FirstOrDefault(s => s.Token == token && !s.Left);
            if (seat != null) return (room, seat);
        }
        return (null, null);
    }

    private void Rejoin(Client client, Room room, Seat seat, int? turn)
    {
        if (seat.Client != null && seat.Client != client)
        {
            seat.Client.Seat = null;
            seat.Client.Room = null;
            seat.Client.Close();
        }

        seat.Client = client;
        seat.DroppedAt = null;
        seat.Name = client.Name;
        client.Room = room;
        client.Seat = seat;

        if (seat.Ai)
        {
            seat.Ai = false;
            room.Inject(new SysCmd("ai", seat.Slot, null), Json);
        }

        room.Authority();
        room.Broadcast(new RoomMsg(room.Describe()));
        client.Send(new ChatLog("room", room.Chat.ToList()));
        room.Notice($"{seat.Name} is back.");

        if (turn is int have && have >= room.SnapTurn && have <= room.Turn)
        {
            // the page still has its game and only missed a few turns
            client.Send(new TurnsMsg(room.History.Where(t => t.N > have).ToList()));
        }
        else
        {
            client.Send(StartFor(room, seat, true));
            RequestSnapshot(room, "join", [seat]);
        }
    }

    private void Rename(Client client, string name)
    {
        client.Name = CleanName(name);
        if (client.Seat != null)
        {
            client.Seat.Name = client.Name;
            client.Room.Broadcast(new RoomMsg(client.Room.Describe()));
        }
        BroadcastLobby();
    }

    private void Disconnected(Client client)
    {
        var room = client.Room;
        var seat = client.Seat;

        if (room == null || seat == null || seat.Client != client) return;

        if (room.State == "lobby")
        {
            Leave(client, false);
            return;
        }

        seat.Client = null;
        seat.DroppedAt = DateTime.UtcNow;
        room.Authority();
        room.Notice($"{seat.Name} lost the connection.");
        room.Broadcast(new RoomMsg(room.Describe()));
    }

    // ------------------------------------------------------------------ chat

    private void Chat(Client client, string text)
    {
        text = (text ?? "").Trim();
        if (text.Length == 0) return;
        if (text.Length > 300) text = text[..300];
        text = new string(text.Where(c => !char.IsControl(c)).ToArray());

        var now = DateTime.UtcNow;
        if ((now - client.LastChat).TotalMilliseconds < 350) return;
        client.LastChat = now;

        var line = new ChatLine(client.Name, text, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), false);

        if (client.Room != null)
        {
            client.Room.AddChat(line);
            return;
        }

        _lobbyChat.Add(line);
        if (_lobbyChat.Count > 80) _lobbyChat.RemoveAt(0);

        foreach (var other in InLobby())
        {
            other.Send(new ChatMsg("lobby", line));
        }
    }

    private void LobbyNotice(string text)
    {
        var line = new ChatLine("", text, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), true);
        _lobbyChat.Add(line);
        if (_lobbyChat.Count > 80) _lobbyChat.RemoveAt(0);
        foreach (var other in InLobby()) other.Send(new ChatMsg("lobby", line));
    }

    // ------------------------------------------------------------------ rooms

    private void Create(Client client, string name)
    {
        if (client.Room != null) Leave(client, true);

        if (_rooms.Count >= 40)
        {
            client.Send(new ErrorMsg("There are too many rooms open right now. Join one of them, or try again later."));
            return;
        }

        name = Clean(name, 32);
        if (name.Length == 0) name = $"{client.Name}'s game";

        var room = new Room { Id = Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant(), Name = name };
        _rooms[room.Id] = room;

        Sit(client, room);
        room.Host = client.Seat;
        room.Notice($"{client.Name} opened the room.");
        room.Broadcast(new RoomMsg(room.Describe()));
        LobbyNotice($"{client.Name} opened a new game: {name}");
        BroadcastLobby();
    }

    private void Join(Client client, string id)
    {
        if (id == null || !_rooms.TryGetValue(id, out var room))
        {
            client.Send(new ErrorMsg("That game is gone."));
            BroadcastLobby();
            return;
        }

        if (client.Room == room) return;

        if (room.State != "lobby")
        {
            client.Send(new ErrorMsg("That game has already started."));
            return;
        }

        if (room.Seats.Count >= Room.MaxSeats)
        {
            client.Send(new ErrorMsg("That game is full."));
            return;
        }

        if (client.Room != null) Leave(client, true);

        Sit(client, room);
        room.Notice($"{client.Name} joined.");
        room.Broadcast(new RoomMsg(room.Describe()));
        BroadcastLobby();
    }

    private void Sit(Client client, Room room)
    {
        var taken = room.Seats.Select(s => s.Nation).ToHashSet();
        var seat = new Seat
        {
            Id = client.Id,
            Token = client.Token,
            Name = client.Name,
            Client = client,
            Nation = Nations.FirstOrDefault(n => !taken.Contains(n)) ?? "romans"
        };
        room.Seats.Add(seat);
        client.Room = room;
        client.Seat = seat;
        client.Send(new ChatLog("room", room.Chat.ToList()));
    }

    private void Leave(Client client, bool told)
    {
        var room = client.Room;
        var seat = client.Seat;

        client.Room = null;
        client.Seat = null;

        if (told)
        {
            client.Send(new LeftMsg("left"));
            client.Send(new ChatLog("lobby", _lobbyChat.ToList()));
        }

        if (room == null || seat == null) return;

        if (room.State == "lobby")
        {
            room.Seats.Remove(seat);
            room.Notice($"{seat.Name} left.");
        }
        else
        {
            seat.Left = true;
            seat.Client = null;
            if (!seat.Ai)
            {
                seat.Ai = true;
                room.Inject(new SysCmd("ai", seat.Slot, "normal"), Json);
            }
            room.Notice($"{seat.Name} left the game. A steward will run their realm.");
        }

        if (room.Host == seat) room.Host = null;

        // a room nobody sits in any more closes; a game whose players are only away waits for them (see Tick)
        if (room.Seats.All(s => s.Left))
        {
            Close(room);
        }
        else
        {
            if (room.Host == null) room.Host = room.State == "lobby" ? room.Seats[0] : room.Authority();
            room.Authority();
            room.Broadcast(new RoomMsg(room.Describe()));
        }

        BroadcastLobby();
    }

    private void Close(Room room)
    {
        _rooms.Remove(room.Id);
        room.Loop?.Cancel();
        foreach (var seat in room.Seats.Where(s => s.Connected))
        {
            seat.Client.Room = null;
            seat.Client.Seat = null;
            seat.Client.Send(new LeftMsg("closed"));
        }
    }

    private void SeatChange(Client client, Incoming m)
    {
        var room = client.Room;
        var seat = client.Seat;
        if (room == null || seat == null || room.State != "lobby") return;

        if (m.Nation != null && Nations.Contains(m.Nation)) seat.Nation = m.Nation;
        if (m.Team is int team && team >= 0 && team <= 4) seat.Team = team;
        if (m.Ready is bool ready) seat.Ready = ready;

        room.Broadcast(new RoomMsg(room.Describe()));
    }

    private void SettingsChange(Client client, JsonElement? settings)
    {
        var room = client.Room;
        if (room == null || room.Host != client.Seat || room.State != "lobby") return;
        if (settings is not { ValueKind: JsonValueKind.Object } value || value.GetRawText().Length > 2000) return;

        room.Settings = value;
        room.Broadcast(new RoomMsg(room.Describe()));
        BroadcastLobby();
    }

    private void Kick(Client client, string id)
    {
        var room = client.Room;
        if (room == null || room.Host != client.Seat || room.State != "lobby") return;

        var seat = room.Seats.FirstOrDefault(s => s.Id == id && s != client.Seat);
        if (seat?.Client == null) return;

        var kicked = seat.Client;
        Leave(kicked, false);
        kicked.Send(new LeftMsg("kicked"));
        kicked.Send(new ChatLog("lobby", _lobbyChat.ToList()));
        BroadcastLobby();
    }

    // ------------------------------------------------------------------ the game

    private void Start(Client client)
    {
        var room = client.Room;
        if (room == null || room.Host != client.Seat || room.State != "lobby") return;

        room.State = "playing";
        room.Seed = room.SettingsSeed();
        room.Turn = 0;
        room.Queue = [];
        room.History.Clear();
        room.Snapshots.Clear();
        room.SnapTurn = 0;

        for (var i = 0; i < room.Seats.Count; i++)
        {
            room.Seats[i].Slot = i;
        }

        foreach (var seat in room.Present)
        {
            seat.Client.Send(StartFor(room, seat, false));
        }

        room.Notice("The game begins. Good luck!");
        room.Broadcast(new RoomMsg(room.Describe()));
        LobbyNotice($"{room.Name} has started with {room.Seats.Count} player{(room.Seats.Count == 1 ? "" : "s")}.");
        BroadcastLobby();

        room.Loop = new CancellationTokenSource();
        var token = room.Loop.Token;
        _ = Task.Run(() => RunAsync(room, token));
    }

    private static StartMsg StartFor(Room room, Seat seat, bool resume) => new(
        room.Seed, room.Settings,
        room.Seats.Select(s => new StartSeat(s.Slot, s.Id, s.Name, s.Nation, s.Team)).ToList(),
        seat.Slot, room.Id, room.Turn, room.Speed, room.Paused, resume);

    private async Task RunAsync(Room room, CancellationToken token)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(Room.TurnMs));

        try
        {
            while (await timer.WaitForNextTickAsync(token))
            {
                lock (_lock)
                {
                    if (!_rooms.ContainsKey(room.Id)) return;

                    try
                    {
                        Tick(room);
                    }
                    catch (Exception e)
                    {
                        Console.WriteLine($"room {room.Id}: {e}");
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    private void Tick(Room room)
    {
        var now = DateTime.UtcNow;

        // a player gone for 20 seconds gets a computer steward until they return
        foreach (var seat in room.Seats.Where(s => !s.Left && !s.Ai && !s.Connected && s.DroppedAt is DateTime d && (now - d).TotalSeconds > 20))
        {
            seat.Ai = true;
            room.Inject(new SysCmd("ai", seat.Slot, "normal"), Json);
            room.Notice($"{seat.Name} is still away. A steward runs their realm until they are back.");
            room.Broadcast(new RoomMsg(room.Describe()));
        }

        room.Step();

        if (!room.Present.Any())
        {
            room.EmptySince ??= now;
            if ((now - room.EmptySince.Value).TotalMinutes > 3)
            {
                Close(room);
                BroadcastLobby();
                return;
            }
        }
        else
        {
            room.EmptySince = null;
        }

        if (room.SnapPending && (now - room.SnapAskedAt).TotalSeconds > 8)
        {
            // the authority did not answer: fall back on the newest snapshot the server has
            room.SnapPending = false;
            room.SendStored(room.SnapTargets, room.SnapReason);
            room.SnapTargets.Clear();
        }

        // a fresh snapshot every 30 seconds keeps rejoining cheap
        if (!room.SnapPending && room.Turn - room.SnapTurn >= 300 && room.Turn % 20 == 10)
        {
            RequestSnapshot(room, "periodic", []);
        }
    }

    private void RequestSnapshot(Room room, string reason, IEnumerable<Seat> targets)
    {
        room.SnapTargets.UnionWith(targets);
        if (room.SnapReason != "desync" || !room.SnapPending) room.SnapReason = reason;

        if (room.SnapPending) return;

        var authority = room.Authority();
        if (authority == null)
        {
            room.SendStored(room.SnapTargets, room.SnapReason);
            room.SnapTargets.Clear();
            return;
        }

        room.SnapPending = true;
        room.SnapAskedAt = DateTime.UtcNow;
        authority.Client.Send(new SnapReq());
    }

    public Stored StoreSnapshot(string roomId, string token, int turn, byte[] bytes)
    {
        lock (_lock)
        {
            if (roomId == null || !_rooms.TryGetValue(roomId, out var room) || room.State != "playing")
            {
                throw new ProviderException(ResponseStatus.NotFound, "There is no such game.");
            }

            if (!room.Seats.Any(s => s.Token == token && !s.Left))
            {
                throw new ProviderException(ResponseStatus.Forbidden, "You are not playing in this game.");
            }

            if (bytes.Length == 0 || turn <= room.SnapTurn || turn > room.Turn)
            {
                // stale: whoever waits for it gets the newest snapshot there is instead
                if (room.SnapPending)
                {
                    room.SnapPending = false;
                    room.SendStored(room.SnapTargets, room.SnapReason);
                    room.SnapTargets.Clear();
                }
                return new Stored(false, room.SnapTurn);
            }

            room.StoreSnapshot(turn, bytes);

            if (room.SnapPending)
            {
                room.SnapPending = false;
                if (room.SnapReason == "desync")
                {
                    room.HashFloor = turn;
                    foreach (var n in room.Hashes.Keys.Where(n => n <= turn).ToList()) room.Hashes.Remove(n);
                }
                room.SendStored(room.SnapTargets, room.SnapReason);
                room.SnapTargets.Clear();
            }

            return new Stored(true, turn);
        }
    }

    public byte[] Snapshot(string roomId, string token, int turn)
    {
        lock (_lock)
        {
            if (roomId == null || !_rooms.TryGetValue(roomId, out var room) || !room.Seats.Any(s => s.Token == token && !s.Left))
            {
                throw new ProviderException(ResponseStatus.NotFound, "There is no such game.");
            }

            return room.Snapshots.TryGetValue(turn, out var bytes)
                 ? bytes
                 : throw new ProviderException(ResponseStatus.NotFound, "That snapshot is gone.");
        }
    }

    private void Command(Client client, int id, JsonElement? command)
    {
        var room = client.Room;
        var seat = client.Seat;
        if (room == null || seat == null || room.State != "playing" || seat.Left) return;
        if (command is not { ValueKind: JsonValueKind.Object } value || value.GetRawText().Length > 6000) return;
        if (room.Queue.Count >= 400) return;

        room.Queue.Add(new TurnCmd(seat.Slot, id, value));
    }

    private void SpeedChange(Client client, int? speed, bool? paused)
    {
        var room = client.Room;
        if (room == null || room.State != "playing" || room.Authority() != client.Seat) return;

        if (speed is int s && s >= 0 && s < Room.TicksPerTurn.Length) room.Speed = s;
        if (paused is bool p) room.Paused = p;

        room.Broadcast(new SpeedMsg(room.Speed, room.Paused));
    }

    private void Hash(Client client, int turn, long hash)
    {
        var room = client.Room;
        var seat = client.Seat;
        if (room == null || seat == null || room.State != "playing" || turn <= room.HashFloor || turn > room.Turn) return;

        if (!room.Hashes.TryGetValue(turn, out var byPlayer))
        {
            room.Hashes[turn] = byPlayer = [];
            foreach (var old in room.Hashes.Keys.Where(n => n < turn - 1200).ToList()) room.Hashes.Remove(old);
        }

        byPlayer[seat.Slot] = hash;

        var authority = room.Authority();
        if (authority == null || !byPlayer.TryGetValue(authority.Slot, out var truth)) return;
        if (byPlayer.Values.All(h => h == truth)) return;

        var now = DateTime.UtcNow;
        if ((now - room.LastResync).TotalSeconds < 15) return;

        room.LastResync = now;
        room.Resyncs++;
        Console.WriteLine($"room {room.Id}: desync at turn {turn}, resync #{room.Resyncs}");
        RequestSnapshot(room, "desync", room.Present.ToList());
    }

    // ------------------------------------------------------------------ lobby

    private IEnumerable<Client> InLobby() => _clients.Values.Where(c => c.Name != null && c.Room == null);

    private int Online() => _clients.Values.Count(c => c.Name != null);

    private void BroadcastLobby()
    {
        var state = new LobbyState(
            _rooms.Values.OrderBy(r => r.State == "playing").ThenBy(r => r.Name).Select(r => r.Info()).ToList(),
            InLobby().Select(c => c.Name).OrderBy(n => n).ToList(),
            Online());

        foreach (var client in InLobby())
        {
            client.Send(state);
        }
    }

    public Status Status()
    {
        lock (_lock)
        {
            return new Status(Online(), _rooms.Count, _rooms.Values.Count(r => r.State == "playing"));
        }
    }

    // ------------------------------------------------------------------ helpers

    private static string CleanName(string name)
    {
        var clean = Clean(name, 20);
        return clean.Length == 0 ? "Settler" : clean;
    }

    private static string Clean(string text, int max)
    {
        text = new string((text ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
        return text.Length > max ? text[..max].Trim() : text;
    }

    public static async Task<byte[]> ReadLimitedAsync(Stream body, int max)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        int read;
        while ((read = await body.ReadAsync(chunk)) > 0)
        {
            if (buffer.Length + read > max)
            {
                throw new ProviderException(ResponseStatus.RequestEntityTooLarge, "That snapshot is too large.");
            }
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }
}
