const socket = io();
let myId = null;
let roomState = null;
let selectedCharacter = null;

const $ = id => document.getElementById(id);
const lobby = $("lobby"), game = $("game");

socket.on("connect", () => myId = socket.id);
socket.on("errorMessage", msg => $("joinError").textContent = msg);

document.querySelectorAll(".character").forEach(btn => {
  btn.addEventListener("click", () => {
    selectedCharacter = btn.dataset.character;
    socket.emit("join", { roomId: $("room").value, character: selectedCharacter });
    $("joinError").textContent = "";
  });
});

document.querySelectorAll("[data-attack]").forEach(btn => {
  btn.addEventListener("click", () => socket.emit("attack", btn.dataset.attack));
});
document.querySelectorAll("[data-parry]").forEach(btn => {
  btn.addEventListener("click", () => socket.emit("parry", btn.dataset.parry));
});
$("reset").addEventListener("click", () => socket.emit("reset"));

socket.on("state", state => {
  roomState = state;
  if (state.players.length === 0) return;
  lobby.classList.add("hidden");
  game.classList.remove("hidden");
  render(state);
});

function titleCase(s) {
  return s.replaceAll("_"," ").replace(/\b\w/g, x => x.toUpperCase());
}

function render(state) {
  const me = state.players.find(p => p.id === myId);
  const opp = state.players.find(p => p.id !== myId);

  $("roomLabel").textContent = `ROOM ${state.id}`;
  $("youName").textContent = me ? titleCase(me.character) : "—";
  $("oppName").textContent = opp ? titleCase(opp.character) : "Waiting for opponent";
  $("youRole").textContent = me?.role ? me.role.toUpperCase() : "WAITING";
  $("oppRole").textContent = opp?.role ? opp.role.toUpperCase() : "WAITING";
  $("youSteps").textContent = me ? `POSITION: ${me.position} / -5` : "";
  $("oppSteps").textContent = opp ? `POSITION: ${opp.position} / +5` : "";

  const iAttack = me && state.turnPlayerId === myId && me.role === "attacker" && state.started && !state.pendingAttack;
  const iParry = me && state.pendingAttack && state.pendingAttack.attackerId !== myId && me.role === "defender" && state.started;

  $("attackControls").classList.toggle("hidden", !iAttack);
  $("parryControls").classList.toggle("hidden", !iParry);

  if (state.winner) {
    const won = state.winner === myId;
    $("banner").textContent = won ? "DUEL COMPLETE — YOU WIN" : "DUEL COMPLETE — YOU LOSE";
  } else if (state.pendingAttack) {
    const attacking = state.pendingAttack.attackerId === myId;
    $("banner").textContent = attacking
      ? `ATTACK SENT: ${titleCase(state.pendingAttack.attack)}`
      : `INCOMING: ${titleCase(state.pendingAttack.attack)} — CHOOSE A PARRY`;
  } else if (state.players.length < 2) {
    $("banner").textContent = "WAITING FOR AN OPPONENT…";
  } else if (iAttack) {
    $("banner").textContent = "YOUR TURN — ATTACK";
  } else {
    $("banner").textContent = "OPPONENT'S TURN";
  }

  $("log").innerHTML = state.log.map(x => `<div>› ${escapeHtml(x)}</div>`).join("");
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}
