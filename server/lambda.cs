// Settlers - A Roman Chronicle, with a public multiplayer lobby.
//
//   GET  ./                  the game: a single page application in web/ (built by tools/build.mjs)
//   WS   net                 lobby, rooms, chat and the turn clock of every running game
//   GET  api/status          how many are online and playing
//   POST api/snap?room=&token=&turn=    a player's snapshot of their game (gzipped JSON)
//   GET  api/snap?room=&token=&turn=    fetch one, to rejoin or resynchronise
//
// The server never runs the simulation. Every browser runs the same deterministic game and applies
// the same commands at the same tick; the server only orders the commands into turns (lockstep),
// compares state fingerprints and passes snapshots along when a browser has to catch up.
//
//   lambda.cs     the wiring
//   Hub.cs        the websocket handler: lobby, rooms, chat, game clock
//   Room.cs       one room and its game: seats, turns, snapshots
//   Client.cs     one socket and its ordered outbox
//   Protocol.cs   every message, both directions

var hub = new Hub();

var api = Inline.Create()
                .Get("status", () => hub.Status())
                .Post("snap", async (string room, string token, int turn, Stream body) =>
                {
                    var bytes = await Hub.ReadLimitedAsync(body, 8 * 1024 * 1024);
                    return hub.StoreSnapshot(room, token, turn, bytes);
                })
                .Get("snap", (string room, string token, int turn) => (Stream)new MemoryStream(hub.Snapshot(room, token, turn)));

return Layout.Create()
             .Add("net", Websocket.Reactive().Handler(hub))
             .Add("api", api)
             .Add(Assets.App("web"));
