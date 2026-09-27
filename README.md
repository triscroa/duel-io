# Duel.io

A multiplayer browser-game prototype based on the supplied Duel.io rules.

## Run locally

1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:
   npm install
   npm start
4. Open http://localhost:3000 in two browser tabs/windows.
5. Enter the same room code and choose a character in each tab.

## What is implemented

- Room-based 1v1 multiplayer via Socket.IO.
- Character selection: Wirefreak, Laputan Machine, Deadman.
- Same-character coin-flip start.
- Fastest/slowest character starting behavior.
- Attack/parry choices.
- Successful parry reverses roles.
- Failed parry causes a step-back.
- Deadman successful-parry extra turn.
- Deadman successfully parrying Laputan stuns Laputan for one turn.
- Combat log and restart.

## Position and victory condition

Both players start at position 0. When a player fails a parry, they take one step back:
Player 1 moves toward -5 and Player 2 moves toward +5. Player 1 loses at -5; Player 2 loses at +5.
A restart returns both players to position 0.
