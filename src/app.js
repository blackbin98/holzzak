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

const roomsPath = "rooms";
const TOTAL_ROUNDS = 10;
const ATTACKS_PER_PLAYER = 5;
const savedPlayerId = localStorage.getItem("holzzakPlayerId");

const state = {
  roomKey: "",
  playerId: savedPlayerId?.length === 8 ? savedPlayerId : crypto.randomUUID().slice(0, 8),
  unsubscribe: null,
  room: null,
  audioContext: null,
  lastSoundKey: "",
  celebratedRoom: ""
};

localStorage.setItem("holzzakPlayerId", state.playerId);

const els = {
  setupView: document.querySelector("#setupView"),
  gameView: document.querySelector("#gameView"),
  playerNameInput: document.querySelector("#playerNameInput"),
  roomNameInput: document.querySelector("#roomNameInput"),
  roomPasswordInput: document.querySelector("#roomPasswordInput"),
  createRoomButton: document.querySelector("#createRoomButton"),
  joinRoomButton: document.querySelector("#joinRoomButton"),
  setupMessage: document.querySelector("#setupMessage"),
  roomNameDisplay: document.querySelector("#roomNameDisplay"),
  playersList: document.querySelector("#playersList"),
  leaveButton: document.querySelector("#leaveButton"),
  roleLabel: document.querySelector("#roleLabel"),
  roundTitle: document.querySelector("#roundTitle"),
  roundCounter: document.querySelector("#roundCounter"),
  statusNotice: document.querySelector("#statusNotice"),
  numberControls: document.querySelector("#numberControls"),
  guessControls: document.querySelector("#guessControls"),
  numberChoices: document.querySelector("#numberChoices"),
  choiceStatus: document.querySelector("#choiceStatus"),
  winnerBanner: document.querySelector("#winnerBanner"),
  winnerName: document.querySelector("#winnerName"),
  winnerMessage: document.querySelector("#winnerMessage"),
  nextRoundButton: document.querySelector("#nextRoundButton"),
  confettiLayer: document.querySelector("#confettiLayer")
};

for (let number = 1; number <= 10; number += 1) {
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

els.roomPasswordInput.addEventListener("input", () => {
  els.roomPasswordInput.value = els.roomPasswordInput.value.replace(/\D/g, "").slice(0, 4);
});

async function createRoom() {
  const form = getSetupForm();
  if (!form) return;

  playSound("pop");
  setSetupMessage("방을 만들고 있어요...");

  const snapshot = await get(roomRef(form.roomKey));
  if (snapshot.exists()) {
    setSetupMessage("이미 같은 이름의 방이 있어요. 다른 방 이름을 써주세요.");
    playSound("error");
    return;
  }

  await set(roomRef(form.roomKey), {
    key: form.roomKey,
    name: form.roomName,
    password: form.password,
    status: "waiting",
    round: 0,
    hostId: state.playerId,
    guesserId: "",
    createdAt: Date.now(),
    players: {
      [state.playerId]: {
        name: form.playerName,
        joinedAt: Date.now(),
        score: 0,
        marks: [],
        attacks: 0
      }
    },
    choices: {},
    result: null
  });

  subscribe(form.roomKey);
}

async function joinRoom() {
  const form = getSetupForm();
  if (!form) return;

  playSound("pop");
  setSetupMessage("방을 찾고 있어요...");

  const snapshot = await get(roomRef(form.roomKey));
  if (!snapshot.exists()) {
    setSetupMessage("해당 이름의 방을 찾을 수 없어요.");
    playSound("error");
    return;
  }

  const room = snapshot.val();
  if (room.password !== form.password) {
    setSetupMessage("비밀번호가 맞지 않아요.");
    playSound("error");
    return;
  }

  const players = room.players || {};
  const isReturning = Boolean(players[state.playerId]);
  if (Object.keys(players).length >= 2 && !isReturning) {
    setSetupMessage("이미 두 명이 경기 중인 방이에요.");
    playSound("error");
    return;
  }

  const nextPlayers = {
    ...players,
    [state.playerId]: {
      name: form.playerName,
      joinedAt: players[state.playerId]?.joinedAt || Date.now(),
      score: players[state.playerId]?.score || 0,
      marks: players[state.playerId]?.marks || [],
      attacks: players[state.playerId]?.attacks || 0
    }
  };
  const ids = Object.keys(nextPlayers).sort((a, b) => nextPlayers[a].joinedAt - nextPlayers[b].joinedAt);
  const hostId = room.hostId || ids[0];
  const guesserId = ids.find((id) => id !== hostId) || "";
  const updates = {
    players: nextPlayers,
    hostId,
    guesserId
  };

  if (ids.length === 2 && room.status === "waiting") {
    Object.assign(updates, startRoundFields(hostId, guesserId, 1));
  }

  await update(roomRef(form.roomKey), updates);
  subscribe(form.roomKey);
}

function subscribe(roomKey) {
  state.roomKey = roomKey;
  state.unsubscribe?.();
  state.unsubscribe = onValue(roomRef(roomKey), (snapshot) => {
    if (!snapshot.exists()) {
      setSetupMessage("방이 사라졌어요. 다시 만들어 주세요.");
      resetToSetup();
      return;
    }
    state.room = snapshot.val();
    render();
  });
}

function render() {
  const room = state.room;
  if (!room) return;

  const players = orderedPlayers(room);
  const me = room.players?.[state.playerId];
  const opponent = players.find((player) => player.id !== state.playerId);
  const isHost = room.hostId === state.playerId;
  const isGuesser = room.guesserId === state.playerId;
  const hostChoice = room.choices?.[room.hostId];
  const guesserChoice = room.choices?.[room.guesserId];
  const isMyTurnToNumber = room.status === "playing" && isHost && hostChoice === undefined;
  const isMyTurnToGuess = room.status === "playing" && isGuesser && hostChoice !== undefined && guesserChoice === undefined;

  els.setupView.classList.add("hidden");
  els.gameView.classList.remove("hidden");
  els.roomNameDisplay.textContent = room.name;
  els.roundCounter.textContent = `${Math.min(room.round || 0, TOTAL_ROUNDS)}/${TOTAL_ROUNDS}`;
  els.playersList.innerHTML = players.map(scoreboardRow).join("");

  els.numberControls.classList.toggle("hidden", !isMyTurnToNumber);
  els.guessControls.classList.toggle("hidden", !isMyTurnToGuess);
  els.nextRoundButton.classList.toggle("hidden", room.status !== "roundResult" || !me);
  els.winnerBanner.classList.toggle("hidden", room.status !== "gameOver");

  if (room.status === "waiting") {
    els.roleLabel.textContent = "친구 대기 중";
    els.roundTitle.textContent = "두 번째 플레이어를 기다리고 있어요";
    els.statusNotice.textContent = "상대가 같은 방 이름과 비밀번호로 입장하면 선공은 방장, 후공은 입장한 사람이 됩니다.";
    els.choiceStatus.textContent = "";
    return;
  }

  if (room.status === "playing") {
    els.roleLabel.textContent = isHost ? "숫자 내는 차례" : "홀짝 맞히는 차례";
    els.roundTitle.textContent = `${room.round}라운드 - ${playerName(room, room.hostId)}의 문제`;
    els.statusNotice.textContent = playingNotice(room, state.playerId);
    els.choiceStatus.textContent = choiceStatus(room, state.playerId);
    playTransitionSound(room);
    return;
  }

  if (room.status === "roundResult" && room.result) {
    const parity = room.result.number % 2 === 0 ? "짝" : "홀";
    els.roleLabel.textContent = "라운드 결과";
    els.roundTitle.textContent = `${room.round}라운드 결과`;
    els.statusNotice.textContent = `${playerName(room, room.hostId)}의 숫자는 ${room.result.number}, 정답은 ${parity}!`;
    els.choiceStatus.textContent = `${playerName(room, room.result.winnerId)} 승리. 다음 라운드에서는 공수가 바뀝니다.`;
    playTransitionSound(room);
    return;
  }

  if (room.status === "gameOver" && room.result) {
    const isDraw = room.result.draw;
    const winner = playerName(room, room.result.winnerId);
    els.roleLabel.textContent = "경기 종료";
    els.roundTitle.textContent = "최종 결과";
    els.statusNotice.textContent = isDraw ? "동점이에요. 둘 다 멋진 승부였어요!" : `${winner}의 승리예요!`;
    els.choiceStatus.textContent = "총 10라운드, 각자 5번씩 문제를 냈어요.";
    els.winnerName.textContent = isDraw ? "무승부!" : `${winner} 승리!`;
    els.winnerMessage.textContent = isDraw ? "하이파이브하고 한 판 더 가도 좋아요." : "축하해요! 말랑한 폭죽이 팡팡!";
    celebrateOnce(room.key);
  }
}

async function chooseNumber(number) {
  const room = state.room;
  if (!room || room.status !== "playing" || room.hostId !== state.playerId || room.choices?.[room.hostId] !== undefined) return;
  playSound("select");
  await update(roomRef(state.roomKey), { [`choices/${state.playerId}`]: number });
}

async function chooseGuess(guess) {
  const room = state.room;
  if (!room || room.status !== "playing" || room.guesserId !== state.playerId) return;
  if (room.choices?.[room.hostId] === undefined || room.choices?.[room.guesserId] !== undefined) return;

  playSound("select");
  await runTransaction(roomRef(state.roomKey), (latestRoom) => {
    if (!latestRoom || latestRoom.status !== "playing") return latestRoom;
    const number = latestRoom.choices?.[latestRoom.hostId];
    if (number === undefined || latestRoom.choices?.[latestRoom.guesserId] !== undefined) return latestRoom;

    const answer = number % 2 === 0 ? "even" : "odd";
    const winnerId = guess === answer ? latestRoom.guesserId : latestRoom.hostId;
    const loserId = winnerId === latestRoom.hostId ? latestRoom.guesserId : latestRoom.hostId;
    const players = clonePlayers(latestRoom.players);

    players[winnerId].score = (players[winnerId].score || 0) + 1;
    players[winnerId].marks = [...(players[winnerId].marks || []), "O"];
    players[loserId].marks = [...(players[loserId].marks || []), "X"];
    players[latestRoom.hostId].attacks = (players[latestRoom.hostId].attacks || 0) + 1;

    return {
      ...latestRoom,
      status: latestRoom.round >= TOTAL_ROUNDS ? "gameOver" : "roundResult",
      players,
      choices: {
        ...latestRoom.choices,
        [latestRoom.guesserId]: guess
      },
      result: buildResult(latestRoom, players, winnerId, guess)
    };
  });
}

async function nextRound() {
  const room = state.room;
  if (!room || room.status !== "roundResult") return;
  const nextRoundNumber = (room.round || 0) + 1;
  const updates = nextRoundNumber > TOTAL_ROUNDS
    ? gameOverFields(room)
    : startRoundFields(room.guesserId, room.hostId, nextRoundNumber);
  playSound("pop");
  await update(roomRef(state.roomKey), updates);
}

function startRoundFields(hostId, guesserId, round) {
  return {
    status: "playing",
    round,
    hostId,
    guesserId,
    choices: {},
    result: null
  };
}

function gameOverFields(room) {
  const players = orderedPlayers(room);
  const [first, second] = players;
  const draw = (first?.score || 0) === (second?.score || 0);
  const winnerId = draw ? "" : (first.score > second.score ? first.id : second.id);
  return {
    status: "gameOver",
    result: {
      ...room.result,
      winnerId,
      draw
    }
  };
}

function buildResult(room, players, winnerId, guess) {
  const sortedPlayers = Object.entries(players || {}).map(([id, player]) => ({ id, ...player }));
  const [first, second] = sortedPlayers;
  const draw = (first?.score || 0) === (second?.score || 0);
  const leadingId = draw ? "" : ((first?.score || 0) > (second?.score || 0) ? first.id : second.id);

  return {
    number: room.choices[room.hostId],
    guess,
    winnerId: room.round >= TOTAL_ROUNDS ? leadingId : winnerId,
    roundWinnerId: winnerId,
    draw: room.round >= TOTAL_ROUNDS ? draw : false
  };
}

async function leaveRoom() {
  const roomKey = state.roomKey;
  const isHost = state.room?.hostId === state.playerId;
  resetToSetup();

  if (roomKey && isHost) {
    await remove(roomRef(roomKey));
  }
}

function resetToSetup() {
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.room = null;
  state.roomKey = "";
  state.celebratedRoom = "";
  els.gameView.classList.add("hidden");
  els.setupView.classList.remove("hidden");
  els.winnerBanner.classList.add("hidden");
  els.confettiLayer.innerHTML = "";
}

function getSetupForm() {
  const playerName = els.playerNameInput.value.trim().slice(0, 14);
  const roomName = els.roomNameInput.value.trim().slice(0, 24);
  const password = els.roomPasswordInput.value.trim();

  if (!playerName) {
    setSetupMessage("닉네임을 입력해 주세요.");
    return null;
  }
  if (!roomName) {
    setSetupMessage("방 이름을 입력해 주세요.");
    return null;
  }
  if (!/^\d{4}$/.test(password)) {
    setSetupMessage("비밀번호는 숫자 4자리여야 해요.");
    return null;
  }

  return {
    playerName,
    roomName,
    roomKey: roomNameToKey(roomName),
    password
  };
}

function roomNameToKey(roomName) {
  const bytes = new TextEncoder().encode(roomName.trim().toLowerCase());
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function roomRef(roomKey) {
  return ref(db, `${roomsPath}/${roomKey}`);
}

function orderedPlayers(room) {
  return Object.entries(room.players || {})
    .map(([id, player]) => ({ id, ...player }))
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
}

function clonePlayers(players) {
  return Object.fromEntries(
    Object.entries(players || {}).map(([id, player]) => [
      id,
      {
        ...player,
        score: player.score || 0,
        marks: [...(player.marks || [])],
        attacks: player.attacks || 0
      }
    ])
  );
}

function scoreboardRow(player) {
  const marks = Array.from({ length: TOTAL_ROUNDS }, (_, index) => {
    const mark = player.marks?.[index] || "";
    return `<span class="mark ${mark === "O" ? "win" : mark === "X" ? "lose" : ""}">${mark}</span>`;
  }).join("");

  return `
    <div class="player-card">
      <div class="player-main">
        <span>${escapeHtml(player.name)}</span>
        <strong>${player.score || 0}</strong>
      </div>
      <div class="marks" aria-label="${escapeHtml(player.name)}의 승패 기록">${marks}</div>
      <small>문제 낸 횟수 ${player.attacks || 0}/${ATTACKS_PER_PLAYER}</small>
    </div>
  `;
}

function playingNotice(room, myId) {
  const hostName = playerName(room, room.hostId);
  const guesserName = playerName(room, room.guesserId);
  const hostChoice = room.choices?.[room.hostId];

  if (hostChoice === undefined) {
    return myId === room.hostId
      ? "당신 차례예요. 숫자를 하나 고르면 상대에게 홀/짝 선택지가 열려요."
      : `${hostName}님이 숫자를 고르는 중이에요. 잠시만 기다려 주세요.`;
  }

  return myId === room.guesserId
    ? `${hostName}님이 숫자를 골랐어요. 이제 홀/짝을 선택해 주세요.`
    : `${guesserName}님이 홀/짝을 고르는 중이에요. 두근두근 기다려요.`;
}

function choiceStatus(room, myId) {
  if (room.choices?.[myId] !== undefined) return "선택 완료! 상대의 선택을 기다리는 중이에요.";
  if (myId === room.hostId) return "숫자 1부터 10 중 하나를 고르세요.";
  if (room.choices?.[room.hostId] === undefined) return "상대가 숫자를 선택하면 버튼이 나타나요.";
  return "홀 또는 짝을 골라 정답을 맞혀보세요.";
}

function playerName(room, playerId) {
  return room.players?.[playerId]?.name || "상대";
}

function setSetupMessage(message) {
  els.setupMessage.textContent = message;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

function playTransitionSound(room) {
  const soundKey = `${room.key}:${room.status}:${room.round}:${room.choices?.[room.hostId] ?? "n"}:${room.choices?.[room.guesserId] ?? "g"}`;
  if (state.lastSoundKey === soundKey) return;
  state.lastSoundKey = soundKey;

  if (room.status === "roundResult") playSound("result");
  if (room.status === "playing" && room.choices?.[room.hostId] !== undefined) playSound("pop");
}

function playSound(type) {
  const context = getAudioContext();
  if (!context) return;

  const now = context.currentTime;
  const notes = {
    pop: [523.25, 659.25],
    select: [783.99, 987.77],
    result: [659.25, 783.99, 1046.5],
    win: [523.25, 659.25, 783.99, 1046.5],
    error: [220, 196]
  }[type] || [440];

  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type === "error" ? "sawtooth" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + index * 0.08);
    gain.gain.exponentialRampToValueAtTime(type === "error" ? 0.05 : 0.08, now + index * 0.08 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.08 + 0.16);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now + index * 0.08);
    oscillator.stop(now + index * 0.08 + 0.18);
  });
}

function getAudioContext() {
  if (!window.AudioContext && !window.webkitAudioContext) return null;
  state.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  if (state.audioContext.state === "suspended") state.audioContext.resume();
  return state.audioContext;
}

function celebrateOnce(roomKey) {
  if (state.celebratedRoom === roomKey) return;
  state.celebratedRoom = roomKey;
  playSound("win");
  launchConfetti();
}

function launchConfetti() {
  els.confettiLayer.innerHTML = "";
  const colors = ["#ff6b8a", "#ffd166", "#65d6ad", "#7cc7ff", "#b794ff"];
  for (let index = 0; index < 90; index += 1) {
    const piece = document.createElement("span");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[index % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.45}s`;
    piece.style.animationDuration = `${2 + Math.random() * 1.8}s`;
    piece.style.setProperty("--drift", `${Math.random() * 160 - 80}px`);
    els.confettiLayer.append(piece);
  }
  window.setTimeout(() => {
    els.confettiLayer.innerHTML = "";
  }, 4200);
}
