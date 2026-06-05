import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  onValue,
  runTransaction,
  remove
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const ROUND_SECONDS = 30;
const roomsPath = "r";
const savedPlayerId = localStorage.getItem("oddEvenPlayerId");

const state = {
  roomCode: "",
  playerId: savedPlayerId?.length === 8 ? savedPlayerId : crypto.randomUUID().slice(0, 8),
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
  button.addEventListener("click", () => chooseGuess(button.dataset.guess === "even" ? 0 : 1));
});

els.createRoomButton.addEventListener("click", createRoom);
els.joinRoomButton.addEventListener("click", joinRoom);
els.nextRoundButton.addEventListener("click", nextRound);
els.leaveButton.addEventListener("click", leaveRoom);

async function createRoom() {
  const name = getPlayerName();
  if (!name) return;

  setSetupMessage("방을 만드는 중입니다...");
  const code = await createUniqueRoomCode();
  const now = Date.now();

  await set(roomRef(code), {
    c: code,
    t: "w",
    r: 1,
    h: state.playerId,
    g: "",
    p: {
      [state.playerId]: { n: name, j: now, s: 0 }
    },
    x: {},
    z: null,
    e: 0
  });

  subscribe(code);
}

async function joinRoom() {
  const name = getPlayerName();
  const code = normalizeRoomCode(els.roomCodeInput.value);
  if (!name || !code) {
    setSetupMessage("이름과 방 코드를 모두 입력해 주세요.");
    return;
  }

  const snapshot = await get(roomRef(code));
  if (!snapshot.exists()) {
    setSetupMessage("방을 찾을 수 없습니다.");
    return;
  }

  const room = snapshot.val();
  const players = room.p || {};
  const playerIds = Object.keys(players);
  const isReturning = Boolean(players[state.playerId]);

  if (playerIds.length >= 2 && !isReturning) {
    setSetupMessage("이미 두 명이 플레이 중인 방입니다.");
    return;
  }

  const nextPlayers = {
    ...players,
    [state.playerId]: {
      n: name,
      j: players[state.playerId]?.j || Date.now(),
      s: players[state.playerId]?.s || 0
    }
  };

  const ids = Object.keys(nextPlayers);
  const hostId = room.h || ids[0];
  const guesserId = ids.find((id) => id !== hostId) || "";
  const updates = {
    p: nextPlayers,
    g: guesserId
  };

  if (ids.length === 2 && room.t === "w") {
    Object.assign(updates, startRoundFields(hostId, guesserId, room.r || 1));
  }

  await update(roomRef(code), updates);
  subscribe(code);
}

function subscribe(code) {
  state.roomCode = code;
  state.unsubscribe?.();
  state.unsubscribe = onValue(roomRef(code), (snapshot) => {
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
  const players = Object.entries(room.p || {}).map(([id, player]) => ({ id, ...player }));
  const me = room.p?.[state.playerId];
  const opponent = players.find((player) => player.id !== state.playerId);
  const isHost = room.h === state.playerId;
  const isGuesser = room.g === state.playerId;
  const myChoice = room.x?.[state.playerId];
  const secondsLeft = getSecondsLeft(room);

  els.setupView.classList.add("hidden");
  els.gameView.classList.remove("hidden");
  els.roomCodeDisplay.textContent = room.c;
  els.playersList.innerHTML = players
    .map((player) => `<div class="player-row"><span>${escapeHtml(player.n)}</span><strong>${player.s || 0}</strong></div>`)
    .join("");

  els.waitingNotice.classList.toggle("hidden", room.t !== "w");
  els.hostControls.classList.toggle("hidden", room.t !== "p" || !isHost || myChoice !== undefined);
  els.guesserControls.classList.toggle("hidden", room.t !== "p" || !isGuesser || myChoice !== undefined);
  els.nextRoundButton.classList.toggle("hidden", room.t !== "f" || !me);
  els.winnerBanner.classList.toggle("hidden", room.t !== "f");

  if (room.t === "w") {
    els.roleLabel.textContent = "대기 중";
    els.roundTitle.textContent = "상대가 들어오길 기다리는 중";
    els.choiceStatus.textContent = "";
    els.timer.textContent = String(ROUND_SECONDS);
    stopTimer();
    return;
  }

  if (room.t === "p") {
    els.roleLabel.textContent = isHost ? "숫자 선택" : "홀짝 맞히기";
    els.roundTitle.textContent = `${room.r}라운드 · ${opponent?.n || "상대"}와 대결`;
    els.choiceStatus.textContent = myChoice !== undefined
      ? "선택 완료. 상대의 선택을 기다리는 중입니다."
      : "30초 안에 선택하세요.";
    els.timer.textContent = String(secondsLeft);
    startTimer();
    if (secondsLeft <= 0) finishRoundByTimeout();
  }

  if (room.t === "f" && room.z) {
    stopTimer();
    els.timer.textContent = "0";
    els.roleLabel.textContent = "승부 완료";
    els.roundTitle.textContent = `${room.r}라운드 결과`;
    els.choiceStatus.textContent = resultText(room);
    els.winnerName.textContent = `${winnerName(room)} 승리!`;
    els.winnerMessage.textContent = "축하합니다. 멋진 한 판이었어요!";
  }
}

async function chooseNumber(number) {
  if (!canChoose()) return;
  await update(roomRef(state.roomCode), { [`x/${state.playerId}`]: number });
  await maybeFinishRound();
}

async function chooseGuess(guess) {
  if (!canChoose()) return;
  await update(roomRef(state.roomCode), { [`x/${state.playerId}`]: guess });
  await maybeFinishRound();
}

async function maybeFinishRound() {
  const snapshot = await get(roomRef(state.roomCode));
  if (!snapshot.exists()) return;
  const room = snapshot.val();
  if (room.t !== "p") return;
  if (room.x?.[room.h] === undefined || room.x?.[room.g] === undefined) return;
  await finishRound(room, "choice");
}

async function finishRoundByTimeout() {
  const room = state.room;
  if (!room || room.t !== "p") return;
  await finishRound(room, "timeout");
}

async function finishRound(room, reason) {
  if (state.finishingRound) return;
  state.finishingRound = true;

  try {
    await runTransaction(roomRef(room.c), (latestRoom) => {
      if (!latestRoom || latestRoom.t !== "p") return latestRoom;

      const hostChoice = latestRoom.x?.[latestRoom.h];
      const guesserChoice = latestRoom.x?.[latestRoom.g];
      let winnerId = "";

      if (reason === "timeout") {
        if (hostChoice !== undefined && guesserChoice === undefined) winnerId = latestRoom.h;
        if (hostChoice === undefined && guesserChoice !== undefined) winnerId = latestRoom.g;
        if (!winnerId) {
          winnerId = Object.entries(latestRoom.p).sort((a, b) => a[1].j - b[1].j)[0][0];
        }
      } else {
        if (hostChoice === undefined || guesserChoice === undefined) return latestRoom;
        winnerId = guesserChoice === hostChoice % 2 ? latestRoom.g : latestRoom.h;
      }

      const players = { ...latestRoom.p };
      players[winnerId] = {
        ...players[winnerId],
        s: (players[winnerId].s || 0) + 1
      };

      return {
        ...latestRoom,
        t: "f",
        p: players,
        z: {
          w: winnerId,
          n: hostChoice ?? -1,
          q: guesserChoice ?? -1,
          o: reason === "timeout" ? 1 : 0
        }
      };
    });
  } finally {
    state.finishingRound = false;
  }
}

async function nextRound() {
  const room = state.room;
  await update(roomRef(state.roomCode), startRoundFields(room.g, room.h, (room.r || 1) + 1));
}

function startRoundFields(hostId, guesserId, round) {
  return {
    t: "p",
    r: round,
    h: hostId,
    g: guesserId,
    x: {},
    z: null,
    e: Date.now() + ROUND_SECONDS * 1000
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
  return Math.max(0, Math.ceil(((room.e || 0) - Date.now()) / 1000));
}

function canChoose() {
  const room = state.room;
  return room?.t === "p" && room.x?.[state.playerId] === undefined && getSecondsLeft(room) > 0;
}

function resultText(room) {
  if (room.z.o === 1) {
    return "시간 초과로 승부가 결정되었습니다.";
  }
  const parity = room.z.n % 2 === 0 ? "짝" : "홀";
  return `선택 숫자 ${room.z.n}, 정답은 ${parity}이었습니다.`;
}

async function leaveRoom() {
  const code = state.roomCode;
  state.unsubscribe?.();
  stopTimer();
  state.room = null;
  state.roomCode = "";
  els.gameView.classList.add("hidden");
  els.setupView.classList.remove("hidden");
  setSetupMessage("");

  if (code) {
    const snapshot = await get(roomRef(code));
    const room = snapshot.val();
    if (room?.h === state.playerId) {
      await remove(roomRef(code));
    }
  }
}

function getPlayerName() {
  const name = els.playerNameInput.value.trim().slice(0, 14);
  if (!name) {
    setSetupMessage("플레이어 이름을 입력해 주세요.");
    return "";
  }
  return name;
}

async function createUniqueRoomCode() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const snapshot = await get(roomRef(code));
    if (!snapshot.exists()) return code;
  }
  throw new Error("방 코드를 만들지 못했습니다. 다시 시도해 주세요.");
}

function roomRef(code) {
  return ref(db, `${roomsPath}/${normalizeRoomCode(code)}`);
}

function normalizeRoomCode(value) {
  return value.trim().toUpperCase();
}

function winnerName(room) {
  return room.p?.[room.z.w]?.n || "승자";
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
