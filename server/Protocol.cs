// Every message on the socket, as JSON with a "type". The websocket module writes records in camel
// case; null properties are left out.
//
// Browser -> server
//   hello    { name, token?, turn? }        first frame; token resumes a seat after a reconnect,
//                                           turn = the last turn this page already has
//   name     { name }                       rename
//   chat     { text }                       to the lobby, or to the room you are in
//   create   { name }                       open a room and sit in it as its host
//   join     { room }  /  leave {}
//   seat     { nation?, team?, ready? }     your own seat in the room
//   settings { settings }                   host: map and opponents (opaque to the server)
//   kick     { id }                         host, before the game starts
//   start    {}                             host
//   cmd      { i, c }                       a game command; lands in the next turn
//   speed    { speed?, paused? }            host
//   hash     { n, h }                       state fingerprint after turn n (n % 20 == 0)
//   ping     {}
//
// Server -> browser
//   welcome  { you, token, online }
//   lobby    { rooms, people, online }
//   room     { room }                       the room you are in, whenever it changes
//   chat     { scope, line }  /  chatlog { scope, lines }
//   start    { seed, settings, seats, you, turn, speed, paused, resume }
//   turn     { n, k, c }                    k = simulation ticks in this turn, c = commands
//   turns    { turns }                      catch-up after a short reconnect
//   speed    { speed, paused }
//   snapreq  {}                             upload a snapshot of your game: POST api/snap
//   snap     { turn, turns, reason }        load snapshot `turn` (0 = build from setup), then play `turns`
//   left     { reason }                     you are no longer in a room
//   error    { text }

public record Incoming(
    string Type, string Name, string Token, string Text, string Room, string Id,
    string Nation, int? Team, bool? Ready, JsonElement? Settings, JsonElement? C,
    int? I, int? N, long? H, int? Turn, int? Speed, bool? Paused);

public record Person(string Id, string Name);

public record Welcome(Person You, string Token, int Online, string Type = "welcome");

public record RoomInfo(string Id, string Name, string Host, int Players, int Max, string State, JsonElement? Settings);

public record LobbyState(List<RoomInfo> Rooms, List<string> People, int Online, string Type = "lobby");

public record SeatInfo(string Id, string Name, string Nation, int Team, bool Ready, bool Connected, bool Ai, bool Left, int Slot);

public record RoomState(string Id, string Name, string HostId, string State, List<SeatInfo> Seats, JsonElement? Settings, int Max);

public record RoomMsg(RoomState Room, string Type = "room");

public record ChatLine(string From, string Text, long T, bool Sys);

public record ChatMsg(string Scope, ChatLine Line, string Type = "chat");

public record ChatLog(string Scope, List<ChatLine> Lines, string Type = "chatlog");

public record StartSeat(int Slot, string Id, string Name, string Nation, int Team);

public record StartMsg(int Seed, JsonElement? Settings, List<StartSeat> Seats, int You, string Room, int Turn, int Speed, bool Paused, bool Resume, string Type = "start");

public record TurnCmd(int P, int I, JsonElement C);

public record TurnMsg(int N, int K, List<TurnCmd> C, string Type = "turn");

public record TurnsMsg(List<TurnMsg> Turns, string Type = "turns");

public record SpeedMsg(int Speed, bool Paused, string Type = "speed");

public record SnapReq(string Type = "snapreq");

public record SnapMsg(int Turn, List<TurnMsg> Turns, string Reason, string Type = "snap");

public record LeftMsg(string Reason, string Type = "left");

public record ErrorMsg(string Text, string Type = "error");

public record Pong(string Type = "pong");

public record SysCmd(string K, int S, string V);

public record Status(int Online, int Rooms, int Playing);

public record Stored(bool Ok, int Turn);
