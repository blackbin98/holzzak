import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  onValue,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const ROUND_SECONDS = 30;
const roomsPath = "oddEvenRooms";

const state = {
  roomCode: "",
  playerId: localStorage.getItem("oddEvenPlayerId") || crypto.randomUUID(),
  unsubscribe: null,
  room: null,
  tick: null,
  finishingRound: false
};

localStorage.setItem("oddEvenPlayerId", state.playerId);

const els = {
  setupView: document.querySelector("#setupView"),
  gameView: document.querySelector("#gameView"),
  playerNameInput: document.querySelector("#playerNameInput"),
  roomCodeInput: document.querySelector("#roomCodeInput"),
  createRoomButton: document.querySelector("#createRoomButton"),
  joinRoomButton: document.querySelector("#joinRoomButton"),
  setupMessage: document.querySelector("#setupMessage"),
  roomCodeDisplay: document.querySelector("#roomCodeDisplay"),
  playersList: document.querySelector("#playersList"),
  leaveButton: document.querySelector("#leaveButton"),
  roleLabel: document.querySelector("#roleLabel"),
  roundTitle: document.querySelector("#roundTitle"),
  timer: document.querySelector("#timer"),
  waitingNotice: document.querySelector("#waitingNotice"),
  hostControls: document.querySelector("#hostControls"),
  guesserControls: document.querySelector("#guesserControls"),
  numberChoices: document.querySelector("#numberChoices"),
  choiceStatus: document.querySelector("#choiceStatus"),
  winnerBanner: document.querySelector("#winnerBanner"),
  winnerName: document.querySelector("#winnerName"),
  winnerMessage: document.querySelector("#winnerMessage"),
  nextRoundButton: document.querySelector("#nextRoundButton")
};

for (let number = 0; number <= 5; number += 1) {
  const button = document.createElement("button");
  button.className = "number-button";
  button.type = "button";
  button.textContent = String(number);
  button.addEventListener("click", () => chooseNumber(number));
  els.numberChoices.append(button);
}

document.querySelectorAll("[data-guess]").forEach((button) => {
  button.addEventListener("click", () => chooseGuess(button.dataset.guess));
});

els.createRoomButton.addEventListener("click", createRoom);
els.joinRoomButton.addEventListener("click", joinRoom);
els.nextRoundButton.addEventListener("click", nextRound);
els.leaveButton.addEventListener("click", leaveRoom);

async function createRoom() {
  const name = getPlayerName();
  if (!name) return;

  setSetupMessage("방을 만드는 중입니다...");
  const roomCode = await createUniqueRoomCode();
  const now = Date.now();
  const player = { id: state.playerId, name, joinedAt: now, score: 0 };

  await set(roomRef(roomCode), {
    roomCode,
    status: "waiting",
    round: 1,
    hostId: state.playerId,
    guesserId: "",
    players: { [state.playerId]: player },
    choices: {},
    result: null,
    roundEndsAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  subscribe(roomCode);
}

async function joinRoom() {
  const name = getPlayerName();
  const roomCode = normalizeRoomCode(els.roomCodeInput.value);
  if (!name || !roomCode) {
    setSetupMessage("이름과 방 코드를 모두 입력해 주세요.");
    return;
  }

  const snapshot = await get(roomRef(roomCode));
  if (!snapshot.exists()) {
    setSetupMessage("방을 찾을 수 없습니다.");
    return;
  }

  const room = snapshot.val();
  const players = room.players || {};
  const playerIds = Object.keys(players);
  const isReturning = Boolean(players[state.playerId]);

  if (playerIds.length >= 2 && !isReturning) {
    setSetupMessage("이미 두 명이 플레이 중인 방입니다.");
    return;
  }

  const nextPlayers = {
    ...players,
    [state.playerId]: {
      id: state.playerId,
      name,
      joinedAt: players[state.playerId]?.joinedAt || Date.now(),
      score: players[state.playerId]?.score || 0
    }
  };

  const ids = Object.keys(nextPlayers);
  const hostId = room.hostId || ids[0];
  const guesserId = ids.find((id) => id !== hostId) || "";
  const updates = {
    players: nextPlayers,
    guesserId,
    updatedAt: serverTimestamp()
  };

  if (ids.length === 2 && room.status === "waiting") {
    Object.assign(updates, startRoundFields(hostId, guesserId, room.round || 1));
  }

  await update(roomRef(roomCode), updates);
  subscribe(roomCode);
}

function subscribe(roomCode) {
  state.roomCode = roomCode;
  state.unsubscribe?.();
  state.unsubscribe = onValue(roomRef(roomCode), (snapshot) => {
    if (!snapshot.exists()) {
      setSetupMessage("방이 사라졌습니다.");
      leaveRoom();
      return;
    }
    state.room = snapshot.val();
    render();
  });
}

function render() {
  const room = state.room;
  const players = Object.values(room.players || {});
  const me = room.players?.[state.playerId];
  const opponent = players.find((player) => player.id !== state.playerId);
  const isHost = room.hostId === state.playerId;
  const isGuesser = room.guesserId === state.playerId;
  const myChoice = room.choices?.[state.playerId];
  const secondsLeft = getSecondsLeft(room);

  els.setupView.classList.add("hidden");
  els.gameView.classList.remove("hidden");
  els.roomCodeDisplay.textContent = room.roomCode;
  els.playersList.innerHTML = players
    .map((player) => `<div class="player-row"><span>${escapeHtml(player.name)}</span><strong>${player.score || 0}</strong></div>`)
    .join("");

  els.waitingNotice.classList.toggle("hidden", room.status !== "waiting");
  els.hostControls.classList.toggle("hidden", room.status !== "playing" || !isHost || Boolean(myChoice));
  els.guesserControls.classList.toggle("hidden", room.status !== "playing" || !isGuesser || Boolean(myChoice));
  els.nextRoundButton.classList.toggle("hidden", room.status !== "finished" || !me);
  els.winnerBanner.classList.toggle("hidden", room.status !== "finished");

  if (room.status === "waiting") {
    els.roleLabel.textContent = "대기 중";
    els.roundTitle.textContent = "상대가 들어오길 기다리는 중";
    els.choiceStatus.textContent = "";
    els.timer.textContent = String(ROUND_SECONDS);
    stopTimer();
    return;
  }

  if (room.status === "playing") {
    els.roleLabel.textContent = isHost ? "숫자 선택" : "홀짝 맞히기";
    els.roundTitle.textContent = `${room.round}라운드 · ${opponent?.name || "상대"}와 대결`;
    els.choiceStatus.textContent = myChoice
      ? "선택 완료. 상대의 선택을 기다리는 중입니다."
      : "30초 안에 선택하세요.";
    els.timer.textContent = String(secondsLeft);
    startTimer();
    if (secondsLeft <= 0) finishRoundByTimeout();
  }

  if (room.status === "finished" && room.result) {
    stopTimer();
    els.timer.textContent = "0";
    els.roleLabel.textContent = "승부 완료";
    els.roundTitle.textContent = `${room.round}라운드 결과`;
    els.choiceStatus.textContent = resultText(room);
    els.winnerName.textContent = `${room.result.winnerName} 승리!`;
    els.winnerMessage.textContent = "축하합니다. 멋진 한 판이었어요!";
  }
}

async function chooseNumber(number) {
  if (!canChoose()) return;
  await update(roomRef(state.roomCode), {
    [`choices/${state.playerId}`]: { type: "number", value: number },
    updatedAt: serverTimestamp()
  });
  await maybeFinishRound();
}

async function chooseGuess(guess) {
  if (!canChoose()) return;
  await update(roomRef(state.roomCode), {
    [`choices/${state.playerId}`]: { type: "guess", value: guess },
    updatedAt: serverTimestamp()
  });
  await maybeFinishRound();
}

async function maybeFinishRound() {
  const snapshot = await get(roomRef(state.roomCode));
  if (!snapshot.exists()) return;
  const room = snapshot.val();
  if (room.status !== "playing") return;
  const hostChoice = room.choices?.[room.hostId];
  const guesserChoice = room.choices?.[room.guesserId];
  if (!hostChoice || !guesserChoice) return;
  await finishRound(room, "choice");
}

async function finishRoundByTimeout() {
  const room = state.room;
  if (!room || room.status !== "playing") return;
  await finishRound(room, "timeout");
}

async function finishRound(room, reason) {
  if (state.finishingRound) return;
  state.finishingRound = true;

  try {
    await runTransaction(roomRef(room.roomCode), (latestRoom) => {
      if (!latestRoom || latestRoom.status !== "playing") return latestRoom;

      const host = latestRoom.players[latestRoom.hostId];
      const guesser = latestRoom.players[latestRoom.guesserId];
      const hostChoice = latestRoom.choices?.[latestRoom.hostId];
      const guesserChoice = latestRoom.choices?.[latestRoom.guesserId];
      let winner = null;

      if (reason === "timeout") {
        if (hostChoice && !guesserChoice) winner = host;
        if (!hostChoice && guesserChoice) winner = guesser;
        if (!winner) {
          winner = Object.values(latestRoom.players).sort((a, b) => a.joinedAt - b.joinedAt)[0];
        }
      } else {
        if (!hostChoice || !guesserChoice) return latestRoom;
        const parity = hostChoice.value % 2 === 0 ? "even" : "odd";
        winner = guesserChoice.value === parity ? guesser : host;
      }

      const players = { ...latestRoom.players };
      players[winner.id] = {
        ...players[winner.id],
        score: (players[winner.id].score || 0) + 1
      };

      return {
        ...latestRoom,
        status: "finished",
        players,
        result: {
          reason,
          winnerId: winner.id,
          winnerName: winner.name,
          number: hostChoice?.value ?? null,
          guess: guesserChoice?.value ?? null
        },
        updatedAt: Date.now()
      };
    });
  } finally {
    state.finishingRound = false;
  }
}

async function nextRound() {
  const room = state.room;
  const nextHostId = room.guesserId;
  const nextGuesserId = room.hostId;
  await update(roomRef(state.roomCode), {
    ...startRoundFields(nextHostId, nextGuesserId, (room.round || 1) + 1),
    updatedAt: serverTimestamp()
  });
}

function startRoundFields(hostId, guesserId, round) {
  return {
    status: "playing",
    round,
    hostId,
    guesserId,
    choices: {},
    result: null,
    roundEndsAt: Date.now() + ROUND_SECONDS * 1000
  };
}

function startTimer() {
  if (state.tick) return;
  state.tick = setInterval(render, 500);
}

function stopTimer() {
  clearInterval(state.tick);
  state.tick = null;
}

function getSecondsLeft(room) {
  return Math.max(0, Math.ceil(((room.roundEndsAt || 0) - Date.now()) / 1000));
}

function canChoose() {
  const room = state.room;
  return room?.status === "playing" && !room.choices?.[state.playerId] && getSecondsLeft(room) > 0;
}

function resultText(room) {
  if (room.result.reason === "timeout") {
    return "시간 초과로 승부가 결정되었습니다.";
  }
  const parity = room.result.number % 2 === 0 ? "짝" : "홀";
  return `선택 숫자 ${room.result.number}, 정답은 ${parity}이었습니다.`;
}

function leaveRoom() {
  state.unsubscribe?.();
  stopTimer();
  state.room = null;
  state.roomCode = "";
  els.gameView.classList.add("hidden");
  els.setupView.classList.remove("hidden");
  setSetupMessage("");
}

function getPlayerName() {
  const name = els.playerNameInput.value.trim();
  if (!name) {
    setSetupMessage("플레이어 이름을 입력해 주세요.");
    return "";
  }
  return name;
}

async function createUniqueRoomCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const roomCode = Math.random().toString(36).slice(2, 8).toUpperCase();
    const snapshot = await get(roomRef(roomCode));
    if (!snapshot.exists()) return roomCode;
  }
  throw new Error("방 코드를 만들지 못했습니다. 다시 시도해 주세요.");
}

function roomRef(roomCode) {
  return ref(db, `${roomsPath}/${normalizeRoomCode(roomCode)}`);
}

function normalizeRoomCode(value) {
  return value.trim().toUpperCase();
}

function setSetupMessage(message) {
  els.setupMessage.textContent = message;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}
