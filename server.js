const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 16384
});

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const ROLES = ["Lead Actor", "Lead Actress", "Director", "Composer"];
const MAX_PLAYERS = 6;
const START_BUDGET = 100;
const AUCTION_MS = 15000;
const BID_INCREMENT = 2;

// Creative game data only. Ratings and prices are fictional.
const TALENT = {
  "Lead Actor": [
    "Rajinikanth", "Kamal Haasan", "Vijay", "Ajith Kumar",
    "Suriya", "Vikram", "Dhanush"
  ],
  "Lead Actress": [
    "Nayanthara", "Trisha", "Sai Pallavi", "Jyothika",
    "Keerthy Suresh", "Aishwarya Rajesh", "Samantha"
  ],
  Director: [
    "Mani Ratnam", "Shankar", "Lokesh Kanagaraj", "Vetrimaaran",
    "Karthik Subbaraj", "Pa. Ranjith", "Sudha Kongara"
  ],
  Composer: [
    "A. R. Rahman", "Ilaiyaraaja", "Anirudh Ravichander",
    "Yuvan Shankar Raja", "Santhosh Narayanan",
    "G. V. Prakash Kumar", "D. Imman"
  ]
};

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function roomCode() {
  let code;
  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));
  return code;
}

function makeDeck(playerCount) {
  return shuffle(
    ROLES.flatMap(role =>
      shuffle(TALENT[role])
        .slice(0, Math.min(playerCount + 1, TALENT[role].length))
        .map(name => {
          const rating = crypto.randomInt(76, 100);
          return {
            id: crypto.randomUUID(),
            name,
            role,
            rating,
            base: 4 + Math.floor((rating - 76) / 4)
          };
        })
    )
  );
}

function ownsRole(player, role) {
  return player.team.some(item => item.role === role);
}

function score(player) {
  const talent = player.team.reduce((sum, item) => sum + item.rating, 0);
  const fullCast = player.team.length === ROLES.length ? 30 : 0;
  return talent + fullCast + Math.floor(player.budget / 5);
}

function minimumBid(room) {
  return room.leaderId ? room.price + BID_INCREMENT : room.lot.base;
}

function log(room, message) {
  room.activity.unshift(message);
  room.activity = room.activity.slice(0, 40);
}

function publicState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.index + 1,
    total: room.deck.length,
    lot: room.lot,
    price: room.price,
    leaderId: room.leaderId,
    deadline: room.deadline,
    serverNow: Date.now(),
    nextBid: room.lot ? minimumBid(room) : null,
    activity: room.activity,
    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      budget: player.budget,
      team: player.team,
      online: Boolean(player.socketId),
      score: score(player)
    }))
  };
}

function publish(room) {
  room.touched = Date.now();
  io.to(room.code).emit("state", publicState(room));
}

function schedule(room, callback, delay) {
  clearTimeout(room.timer);
  room.timer = setTimeout(callback, delay);
}

function beginNextLot(room) {
  room.index += 1;
  room.leaderId = null;
  room.deadline = 0;

while (room.index < room.deck.length) {
    const candidate = room.deck[room.index];
    const eligible = room.players.some(player =>
      !ownsRole(player, candidate.role) &&
      player.budget >= candidate.base
    );

if (eligible) break;
    room.index += 1;
  }

if (room.index >= room.deck.length) {
    room.phase = "finished";
    room.lot = null;
    room.price = 0;
    log(room, "🎬 Auction complete! The final studio rankings are ready.");
    publish(room);
    return;
  }

room.phase = "auction";
  room.lot = room.deck[room.index];
  room.price = room.lot.base;
  room.deadline = Date.now() + AUCTION_MS;

log(room, `${room.lot.name} enters the auction.`);
  publish(room);
  schedule(room, () => settleLot(room), AUCTION_MS);
}

function settleLot(room) {
  if (room.phase !== "auction") return;

const remaining = room.deadline - Date.now();
  if (remaining > 0) {
    schedule(room, () => settleLot(room), remaining);
    return;
  }

const winner = room.players.find(player => player.id === room.leaderId);

if (winner) {
    winner.budget -= room.price;
    winner.team.push({ ...room.lot, paid: room.price });
    log(room, `🔨 SOLD! ${room.lot.name} → ${winner.name} for ₹${room.price} Cr.`);
  } else {
    log(room, `${room.lot.name} goes unsold.`);
  }

room.phase = "result";
  room.deadline = 0;
  publish(room);
  schedule(room, () => beginNextLot(room), 3000);
}

function hostTransfer(room) {
  const hostOnline = room.players.some(
    player => player.id === room.hostId && player.socketId
  );

if (!hostOnline) {
    const nextHost = room.players.find(player => player.socketId);
    if (nextHost) room.hostId = nextHost.id;
  }
}

io.on("connection", socket => {
  function handle(event, callback) {
    socket.on(event, (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};

try {
        const now = Date.now();
        if (now - (socket.data.lastAction || 0) < 150) {
          throw new Error("Please wait a moment.");
        }
        socket.data.lastAction = now;

const data = payload && typeof payload === "object" ? payload : {};
        callback(data, reply);
      } catch (error) {
        reply({ error: error.message || "Unable to complete that action." });
      }
    });
  }

function playerContext() {
    const room = rooms.get(socket.data.code);
    const player = room?.players.find(
      item => item.id === socket.data.playerId
    );

if (!room || !player || player.socketId !== socket.id) {
      throw new Error("Join a room first.");
    }

return { room, player };
  }

function enterRoom(room, data, reply) {
    if (socket.data.code) throw new Error("You are already in a room.");

let player = typeof data.token === "string"
      ? room.players.find(item => item.token === data.token)
      : null;

if (!player) {
      if (room.phase !== "lobby") {
        throw new Error("This auction has already started.");
      }
      if (room.players.length >= MAX_PLAYERS) {
        throw new Error("This room is full.");
      }

const name = String(data.name || "").trim().slice(0, 24);
      if (!name) throw new Error("Enter your studio name.");

player = {
        id: crypto.randomUUID(),
        token: crypto.randomBytes(24).toString("hex"),
        name,
        budget: START_BUDGET,
        team: [],
        socketId: null
      };

room.players.push(player);
      log(room, `${name} joins the studio floor.`);
    }

// A reconnection replaces the previous connection for this player.
    const previousSocketId = player.socketId;
    player.socketId = socket.id;

if (previousSocketId && previousSocketId !== socket.id) {
      io.sockets.sockets.get(previousSocketId)?.disconnect(true);
    }

socket.data.code = room.code;
    socket.data.playerId = player.id;
    socket.join(room.code);

if (!room.hostId) room.hostId = player.id;
    hostTransfer(room);

reply({
      ok: true,
      code: room.code,
      playerId: player.id,
      token: player.token,
      name: player.name
    });

publish(room);
  }

handle("create", (data, reply) => {
    if (socket.data.code) throw new Error("You are already in a room.");
    if (!String(data.name || "").trim()) {
      throw new Error("Enter your studio name.");
    }
    if (rooms.size >= 500) {
      throw new Error("The server is busy. Please try again later.");
    }

const room = {
      code: roomCode(),
      hostId: null,
      phase: "lobby",
      players: [],
      deck: [],
      index: -1,
      lot: null,
      price: 0,
      leaderId: null,
      deadline: 0,
      activity: [],
      timer: null,
      touched: Date.now()
    };

rooms.set(room.code, room);
    enterRoom(room, data, reply);
  });

handle("join", (data, reply) => {
    const code = String(data.code || "").trim().toUpperCase();
    const room = rooms.get(code);

if (!room) throw new Error("Room not found. Check the room code.");
    enterRoom(room, data, reply);
  });

handle("start", (_data, reply) => {
    const { room, player } = playerContext();

if (room.hostId !== player.id) {
      throw new Error("Only the host can start the auction.");
    }
    if (room.phase !== "lobby") throw new Error("The auction has already started.");
    if (room.players.filter(item => item.socketId).length < 2) {
      throw new Error("At least two connected players are required.");
    }

// Offline lobby seats are released when the auction begins.
    room.players = room.players.filter(item => item.socketId);
    room.deck = makeDeck(room.players.length);
    room.index = -1;

log(room, "🔥 Cameras rolling. The auction begins!");
    beginNextLot(room);
    reply({ ok: true });
  });

handle("bid", (data, reply) => {
    const { room, player } = playerContext();

if (room.phase !== "auction" || Date.now() >= room.deadline) {
      throw new Error("Bidding is closed.");
    }
    if (data.lotId !== room.lot.id) {
      throw new Error("The lot changed. Bid on the current talent.");
    }
    if (room.leaderId === player.id) {
      throw new Error("You already hold the highest bid.");
    }
    if (ownsRole(player, room.lot.role)) {
      throw new Error("Your studio has already filled this role.");
    }

const amount = Number(data.amount);
    if (!Number.isInteger(amount) || amount !== minimumBid(room)) {
      throw new Error("The price changed. Please bid again.");
    }
    if (amount > player.budget) {
      throw new Error("Your studio does not have enough budget.");
    }

room.price = amount;
    room.leaderId = player.id;

// Anti-sniping: every late bid leaves at least five seconds.
    room.deadline = Math.max(room.deadline, Date.now() + 5000);
    schedule(room, () => settleLot(room), room.deadline - Date.now());

log(room, `${player.name} bids ₹${amount} Cr for ${room.lot.name}.`);
    publish(room);
    reply({ ok: true });
  });

socket.on("disconnect", () => {
    const room = rooms.get(socket.data.code);
    const player = room?.players.find(item => item.id === socket.data.playerId);

if (!room || !player || player.socketId !== socket.id) return;

player.socketId = null;
    hostTransfer(room);
    publish(room);
  });
});

// Rooms are held in memory and cleared after two hours without activity.
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;

for (const [code, room] of rooms) {
    if (room.touched >= cutoff) continue;

clearTimeout(room.timer);
    io.to(code).emit("expired");
    io.in(code).disconnectSockets(true);
    rooms.delete(code);
  }
}, 60000).unref();

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Kollywood Auction Arena running on port ${PORT}`);
});
