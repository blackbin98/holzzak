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
const ROUND_SECONDS = 30;
const savedPlayerId = localStorage.getItem("holzzakPlayerId");

const state = {
  roomKey: "",
  playerId: savedPlayerId?.length === 8 ? savedPlayerId : crypto.randomUUID().slice(0, 8),
  unsubscribe: null,
  room: null,
  tick: null,
  audioContext: null,
  musicTimer: null,
  musicOn: localStorage.getItem("holzzakMusicOn") === "1",
  lastSoundKey: "",
  celebratedRoom: "",
  finishingRound: false
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
  musicToggleButton: document.querySelector("#musicToggleButton"),
  gameMusicButton: document.querySelector("#gameMusicButton"),
  setupMessage: document.querySelector("#setupMessage"),
  roomNameDisplay: document.querySelector("#roomNameDisplay"),
  playersList: document.querySelector("#playersList"),
  leaveButton: document.querySelector("#leaveButton"),
  roleLabel: document.querySelector("#roleLabel"),
  roundTitle: document.querySelector("#roundTitle"),
  roundCounter: document.querySelector("#roundCounter"),
  timerDisplay: document.querySelector("#timerDisplay"),
  statusNotice: document.querySelector("#statusNotice"),
  numberControls: document.querySelector("#numberControls"),
  guessControls: document.querySelector("#guessControls"),
  numberChoices: document.querySelector("#numberChoices"),
  choiceStatus: document.querySelector("#choiceStatus"),
  nextRoundButton: document.querySelector("#nextRoundButton"),
  resultModal: document.querySelector("#resultModal"),
  resultIcon: document.querySelector("#resultIcon"),
  resultModalTitle: document.querySelector("#resultModalTitle"),
  resultModalMessage: document.querySelector("#resultModalMessage"),
  backToLobbyButton: document.querySelector("#backToLobbyButton"),
  confettiLayer: document.querySelector("#confettiLayer")
};

for (let number = 1; number <= 10; number += 1) {
  const button = document.createElement("button");
  button.className = "number-button";
  button.type = "button";
  button.innerHTML = `<span>${number}</span>`;
  button.addEventListener("click", () => chooseNumber(number));
  els.numberChoices.append(button);
}

document.querySelectorAll("[data-guess]").forEach((button) => {
  button.addEventListener("click", () => chooseGuess(button.dataset.guess));
});

els.createRoomButton.addEventListener("click", createRoom);
els.joinRoomButton.addEventListener("click", joinRoom);
els.nextRoundButton.addEventListener("click", markReadyForNextRound);
els.leaveButton.addEventListener("click", leaveRoom);
els.backToLobbyButton.addEventListener("click", leaveRoom);
els.musicToggleButton.addEventListener("click", toggleMusic);
els.gameMusicButton.addEventListener("click", toggleMusic);

window.addEventListener("pointerdown", () => {
  if (state.musicOn) startMusic();
}, { once: true });

els.roomPasswordInput.addEventListener("input", () => {
  els.roomPasswordInput.value = els.roomPasswordInput.value.replace(/\D/g, "").slice(0, 4);
});

syncMusicButtons();

async function createRoom() {
  const form = getSetupForm();
  if (!form) return;

  startMusic();
  playSound("start");
  setSetupMessage("좋아요. 방을 여는 중이에요.");

  const snapshot = await get(roomRef(form.roomKey));
  if (snapshot.exists()) {
    setSetupMessage("이미 같은 이름의 방이 있어요. 다른 이름으로 만들어 주세요.");
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
    endAt: 0,
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
    roundReady: {},
    result: null
  });

  subscribe(form.roomKey);
}

async function joinRoom() {
  const form = getSetupForm();
  if (!form) return;

  startMusic();
  playSound("start");
  setSetupMessage("방을 찾고 있어요.");

  const snapshot = await get(roomRef(form.roomKey));
  if (!snapshot.exists()) {
    setSetupMessage("그 이름의 방은 아직 없어요. 방 이름을 다시 확인해 주세요.");
    playSound("error");
    return;
  }

  const room = snapshot.val();
  if (room.password !== form.password) {
    setSetupMessage("비밀번호가 맞지 않아요. 숫자 4자리를 다시 확인해 주세요.");
    playSound("error");
    return;
  }

  const players = room.players || {};
  const isReturning = Boolean(players[state.playerId]);
  if (Object.keys(players).length >= 2 && !isReturning) {
    setSetupMessage("이미 두 명이 대결 중인 방이에요.");
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
      setSetupMessage("방이 닫혔어요. 새 방을 만들어 다시 시작해 주세요.");
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
  const isHost = room.hostId === state.playerId;
  const isGuesser = room.guesserId === state.playerId;
  const hostChoice = room.choices?.[room.hostId];
  const guesserChoice = room.choices?.[room.guesserId];
  const secondsLeft = getSecondsLeft(room);
  const isMyTurnToNumber = room.status === "playing" && isHost && hostChoice === undefined;
  const isMyTurnToGuess = room.status === "playing" && isGuesser && hostChoice !== undefined && guesserChoice === undefined;

  els.setupView.classList.add("hidden");
  els.gameView.classList.remove("hidden");
  els.resultModal.classList.toggle("hidden", room.status !== "gameOver");
  els.roomNameDisplay.textContent = room.name;
  els.roundCounter.textContent = `${Math.min(room.round || 0, TOTAL_ROUNDS)}/${TOTAL_ROUNDS}`;
  els.timerDisplay.textContent = room.status === "playing" ? String(secondsLeft) : "--";
  els.timerDisplay.classList.toggle("danger", room.status === "playing" && secondsLeft <= 8);
  els.playersList.innerHTML = players.map((player) => scoreboardRow(player, room)).join("");

  els.numberControls.classList.toggle("hidden", !isMyTurnToNumber);
  els.guessControls.classList.toggle("hidden", !isMyTurnToGuess);
  els.nextRoundButton.classList.toggle("hidden", room.status !== "roundResult" || !me);
  els.nextRoundButton.disabled = Boolean(room.roundReady?.[state.playerId]);
  els.nextRoundButton.textContent = room.roundReady?.[state.playerId]
    ? "상대 준비를 기다리는 중"
    : "다음 라운드 준비";

  if (room.status === "playing") startTimer();
  else stopTimer();

  if (room.status === "waiting") {
    els.roleLabel.textContent = "친구 대기 중";
    els.roundTitle.textContent = "아직 한 명이 더 필요해요";
    els.statusNotice.textContent = "친구에게 방 이름과 4자리 비밀번호를 알려주세요. 둘이 모이면 바로 첫 라운드가 시작됩니다.";
    els.choiceStatus.textContent = "";
    return;
  }

  if (room.status === "playing") {
    els.roleLabel.textContent = isHost ? "카드 선택" : "홀짝 선택";
    els.roundTitle.textContent = `${room.round}라운드 · ${playerName(room, room.hostId)}의 선택`;
    els.statusNotice.textContent = playingNotice(room, state.playerId);
    els.choiceStatus.textContent = choiceStatus(room, state.playerId);
    playTransitionSound(room);
    if (secondsLeft <= 0) finishRoundByTimeout();
    return;
  }

  if (room.status === "roundResult" && room.result) {
    const parity = room.result.number % 2 === 0 ? "짝" : "홀";
    const winner = playerName(room, room.result.roundWinnerId);
    const readyCount = Object.keys(room.roundReady || {}).length;
    els.roleLabel.textContent = "라운드 결과";
    els.roundTitle.textContent = `${room.round}라운드 결과`;
    els.statusNotice.textContent = `${playerName(room, room.hostId)}의 카드는 ${room.result.number}. 정답은 ${parity}이었습니다.`;
    els.choiceStatus.textContent = `${winner} 승리! 다음 라운드는 두 사람 모두 준비를 눌러야 시작됩니다. (${readyCount}/2)`;
    playTransitionSound(room);
    return;
  }

  if (room.status === "gameOver" && room.result) {
    const isDraw = room.result.draw;
    const didWin = !isDraw && room.result.winnerId === state.playerId;
    const winner = playerName(room, room.result.winnerId);
    els.roleLabel.textContent = "경기 종료";
    els.roundTitle.textContent = "운명이 결정됐습니다";
    els.statusNotice.textContent = isDraw ? "동점입니다. 끝까지 팽팽했어요." : `${winner}님이 최종 승리했습니다.`;
    els.choiceStatus.textContent = "수고했어요. 다시 도전하고 싶다면 새 방으로 시작해 주세요.";
    renderFinalModal(isDraw, didWin, winner);
    celebrateOnce(room.key, didWin, isDraw);
  }
}

async function chooseNumber(number) {
  const room = state.room;
  if (!room || room.status !== "playing" || room.hostId !== state.playerId || room.choices?.[room.hostId] !== undefined) return;
  playSound("card");
  await update(roomRef(state.roomKey), { [`choices/${state.playerId}`]: number });
}

async function chooseGuess(guess) {
  const room = state.room;
  if (!room || room.status !== "playing" || room.guesserId !== state.playerId) return;
  if (room.choices?.[room.hostId] === undefined || room.choices?.[room.guesserId] !== undefined) return;

  playSound("select");
  await finishRound(room, "choice", guess);
}

async function finishRoundByTimeout() {
  const room = state.room;
  if (!room || room.status !== "playing") return;
  await finishRound(room, "timeout", "");
}

async function finishRound(room, reason, guess) {
  if (state.finishingRound) return;
  state.finishingRound = true;

  try {
    await runTransaction(roomRef(room.key), (latestRoom) => {
      if (!latestRoom || latestRoom.status !== "playing") return latestRoom;

      const number = latestRoom.choices?.[latestRoom.hostId];
      const finalGuess = reason === "timeout" ? latestRoom.choices?.[latestRoom.guesserId] : guess;
      if (reason === "choice" && (number === undefined || latestRoom.choices?.[latestRoom.guesserId] !== undefined)) return latestRoom;

      let winnerId = "";
      if (reason === "timeout") {
        winnerId = number === undefined ? latestRoom.guesserId : latestRoom.hostId;
      } else {
        const answer = number % 2 === 0 ? "even" : "odd";
        winnerId = finalGuess === answer ? latestRoom.guesserId : latestRoom.hostId;
      }

      const loserId = winnerId === latestRoom.hostId ? latestRoom.guesserId : latestRoom.hostId;
      const players = clonePlayers(latestRoom.players);
      players[winnerId].score = (players[winnerId].score || 0) + 1;
      players[winnerId].marks = [...(players[winnerId].marks || []), "O"];
      players[loserId].marks = [...(players[loserId].marks || []), "X"];
      players[latestRoom.hostId].attacks = (players[latestRoom.hostId].attacks || 0) + 1;

      const result = buildResult(latestRoom, players, winnerId, finalGuess || "", reason);
      return {
        ...latestRoom,
        status: latestRoom.round >= TOTAL_ROUNDS ? "gameOver" : "roundResult",
        players,
        choices: {
          ...latestRoom.choices,
          ...(finalGuess ? { [latestRoom.guesserId]: finalGuess } : {})
        },
        roundReady: {},
        result
      };
    });
  } finally {
    state.finishingRound = false;
  }
}

async function markReadyForNextRound() {
  const room = state.room;
  if (!room || room.status !== "roundResult" || room.roundReady?.[state.playerId]) return;
  playSound("ready");

  await runTransaction(roomRef(state.roomKey), (latestRoom) => {
    if (!latestRoom || latestRoom.status !== "roundResult") return latestRoom;
    const nextReady = {
      ...(latestRoom.roundReady || {}),
      [state.playerId]: true
    };
    const playerCount = Object.keys(latestRoom.players || {}).length;
    if (Object.keys(nextReady).length < playerCount) {
      return {
        ...latestRoom,
        roundReady: nextReady
      };
    }

    const nextRoundNumber = (latestRoom.round || 0) + 1;
    if (nextRoundNumber > TOTAL_ROUNDS) {
      return {
        ...latestRoom,
        ...gameOverFields(latestRoom)
      };
    }

    return {
      ...latestRoom,
      ...startRoundFields(latestRoom.guesserId, latestRoom.hostId, nextRoundNumber)
    };
  });
}

function startRoundFields(hostId, guesserId, round) {
  return {
    status: "playing",
    round,
    hostId,
    guesserId,
    choices: {},
    roundReady: {},
    result: null,
    endAt: Date.now() + ROUND_SECONDS * 1000
  };
}

function gameOverFields(room) {
  const players = orderedPlayers(room);
  const [first, second] = players;
  const draw = (first?.score || 0) === (second?.score || 0);
  const winnerId = draw ? "" : ((first?.score || 0) > (second?.score || 0) ? first.id : second.id);
  return {
    status: "gameOver",
    result: {
      ...(room.result || {}),
      winnerId,
      draw
    }
  };
}

function buildResult(room, players, roundWinnerId, guess, reason) {
  const sortedPlayers = Object.entries(players || {}).map(([id, player]) => ({ id, ...player }));
  const [first, second] = sortedPlayers;
  const draw = (first?.score || 0) === (second?.score || 0);
  const leadingId = draw ? "" : ((first?.score || 0) > (second?.score || 0) ? first.id : second.id);

  return {
    number: room.choices?.[room.hostId] || 0,
    guess,
    reason,
    roundWinnerId,
    winnerId: room.round >= TOTAL_ROUNDS ? leadingId : roundWinnerId,
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
  stopTimer();
  els.gameView.classList.add("hidden");
  els.setupView.classList.remove("hidden");
  els.resultModal.classList.add("hidden");
  els.confettiLayer.innerHTML = "";
}

function getSetupForm() {
  const playerName = els.playerNameInput.value.trim().slice(0, 14);
  const roomName = els.roomNameInput.value.trim().slice(0, 24);
  const password = els.roomPasswordInput.value.trim();

  if (!playerName) {
    setSetupMessage("닉네임을 먼저 적어 주세요.");
    return null;
  }
  if (!roomName) {
    setSetupMessage("친구가 찾을 수 있는 방 이름을 정해 주세요.");
    return null;
  }
  if (!/^\d{4}$/.test(password)) {
    setSetupMessage("비밀번호는 숫자 4자리로 입력해 주세요.");
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

function scoreboardRow(player, room) {
  const active = player.id === room.hostId && room.status === "playing" ? "active" : "";
  const marks = Array.from({ length: TOTAL_ROUNDS }, (_, index) => {
    const mark = player.marks?.[index] || "";
    return `<span class="mark ${mark === "O" ? "win" : mark === "X" ? "lose" : ""}">${mark}</span>`;
  }).join("");

  return `
    <div class="player-card ${active}">
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
      ? "당신 차례예요. 1부터 10까지, 상대를 흔들 숫자 하나를 고르세요."
      : `${hostName}님이 카드를 고르는 중이에요. 어떤 숫자가 나올지 지켜보세요.`;
  }

  return myId === room.guesserId
    ? `${hostName}님이 카드를 골랐습니다. 이제 홀인지 짝인지 선택하세요.`
    : `${guesserName}님이 고민 중이에요. 선택이 끝나면 바로 결과가 공개됩니다.`;
}

function choiceStatus(room, myId) {
  if (room.choices?.[myId] !== undefined) return "선택 완료. 이제 상대의 판단을 기다리면 됩니다.";
  if (myId === room.hostId) return "카드를 선택하면 상대에게 홀/짝 버튼이 열립니다.";
  if (room.choices?.[room.hostId] === undefined) return "상대가 카드를 고르면 선택지가 나타납니다.";
  return "홀 또는 짝. 이번 선택이 승부를 가릅니다.";
}

function renderFinalModal(isDraw, didWin, winner) {
  if (isDraw) {
    els.resultIcon.textContent = "⚡";
    els.resultModalTitle.textContent = "무승부!";
    els.resultModalMessage.textContent = "둘 다 끝까지 읽히지 않았어요. 이건 다시 붙어야 하는 승부예요.";
    return;
  }

  if (didWin) {
    els.resultIcon.textContent = "🏆";
    els.resultModalTitle.textContent = "승리했습니다!";
    els.resultModalMessage.textContent = "축하합니다. 오늘의 운명은 당신 편이었어요!";
    return;
  }

  els.resultIcon.textContent = "💥";
  els.resultModalTitle.textContent = "패배했습니다";
  els.resultModalMessage.textContent = `${winner}님이 한 수 앞섰어요. 다음 번엔 더 분발하세요!`;
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

function startTimer() {
  if (state.tick) return;
  state.tick = setInterval(render, 300);
}

function stopTimer() {
  clearInterval(state.tick);
  state.tick = null;
}

function getSecondsLeft(room) {
  if (!room?.endAt) return ROUND_SECONDS;
  return Math.max(0, Math.ceil((room.endAt - Date.now()) / 1000));
}

function playTransitionSound(room) {
  const soundKey = `${room.key}:${room.status}:${room.round}:${room.choices?.[room.hostId] ?? "n"}:${room.choices?.[room.guesserId] ?? "g"}`;
  if (state.lastSoundKey === soundKey) return;
  state.lastSoundKey = soundKey;

  if (room.status === "roundResult") playSound("result");
  if (room.status === "playing" && room.choices?.[room.hostId] !== undefined) playSound("reveal");
}

function toggleMusic() {
  state.musicOn = !state.musicOn;
  localStorage.setItem("holzzakMusicOn", state.musicOn ? "1" : "0");
  if (state.musicOn) {
    startMusic();
    playSound("start");
  } else {
    stopMusic();
  }
  syncMusicButtons();
}

function syncMusicButtons() {
  const label = state.musicOn ? "♪ 음악 끄기" : "♪ 음악 켜기";
  els.musicToggleButton.textContent = label;
  els.gameMusicButton.textContent = label;
}

function startMusic() {
  if (!state.musicOn) {
    state.musicOn = true;
    localStorage.setItem("holzzakMusicOn", "1");
    syncMusicButtons();
  }
  const context = getAudioContext();
  if (!context || state.musicTimer) return;

  let step = 0;
  const melody = [523.25, 659.25, 783.99, 659.25, 587.33, 739.99, 880, 739.99];
  state.musicTimer = setInterval(() => {
    const now = context.currentTime;
    playTone(melody[step % melody.length], now, 0.09, "triangle", 0.028);
    if (step % 2 === 0) playTone(130.81, now, 0.08, "sine", 0.018);
    step += 1;
  }, 260);
}

function stopMusic() {
  clearInterval(state.musicTimer);
  state.musicTimer = null;
}

function playSound(type) {
  const context = getAudioContext();
  if (!context) return;

  const now = context.currentTime;
  const soundMap = {
    start: [[523.25, 0], [783.99, 0.08], [1046.5, 0.16]],
    card: [[392, 0], [587.33, 0.07], [880, 0.14]],
    select: [[880, 0], [1174.66, 0.08]],
    reveal: [[659.25, 0], [493.88, 0.07], [987.77, 0.15]],
    ready: [[659.25, 0], [783.99, 0.07]],
    result: [[523.25, 0], [659.25, 0.07], [783.99, 0.14]],
    win: [[523.25, 0], [659.25, 0.08], [783.99, 0.16], [1046.5, 0.24]],
    lose: [[330, 0], [293.66, 0.1]],
    error: [[220, 0], [196, 0.1]]
  };

  (soundMap[type] || soundMap.select).forEach(([frequency, delay]) => {
    playTone(frequency, now + delay, type === "error" ? 0.18 : 0.14, type === "error" ? "sawtooth" : "sine", type === "error" ? 0.05 : 0.075);
  });
}

function playTone(frequency, startAt, duration, wave, volume) {
  const context = getAudioContext();
  if (!context) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = wave;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.02);
}

function getAudioContext() {
  if (!window.AudioContext && !window.webkitAudioContext) return null;
  state.audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  if (state.audioContext.state === "suspended") state.audioContext.resume();
  return state.audioContext;
}

function celebrateOnce(roomKey, didWin, isDraw) {
  if (state.celebratedRoom === roomKey) return;
  state.celebratedRoom = roomKey;
  playSound(isDraw ? "result" : didWin ? "win" : "lose");
  launchConfetti(didWin, isDraw);
}

function launchConfetti(didWin, isDraw) {
  els.confettiLayer.innerHTML = "";
  const colors = isDraw
    ? ["#ffd166", "#7cc7ff", "#f8fafc"]
    : didWin
      ? ["#ffd166", "#ff4d7d", "#7cffc4", "#ffffff", "#8f7cff"]
      : ["#8ea0b8", "#c9d3df", "#7cc7ff"];

  for (let index = 0; index < 120; index += 1) {
    const piece = document.createElement("span");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[index % colors.length];
    piece.style.animationDelay = `${Math.random() * 0.45}s`;
    piece.style.animationDuration = `${2 + Math.random() * 1.8}s`;
    piece.style.setProperty("--drift", `${Math.random() * 180 - 90}px`);
    els.confettiLayer.append(piece);
  }
  window.setTimeout(() => {
    els.confettiLayer.innerHTML = "";
  }, 4600);
}
