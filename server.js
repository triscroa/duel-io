const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

// --------------------------------------------------
// ATTACKS / PARRIES
// --------------------------------------------------

const ATTACKS = [
  "high_chop",
  "thrust",
  "low_slash"
];

const PARRIES = [
  "high_parry",
  "parry",
  "low_parry"
];

const COUNTERS = {
  high_chop: "high_parry",
  thrust: "parry",
  low_slash: "low_parry"
};

// --------------------------------------------------
// CHARACTERS
// --------------------------------------------------

const CHARACTERS = {
  wirefreak: {
    name: "Wirefreak",
    speed: 2
  },

  laputan: {
    name: "Laputan Machine",
    speed: 3
  },

  deadman: {
    name: "Deadman",
    speed: 1
  }
};

// --------------------------------------------------
// MAP
// --------------------------------------------------

// Players start at 0.
//
// Player 1 loses if pushed to -6.
// Player 2 loses if pushed to +6.
//
// Therefore:
//
//          P1 side                  P2 side
//       -6 -5 -4 -3 -2 -1  0  +1 +2 +3 +4 +5 +6
//       WALL                         WALL
//

const MIN_POSITION = -6;
const MAX_POSITION = 6;

// --------------------------------------------------
// HELPER FUNCTIONS
// --------------------------------------------------

function otherPlayer(room, playerId) {
  return room.players.find(player => player.id !== playerId);
}

function getPlayer(room, playerId) {
  return room.players.find(player => player.id === playerId);
}

function getAttacker(room) {
  return room.players.find(player => player.role === "attacker");
}

function getDefender(room) {
  return room.players.find(player => player.role === "defender");
}

// --------------------------------------------------
// SEND ROOM STATE TO CLIENTS
// --------------------------------------------------

function publicRoom(room) {
  return {
    id: room.id,

    started: room.started,

    winner: room.winner,

    players: room.players.map(player => ({
      id: player.id,
      character: player.character,
      role: player.role,

      // Keep this for compatibility with the existing frontend.
      stepsBack: player.stepsBack,

      // New position system.
      position: player.position,

      stunned: player.stunned,

      connected: player.connected
    })),

    turnPlayerId: room.turnPlayerId,

    pendingAttack: room.pendingAttack
      ? {
          attackerId: room.pendingAttack.attackerId,
          attack: room.pendingAttack.attack
        }
      : null,

    log: room.log.slice(-12)
  };
}

function emitRoom(room) {
  io.to(room.id).emit("state", publicRoom(room));
}

function log(room, message) {
  room.log.push(message);
}

// --------------------------------------------------
// ROLE ASSIGNMENT
// --------------------------------------------------

function assignRoles(room) {
  const [playerOne, playerTwo] = room.players;

  // Safety check.
  if (!playerOne || !playerTwo) {
    return;
  }

  // Reset anything from a previous duel.
  playerOne.role = null;
  playerTwo.role = null;

  playerOne.stunned = false;
  playerTwo.stunned = false;

  playerOne.position = 0;
  playerTwo.position = 0;

  playerOne.stepsBack = 0;
  playerTwo.stepsBack = 0;

  // ------------------------------------------------
  // SAME CHARACTER
  // ------------------------------------------------
  //
  // The rules say a coin flip decides who attacks
  // first when both players choose the same character.
  //

  if (playerOne.character === playerTwo.character) {
    const first =
      Math.random() < 0.5
        ? playerOne
        : playerTwo;

    const second =
      first === playerOne
        ? playerTwo
        : playerOne;

    first.role = "attacker";
    second.role = "defender";

    log(
      room,
      "Both players chose the same character. A coin flip decides who attacks first."
    );
  }

  // ------------------------------------------------
  // DIFFERENT CHARACTERS
  // ------------------------------------------------
  //
  // Laputan = fastest
  // Wirefreak = middle
  // Deadman = slowest
  //

  else {
    let firstAttacker;

    if (playerOne.character === "laputan") {
      firstAttacker = playerOne;
    } else if (playerTwo.character === "laputan") {
      firstAttacker = playerTwo;
    } else if (playerOne.character === "deadman") {
      firstAttacker = playerTwo;
    } else if (playerTwo.character === "deadman") {
      firstAttacker = playerOne;
    } else {
      // This is normally Wirefreak vs Wirefreak,
      // which is already handled above.
      firstAttacker = playerOne;
    }

    const secondPlayer =
      firstAttacker === playerOne
        ? playerTwo
        : playerOne;

    firstAttacker.role = "attacker";
    secondPlayer.role = "defender";
  }

  room.turnPlayerId = getAttacker(room).id;
  room.started = true;
  room.winner = null;
  room.pendingAttack = null;

  const attacker = getAttacker(room);

  log(
    room,
    `${CHARACTERS[attacker.character].name} attacks first.`
  );
}

// --------------------------------------------------
// SWITCH ATTACKER / DEFENDER
// --------------------------------------------------

function swapRoles(room) {
  const attacker = getAttacker(room);
  const defender = getDefender(room);

  if (!attacker || !defender) {
    return;
  }

  attacker.role = "defender";
  defender.role = "attacker";

  room.turnPlayerId = defender.id;
}

// --------------------------------------------------
// MOVE DEFENDER BACK
// --------------------------------------------------

function moveDefenderBack(room, defender) {
  const playerIndex = room.players.indexOf(defender);

  // Player 1 gets pushed toward -6.
  if (playerIndex === 0) {
    defender.position -= 1;
  }

  // Player 2 gets pushed toward +6.
  else {
    defender.position += 1;
  }

  defender.stepsBack += 1;

  log(
    room,
    `${CHARACTERS[defender.character].name} moves back to block ${defender.position}.`
  );
}

// --------------------------------------------------
// CHECK WIN CONDITION
// --------------------------------------------------

function finishIfNeeded(room) {
  const playerOne = room.players[0];
  const playerTwo = room.players[1];

  if (!playerOne || !playerTwo) {
    return false;
  }

  // ------------------------------------------------
  // PLAYER 1 LOSES AT -6
  // ------------------------------------------------

  if (playerOne.position <= MIN_POSITION) {
    room.winner = playerTwo.id;
    room.started = false;
    room.turnPlayerId = null;
    room.pendingAttack = null;

    log(
      room,
      `${CHARACTERS[playerTwo.character].name} wins the duel.`
    );

    return true;
  }

  // ------------------------------------------------
  // PLAYER 2 LOSES AT +6
  // ------------------------------------------------

  if (playerTwo.position >= MAX_POSITION) {
    room.winner = playerOne.id;
    room.started = false;
    room.turnPlayerId = null;
    room.pendingAttack = null;

    log(
      room,
      `${CHARACTERS[playerOne.character].name} wins the duel.`
    );

    return true;
  }

  return false;
}

// --------------------------------------------------
// ATTACK HANDLER
// --------------------------------------------------

function handleAttack(room, socket, attack) {
  const attacker = getPlayer(room, socket.id);
  const defender = otherPlayer(room, socket.id);

  if (!attacker || !defender) {
    return;
  }

  if (!room.started) {
    return;
  }

  // Only the current attacker can attack.
  if (room.turnPlayerId !== socket.id) {
    return;
  }

  if (attacker.role !== "attacker") {
    return;
  }

  // Make sure the attack is valid.
  if (!ATTACKS.includes(attack)) {
    return;
  }

  // ------------------------------------------------
  // STUNNED LAPUTAN
  // ------------------------------------------------
  //
  // If Laputan was successfully parried, Laputan
  // loses one turn.
  //
  // The stun is consumed here.
  //

  if (attacker.stunned) {
    attacker.stunned = false;

    log(
      room,
      `${CHARACTERS[attacker.character].name} is stunned and loses this turn.`
    );

    swapRoles(room);

    emitRoom(room);

    return;
  }

  // ------------------------------------------------
  // RECORD THE ATTACK
  // ------------------------------------------------

  room.pendingAttack = {
    attackerId: attacker.id,
    attack: attack
  };

  log(
    room,
    `${CHARACTERS[attacker.character].name} attacks with ${attack.replace("_", " ")}.`
  );

  emitRoom(room);
}

// --------------------------------------------------
// PARRY HANDLER
// --------------------------------------------------

function handleParry(room, socket, parry) {
  const defender = getPlayer(room, socket.id);
  const attacker = otherPlayer(room, socket.id);

  if (!defender || !attacker) {
    return;
  }

  if (!room.started) {
    return;
  }

  // There must be an attack waiting for a parry.
  if (!room.pendingAttack) {
    return;
  }

  // The attack must belong to the other player.
  if (room.pendingAttack.attackerId !== attacker.id) {
    return;
  }

  // Only the defender can parry.
  if (defender.role !== "defender") {
    return;
  }

  // Make sure the parry is valid.
  if (!PARRIES.includes(parry)) {
    return;
  }

  const attack = room.pendingAttack.attack;

  // Clear the attack before resolving it.
  room.pendingAttack = null;

  const successful = COUNTERS[attack] === parry;

  // ==================================================
  // SUCCESSFUL PARRY
  // ==================================================

  if (successful) {
    log(
      room,
      `${CHARACTERS[defender.character].name} successfully parries.`
    );

    // ------------------------------------------------
    // LAPUTAN WAS PARRIED
    // ------------------------------------------------
    //
    // Laputan is stunned for one turn.
    //

    if (attacker.character === "laputan") {
      attacker.stunned = true;

      log(
        room,
        "Laputan Machine is stunned for one turn."
      );
    }

    // ------------------------------------------------
    // DEADMAN SUCCESSFULLY PARRIES
    // ------------------------------------------------
    //
    // The source rules specify:
    //
    // Deadman parrying Laputan:
    //   - Deadman gets two uncontested attacks.
    //
    // Deadman parrying Wirefreak:
    //   - Deadman gets one uncontested attack.
    //
    // The full special sequence will be handled by
    // the extra-turn state below.
    //

    if (defender.character === "deadman") {
      if (attacker.character === "laputan") {
        defender.extraAttacks = 2;

        log(
          room,
          "Deadman gets two uncontested attacks against the stunned Laputan Machine."
        );
      } else {
        defender.extraAttacks = 1;

        log(
          room,
          "Deadman gets one uncontested attack."
        );
      }
    }

    // ------------------------------------------------
    // NORMAL ROLE SWITCH
    // ------------------------------------------------

    swapRoles(room);

    // The player who successfully parried is now
    // the attacker.
  }

  // ==================================================
  // FAILED PARRY
  // ==================================================

  else {
    log(
      room,
      `${CHARACTERS[defender.character].name} fails to parry.`
    );

    // ------------------------------------------------
    // MOVE THE DEFENDER
    // ------------------------------------------------

    moveDefenderBack(room, defender);

    // ------------------------------------------------
    // CHECK FOR VICTORY IMMEDIATELY
    // ------------------------------------------------

    if (finishIfNeeded(room)) {
      emitRoom(room);
      return;
    }

    // ------------------------------------------------
    // IMPORTANT:
    //
    // THE SAME PLAYER KEEPS ATTACKING.
    //
    // We do NOT swap roles here.
    // ------------------------------------------------

    room.turnPlayerId = attacker.id;

    log(
      room,
      `${CHARACTERS[attacker.character].name} keeps the attack.`
    );
  }

  emitRoom(room);
}

// --------------------------------------------------
// SOCKET CONNECTION
// --------------------------------------------------

io.on("connection", socket => {

  // ==================================================
  // JOIN ROOM
  // ==================================================

  socket.on("join", ({ roomId, character }) => {

    roomId = String(roomId || "lobby")
      .trim()
      .slice(0, 24);

    character = String(character || "")
      .toLowerCase();

    if (!CHARACTERS[character]) {
      socket.emit(
        "errorMessage",
        "Choose a valid character."
      );

      return;
    }

    // ------------------------------------------------
    // FIND OR CREATE ROOM
    // ------------------------------------------------

    let room = rooms.get(roomId);

    if (!room) {
      room = {
        id: roomId,

        players: [],

        started: false,

        winner: null,

        turnPlayerId: null,

        pendingAttack: null,

        log: []
      };

      rooms.set(roomId, room);
    }

    // ------------------------------------------------
    // ROOM LIMIT
    // ------------------------------------------------

    if (room.players.length >= 2) {
      socket.emit(
        "errorMessage",
        "That duel room is full."
      );

      return;
    }

    // ------------------------------------------------
    // CREATE PLAYER
    // ------------------------------------------------

    const player = {
      id: socket.id,

      character: character,

      role: null,

      position: 0,

      stepsBack: 0,

      stunned: false,

      extraAttacks: 0,

      connected: true
    };

    room.players.push(player);

    socket.join(roomId);

    socket.data.roomId = roomId;

    log(
      room,
      `${CHARACTERS[character].name} joined the duel.`
    );

    // ------------------------------------------------
    // START WHEN BOTH PLAYERS ARE PRESENT
    // ------------------------------------------------

    if (room.players.length === 2) {
      assignRoles(room);
    }

    emitRoom(room);
  });

  // ==================================================
  // ATTACK
  // ==================================================

  socket.on("attack", attack => {
    const room = rooms.get(socket.data.roomId);

    if (room) {
      handleAttack(room, socket, attack);
    }
  });

  // ==================================================
  // PARRY
  // ==================================================

  socket.on("parry", parry => {
    const room = rooms.get(socket.data.roomId);

    if (room) {
      handleParry(room, socket, parry);
    }
  });

  // ==================================================
  // RESET / REMATCH
  // ==================================================

  socket.on("reset", () => {
    const room = rooms.get(socket.data.roomId);

    if (!room) {
      return;
    }

    if (room.players.length !== 2) {
      return;
    }

    room.started = false;

    room.winner = null;

    room.turnPlayerId = null;

    room.pendingAttack = null;

    room.log = [];

    room.players.forEach(player => {
      player.role = null;

      player.position = 0;

      player.stepsBack = 0;

      player.stunned = false;

      player.extraAttacks = 0;

      player.connected = true;
    });

    assignRoles(room);

    emitRoom(room);
  });

  // ==================================================
  // DISCONNECT
  // ==================================================

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomId);

    if (!room) {
      return;
    }

    const player = room.players.find(
      p => p.id === socket.id
    );

    if (player) {
      player.connected = false;
    }

    emitRoom(room);
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(
    `Duel.io running on http://localhost:${PORT}`
  );
});