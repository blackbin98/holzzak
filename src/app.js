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
  musicMode: "normal",
  muted: localStorage.getItem("holzzakMusicOff") === "1",
  lastSoundKey: "",
  lastRoleRevealKey: "",
  lastWarningSecond: 0,
  autoAdvanceKey: "",
  systemTransitionKey: "",
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
  muteButton: document.querySelector("#muteButton"),
  setupMessage: document.querySelector("#setupMessage"),
  roomNameDisplay: document.querySelector("#roomNameDisplay"),
  playersList: document.querySelector("#playersList"),
  leaveButton: document.querySelector("#leaveButton"),
  roleLabel: document.querySelector("#roleLabel"),
  roundTitle: document.querySelector("#roundTitle"),
  roundCounter: document.querySelector("#roundCounter"),
  timerDisplay: document.querySelector("#timerDisplay"),
  statusNotice: document.querySelector("#statusNotice"),
  orderControls: document.querySelector("#orderControls"),
  orderClaimButton: document.querySelector("#orderClaimButton"),
  orderChoiceControls: document.querySelector("#orderChoiceControls"),
  numberControls: document.querySelector("#numberControls"),
  guessControls: document.querySelector("#guessControls"),
  numberChoices: document.querySelector("#numberChoices"),
  choiceStatus: document.querySelector("#choiceStatus"),
  nextRoundButton: document.querySelector("#nextRoundButton"),
  cardRevealOverlay: document.querySelector("#cardRevealOverlay"),
  revealCard: document.querySelector("#revealCard"),
  resultModal: document.querySelector("#resultModal"),
  resultIcon: document.querySelector("#resultIcon"),
  resultModalEyebrow: document.querySelector("#resultModalEyebrow"),
  resultModalTitle: document.querySelector("#resultModalTitle"),
  resultModalMessage: document.querySelector("#resultModalMessage"),
  resultActions: document.querySelector("#resultActions"),
  resultActionButton: document.querySelector("#resultActionButton"),
  rematchYesButton: document.querySelector("#rematchYesButton"),
  rematchNoButton: document.querySelector("#rematchNoButton"),
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
els.orderClaimButton.addEventListener("click", claimOrderChoice);
document.querySelectorAll("[data-order-choice]").forEach((button) => {
  button.addEventListener("click", () => chooseOrder(button.dataset.orderChoice));
});
els.nextRoundButton.addEventListener("click", markReadyForNextRound);
els.leaveButton.addEventListener("click", leaveRoom);
els.resultActionButton.addEventListener("click", handleResultAction);
els.rematchYesButton.addEventListener("click", () => chooseRematch(true));
els.rematchNoButton.addEventListener("click", () => chooseRematch(false));
els.muteButton.addEventListener("click", toggleMute);
els.roomPasswordInput.addEventListener("input", () => {
  els.roomPasswordInput.value = els.roomPasswordInput.value.replace(/\D/g, "").slice(0, 4);
});

["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
  window.addEventListener(eventName, startMusic, { once: true });
});

syncMuteButton();
startMusic();

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
    orderPicker: "",
    orderClaimedAt: 0,
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
  const hostId = room.hostId || "";
  const guesserId = room.guesserId || "";
  const updates = { players: nextPlayers, hostId, guesserId };

  if (ids.length === 2 && room.status === "waiting") {
    Object.assign(updates, {
      status: "orderPick",
      hostId: "",
      guesserId: "",
      orderPicker: "",
      orderClaimedAt: 0
    });
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

async function claimOrderChoice() {
  const room = state.room;
  if (!room || room.status !== "orderPick" || room.orderPicker) return;
  startMusic();
  playSound("claim");
  await runTransaction(roomRef(state.roomKey), (latestRoom) => {
    if (!latestRoom || latestRoom.status !== "orderPick" || latestRoom.orderPicker) return latestRoom;
    return {
      ...latestRoom,
      orderPicker: state.playerId,
      orderClaimedAt: Date.now()
    };
  });
}

async function chooseOrder(choice) {
  const room = state.room;
  if (!room || room.status !== "orderPick" || room.orderPicker !== state.playerId) return;
  const playerIds = Object.keys(room.players || {});
  const opponentId = playerIds.find((id) => id !== state.playerId);
  if (!opponentId) return;

  const hostId = choice === "first" ? state.playerId : opponentId;
  const guesserId = choice === "first" ? opponentId : state.playerId;
  showCardReveal(choice === "first" ? "선공" : "후공");
  playSound("start");
  await update(roomRef(state.roomKey), {
    ...startRoundFields(hostId, guesserId, 1),
    orderPicker: state.playerId
  });
}

function render() {
  const room = state.room;
  if (!room) return;

  const players = orderedPlayers(room);
  const me = room.players?.[state.playerId];
  const isHost = room.hostId === state.playerId;
  const isGuesser = room.guesserId === state.playerId;
  const isOrderPicker = room.orderPicker === state.playerId;
  const hasOrderPicker = Boolean(room.orderPicker);
  const hostChoice = room.choices?.[room.hostId];
  const guesserChoice = room.choices?.[room.guesserId];
  const secondsLeft = getSecondsLeft(room);
  const isMyTurnToNumber = room.status === "playing" && isHost && hostChoice === undefined;
  const isMyTurnToGuess = room.status === "playing" && isGuesser && hostChoice !== undefined && guesserChoice === undefined;

  els.setupView.classList.add("hidden");
  els.gameView.classList.remove("hidden");
  els.resultModal.classList.toggle("hidden", !["roundResult", "gameOver", "rematchStarting", "closing", "forfeit"].includes(room.status));
  els.roomNameDisplay.textContent = room.name;
  els.roundCounter.textContent = `${Math.min(room.round || 0, TOTAL_ROUNDS)}/${TOTAL_ROUNDS}`;
  els.timerDisplay.textContent = room.status === "playing" ? String(secondsLeft) : "--";
  els.timerDisplay.classList.toggle("danger", room.status === "playing" && secondsLeft <= 8);
  els.playersList.innerHTML = players.map((player) => scoreboardRow(player, room)).join("");

  els.orderControls.classList.toggle("hidden", room.status !== "orderPick");
  els.orderClaimButton.classList.toggle("hidden", room.status !== "orderPick" || hasOrderPicker);
  els.orderChoiceControls.classList.toggle("hidden", room.status !== "orderPick" || !isOrderPicker);
  els.numberControls.classList.toggle("hidden", !isMyTurnToNumber);
  els.guessControls.classList.toggle("hidden", !isMyTurnToGuess);
  els.nextRoundButton.classList.add("hidden");
  els.nextRoundButton.disabled = Boolean(room.roundReady?.[state.playerId]);
  els.nextRoundButton.textContent = room.roundReady?.[state.playerId] ? "상대 준비를 기다리는 중" : "다음 라운드 준비";

  if (room.status === "playing") startTimer();
  else stopTimer();

  if (room.status === "waiting") {
    setMusicMode("normal");
    els.roleLabel.textContent = "친구 대기 중";
    els.roundTitle.textContent = "아직 한 명이 더 필요해요";
    els.statusNotice.textContent = "친구에게 방 이름과 4자리 비밀번호를 알려주세요. 둘이 모이면 선후 선택부터 시작합니다.";
    els.choiceStatus.textContent = "";
    return;
  }

  if (room.status === "orderPick") {
    setMusicMode("urgent");
    els.roleLabel.textContent = "선후 결정";
    els.roundTitle.textContent = "누가 먼저 운명을 잡을까요?";
    if (!hasOrderPicker) {
      els.statusNotice.textContent = "가운데 버튼을 먼저 누른 사람이 선공 또는 후공을 고를 수 있습니다. 지금부터 눈치 싸움이에요.";
      els.choiceStatus.textContent = "버튼은 선착순입니다. 망설이면 상대가 선택권을 가져갑니다.";
    } else if (isOrderPicker) {
      els.statusNotice.textContent = "선택권을 잡았습니다. 첫 라운드에서 먼저 카드를 고를지, 상대에게 먼저 맡길지 정하세요.";
      els.choiceStatus.textContent = "선공은 카드를 먼저 고르고, 후공은 홀짝을 먼저 맞히는 쪽입니다.";
    } else {
      els.statusNotice.textContent = `${playerName(room, room.orderPicker)}님이 선택권을 잡았습니다. 선후를 고르는 중이에요.`;
      els.choiceStatus.textContent = "잠시만 기다리세요. 선택이 끝나면 바로 30초 라운드가 시작됩니다.";
    }
    return;
  }

  if (room.status === "playing") {
    setMusicMode("normal");
    if (secondsLeft > 10) state.lastWarningSecond = 0;
    maybeShowRoleReveal(room);
    els.roleLabel.textContent = isHost ? "카드 선택" : "홀짝 선택";
    els.roundTitle.textContent = `${room.round}라운드 · ${playerName(room, room.hostId)}의 선택`;
    els.statusNotice.textContent = playingNotice(room, state.playerId);
    els.choiceStatus.textContent = choiceStatus(room, state.playerId);
    playTransitionSound(room);
    maybePlayWarning(secondsLeft);
    if (secondsLeft <= 0) finishRoundByTimeout();
    return;
  }

  if (room.status === "roundResult" && room.result) {
    setMusicMode("normal");
    const parity = room.result.number ? (room.result.number % 2 === 0 ? "짝" : "홀") : "시간 초과";
    const winner = playerName(room, room.result.roundWinnerId);
    els.roleLabel.textContent = "라운드 결과";
    els.roundTitle.textContent = `${room.round}라운드 결과`;
    els.statusNotice.textContent = room.result.reason === "timeout" && !room.result.number
      ? `${playerName(room, room.hostId)}님이 시간 안에 카드를 고르지 못했습니다.`
      : `${playerName(room, room.hostId)}의 카드는 ${room.result.number}. 정답은 ${parity}이었습니다.`;
    els.choiceStatus.textContent = `${winner} 승리! 잠시 후 다음 선택이 시작됩니다.`;
    renderRoundModal(room);
    scheduleAutoNextRound(room);
    playTransitionSound(room);
    return;
  }

  if (room.status === "gameOver" && room.result) {
    setMusicMode("normal");
    const isDraw = room.result.draw;
    const didWin = !isDraw && room.result.winnerId === state.playerId;
    const winner = playerName(room, room.result.winnerId);
    els.roleLabel.textContent = "경기 종료";
    els.roundTitle.textContent = "운명이 결정됐습니다";
    els.statusNotice.textContent = isDraw ? "동점입니다. 끝까지 팽팽했어요." : `${winner}님이 최종 승리했습니다.`;
    els.choiceStatus.textContent = "수고했어요. 다시 도전하고 싶다면 새 방으로 시작해 주세요.";
    renderFinalModal(isDraw, didWin, winner, room);
    celebrateOnce(room.key, didWin, isDraw);
    return;
  }

  if (room.status === "rematchStarting") {
    renderSystemModal("⚡", "재대전 수락!", "상대방이 재대전을 수락했습니다. 새로운 운명이 시작됩니다... ⚡");
    scheduleSystemTransition(room, "orderPick");
    return;
  }

  if (room.status === "closing") {
    renderSystemModal("🌙", "게임 종료", "상대방이 게임을 종료했습니다. 모든 선택에는 끝이 있는 법... ⚡");
    scheduleSystemTransition(room, "lobby");
    return;
  }

  if (room.status === "forfeit") {
    renderSystemModal("🏳️", "상대가 포기했습니다", `${room.leftName || "상대방"}님이 게임을 나갔습니다. 방을 정리하고 첫 화면으로 돌아갑니다.`);
    scheduleSystemTransition(room, "lobby");
  }
}

async function chooseNumber(number) {
  const room = state.room;
  if (!room || room.status !== "playing" || room.hostId !== state.playerId || room.choices?.[room.hostId] !== undefined) return;
  showCardReveal(number);
  playSound("card");
  await update(roomRef(state.roomKey), {
    [`choices/${state.playerId}`]: number,
    endAt: Date.now() + ROUND_SECONDS * 1000
  });
}

async function chooseGuess(guess) {
  const room = state.room;
  if (!room || room.status !== "playing" || room.guesserId !== state.playerId) return;
  if (room.choices?.[room.hostId] === undefined || room.choices?.[room.guesserId] !== undefined) return;
  showCardReveal(guess === "odd" ? "홀" : "짝");
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
      players[latestRoom.hostId].marks = [...(players[latestRoom.hostId].marks || []), ""];
      players[latestRoom.guesserId].marks = [
        ...(players[latestRoom.guesserId].marks || []),
        winnerId === latestRoom.guesserId ? "O" : "X"
      ];
      players[latestRoom.hostId].attacks = (players[latestRoom.hostId].attacks || 0) + 1;

      return {
        ...latestRoom,
        status: latestRoom.round >= TOTAL_ROUNDS ? "gameOver" : "roundResult",
        players,
        choices: {
          ...latestRoom.choices,
          ...(finalGuess ? { [latestRoom.guesserId]: finalGuess } : {})
        },
        roundReady: {},
        result: buildResult(latestRoom, players, winnerId, finalGuess || "", reason)
      };
    });
  } finally {
    state.finishingRound = false;
  }
}

async function markReadyForNextRound() {
  const room = state.room;
  if (!room || room.status !== "roundResult" || room.roundReady?.[state.playerId]) return;
  showCardReveal("준비");
  playSound("ready");
  await runTransaction(roomRef(state.roomKey), (latestRoom) => {
    if (!latestRoom || latestRoom.status !== "roundResult") return latestRoom;
    const nextReady = { ...(latestRoom.roundReady || {}), [state.playerId]: true };
    const playerCount = Object.keys(latestRoom.players || {}).length;
    if (Object.keys(nextReady).length < playerCount) return { ...latestRoom, roundReady: nextReady };
    const nextRoundNumber = (latestRoom.round || 0) + 1;
    if (nextRoundNumber > TOTAL_ROUNDS) return { ...latestRoom, ...gameOverFields(latestRoom) };
    return { ...latestRoom, ...startRoundFields(latestRoom.guesserId, latestRoom.hostId, nextRoundNumber) };
  });
}

function handleResultAction() {
  const room = state.room;
  if (room?.status === "roundResult") {
    advanceRound(room);
    return;
  }
  leaveRoom();
}

function scheduleAutoNextRound(room) {
  const key = `${room.key}:auto:${room.round}:${room.result?.roundWinnerId || ""}`;
  if (state.autoAdvanceKey === key) return;
  state.autoAdvanceKey = key;
  window.setTimeout(() => {
    if (state.room?.status === "roundResult" && state.room?.round === room.round) {
      advanceRound(state.room);
    }
  }, 2100);
}

async function advanceRound(room) {
  if (!room || room.status !== "roundResult") return;
  await runTransaction(roomRef(state.roomKey), (latestRoom) => {
    if (!latestRoom || latestRoom.status !== "roundResult") return latestRoom;
    const nextRoundNumber = (latestRoom.round || 0) + 1;
    if (nextRoundNumber > TOTAL_ROUNDS) return { ...latestRoom, ...gameOverFields(latestRoom) };
    return { ...latestRoom, ...startRoundFields(latestRoom.guesserId, latestRoom.hostId, nextRoundNumber) };
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
  return { status: "gameOver", result: { ...(room.result || {}), winnerId, draw } };
}

function buildResult(room, players, roundWinnerId, guess, reason) {
  const sortedPlayers = Object.entries(players || {}).map(([id, player]) => ({ id, ...player }));
  const [first, second] = sortedPlayers;
  const draw = (first?.score || 0) === (second?.score || 0);
  const leadingId = draw ? "" : ((first?.score || 0) > (second?.score || 0) ? first.id : second.id);
  return {
    number: room.choices?.[room.hostId] ?? null,
    guess,
    reason,
    roundWinnerId,
    winnerId: room.round >= TOTAL_ROUNDS ? leadingId : roundWinnerId,
    draw: room.round >= TOTAL_ROUNDS ? draw : false
  };
}

async function leaveRoom() {
  const roomKey = state.roomKey;
  const room = state.room;
  const shouldForfeit = roomKey && room && Object.keys(room.players || {}).length > 1 && !["gameOver", "closing", "forfeit"].includes(room.status);
  const shouldTrackExit = roomKey && room && Object.keys(room.players || {}).length > 1 && ["gameOver", "forfeit"].includes(room.status);
  resetToSetup();

  if (shouldForfeit) {
    await runTransaction(roomRef(roomKey), (latestRoom) => {
      if (!latestRoom) return latestRoom;
      const exits = {
        ...(latestRoom.exits || {}),
        [state.playerId]: true
      };
      const playerIds = Object.keys(latestRoom.players || {});
      if (playerIds.length > 0 && playerIds.every((id) => exits[id])) return null;
      return {
        ...latestRoom,
        status: "forfeit",
        leftBy: state.playerId,
        leftName: latestRoom.players?.[state.playerId]?.name || "상대방",
        exits
      };
    });
    window.setTimeout(() => remove(roomRef(roomKey)), 2800);
    return;
  }

  if (shouldTrackExit) {
    await runTransaction(roomRef(roomKey), (latestRoom) => {
      if (!latestRoom) return latestRoom;
      const exits = {
        ...(latestRoom.exits || {}),
        [state.playerId]: true
      };
      const playerIds = Object.keys(latestRoom.players || {});
      if (playerIds.length > 0 && playerIds.every((id) => exits[id])) return null;
      return {
        ...latestRoom,
        exits
      };
    });
    return;
  }

  if (roomKey) await remove(roomRef(roomKey));
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
  return { playerName, roomName, roomKey: roomNameToKey(roomName), password };
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
      { ...player, score: player.score || 0, marks: [...(player.marks || [])], attacks: player.attacks || 0 }
    ])
  );
}

function resetPlayers(players) {
  return Object.fromEntries(
    Object.entries(players || {}).map(([id, player]) => [
      id,
      {
        ...player,
        score: 0,
        marks: [],
        attacks: 0
      }
    ])
  );
}

function scoreboardRow(player, room) {
  const active = player.id === room.hostId && room.status === "playing" ? "active" : "";
  const marks = Array.from({ length: ATTACKS_PER_PLAYER }, (_, index) => {
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
      ? "당신 차례예요. 30초 안에 선택하지 못하면 패배합니다."
      : `${hostName}님이 카드를 선택 중입니다.`;
  }
  return myId === room.guesserId
    ? "당신 차례예요. 30초 안에 선택하지 못하면 패배합니다."
    : `${guesserName}님이 홀짝을 선택 중입니다.`;
}

function choiceStatus(room, myId) {
  if (room.choices?.[myId] !== undefined) return "선택 완료. 이제 상대의 판단을 기다리면 됩니다.";
  if (myId === room.hostId) return "카드를 선택하면 상대에게 홀짝 버튼이 열립니다.";
  if (room.choices?.[room.hostId] === undefined) return "상대가 제한 시간 안에 카드를 골라야 선택지가 나타납니다.";
  return "홀 또는 짝. 30초 안에 고르지 못하면 이번 판은 넘어갑니다.";
}

function renderFinalModal(isDraw, didWin, winner, room) {
  setResultButtons("final");
  els.resultModalEyebrow.textContent = "Final result";
  const waitingForOpponent = room?.rematch?.[state.playerId] === "yes";

  if (isDraw) {
    els.resultIcon.textContent = "⚡";
    els.resultModalTitle.textContent = "무승부!";
    els.resultModalMessage.textContent = "무승부! 강적을 만났군요. 다시 하시겠습니까?";
    applyRematchWaitingState(waitingForOpponent);
    return;
  }
  if (didWin) {
    els.resultIcon.textContent = "🏆";
    els.resultModalTitle.textContent = "승리했습니다!";
    els.resultModalMessage.textContent = "축하합니다. 오늘의 운명은 당신 편이었어요. 다시 하시겠습니까?";
    applyRematchWaitingState(waitingForOpponent);
    return;
  }
  els.resultIcon.textContent = "💥";
  els.resultModalTitle.textContent = "패배했습니다";
  els.resultModalMessage.textContent = `${winner}님이 한 수 앞섰어요. 다시 하시겠습니까?`;
  applyRematchWaitingState(waitingForOpponent);
}

function applyRematchWaitingState(waitingForOpponent) {
  if (waitingForOpponent) {
    els.resultModalMessage.textContent = "재대전을 신청했습니다. 상대의 선택을 기다리는 중이에요.";
    els.rematchYesButton.disabled = true;
    els.rematchNoButton.disabled = true;
  }
}

function setResultButtons(mode) {
  const isFinal = mode === "final";
  const isSystem = mode === "system";
  els.resultActionButton.classList.toggle("hidden", isFinal || isSystem);
  els.rematchYesButton.classList.toggle("hidden", !isFinal);
  els.rematchNoButton.classList.toggle("hidden", !isFinal);
  els.resultActionButton.disabled = false;
  els.rematchYesButton.disabled = false;
  els.rematchNoButton.disabled = false;
}

async function chooseRematch(wantsRematch) {
  const room = state.room;
  if (!room || room.status !== "gameOver") return;
  playSound(wantsRematch ? "ready" : "lose");
  els.rematchYesButton.disabled = true;
  els.rematchNoButton.disabled = true;

  await runTransaction(roomRef(state.roomKey), (latestRoom) => {
    if (!latestRoom || latestRoom.status !== "gameOver") return latestRoom;
    if (!wantsRematch) {
      return {
        ...latestRoom,
        status: "closing",
        closedBy: state.playerId,
        rematch: {
          ...(latestRoom.rematch || {}),
          [state.playerId]: "no"
        }
      };
    }

    const rematch = {
      ...(latestRoom.rematch || {}),
      [state.playerId]: "yes"
    };
    const playerIds = Object.keys(latestRoom.players || {});
    const allYes = playerIds.length === 2 && playerIds.every((id) => rematch[id] === "yes");
    if (!allYes) return { ...latestRoom, rematch };

    return {
      ...latestRoom,
      status: "rematchStarting",
      rematch
    };
  });
}

function renderSystemModal(icon, title, message) {
  setResultButtons("system");
  els.resultModalEyebrow.textContent = "System";
  els.resultIcon.textContent = icon;
  els.resultModalTitle.textContent = title;
  els.resultModalMessage.textContent = message;
}

function scheduleSystemTransition(room, target) {
  const key = `${room.key}:system:${room.status}:${target}`;
  if (state.systemTransitionKey === key) return;
  state.systemTransitionKey = key;

  window.setTimeout(async () => {
    if (target === "lobby") {
      const shouldRemove = state.room?.hostId === state.playerId;
      const roomKey = state.roomKey;
      resetToSetup();
      if (shouldRemove && roomKey) await remove(roomRef(roomKey));
      return;
    }

    await runTransaction(roomRef(state.roomKey), (latestRoom) => {
      if (!latestRoom || latestRoom.status !== "rematchStarting") return latestRoom;
      const players = resetPlayers(latestRoom.players);
      return {
        ...latestRoom,
        status: "orderPick",
        round: 0,
        hostId: "",
        guesserId: "",
        orderPicker: "",
        orderClaimedAt: 0,
        endAt: 0,
        players,
        choices: {},
        roundReady: {},
        rematch: {},
        result: null
      };
    });
  }, 2200);
}

function renderRoundModal(room) {
  const didWin = room.result.roundWinnerId === state.playerId;
  const didTimeout = room.result.reason === "timeout";
  const parity = room.result.number ? (room.result.number % 2 === 0 ? "짝" : "홀") : "시간 초과";
  const guessed = room.result.guess === "odd" ? "홀" : room.result.guess === "even" ? "짝" : "";
  const numberText = room.result.number ? `${room.result.number}번 카드` : "카드 미선택";

  setResultButtons("round");
  els.resultModalEyebrow.textContent = `${room.round}라운드 결과`;
  els.resultIcon.textContent = didWin ? "🎯" : "💥";
  els.resultModalTitle.textContent = didWin ? "오예!" : "아차!";

  if (didTimeout) {
    els.resultModalMessage.textContent = didWin
      ? "상대가 30초 안에 선택하지 못했어요. 시간도 실력입니다!"
      : "30초가 끝났습니다. 운명은 기다려주지 않아요!";
  } else if (room.guesserId === state.playerId) {
    els.resultModalMessage.textContent = didWin
      ? `${numberText}, 정답은 ${parity}! 당신의 ${guessed} 선택이 제대로 꽂혔어요.`
      : `${numberText}, 정답은 ${parity}. 감이 살짝 빗나갔습니다. 다음엔 뒤집어 봅시다.`;
  } else {
    els.resultModalMessage.textContent = didWin
      ? `${numberText}로 상대를 흔들었습니다. 읽히지 않았어요!`
      : `${numberText}, 정답은 ${parity}. 상대가 당신의 카드를 읽었습니다.`;
  }

  els.resultActionButton.disabled = false;
  els.resultActionButton.textContent = "바로 다음 판";
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

function showCardReveal(value) {
  els.revealCard.textContent = String(value);
  els.revealCard.classList.toggle("wide", String(value).length >= 3);
  els.revealCard.classList.toggle("text-only", String(value).includes("선공") || String(value).includes("후공"));
  els.cardRevealOverlay.classList.remove("hidden");
  els.revealCard.classList.remove("spin-pop");
  void els.revealCard.offsetWidth;
  els.revealCard.classList.add("spin-pop");
  window.setTimeout(() => els.cardRevealOverlay.classList.add("hidden"), 980);
}

function maybeShowRoleReveal(room) {
  if (room.round !== 1 || room.choices?.[room.hostId] !== undefined) return;
  const key = `${room.key}:role:${state.playerId}`;
  if (state.lastRoleRevealKey === key) return;
  state.lastRoleRevealKey = key;
  showCardReveal(room.hostId === state.playerId ? "선공!" : "후공!");
  playSound("claim");
}

function playTransitionSound(room) {
  const soundKey = `${room.key}:${room.status}:${room.round}:${room.choices?.[room.hostId] ?? "n"}:${room.choices?.[room.guesserId] ?? "g"}`;
  if (state.lastSoundKey === soundKey) return;
  state.lastSoundKey = soundKey;
  if (room.status === "roundResult") playSound("result");
  if (room.status === "playing" && room.choices?.[room.hostId] !== undefined) playSound("reveal");
}

function maybePlayWarning(secondsLeft) {
  if (secondsLeft > 10 || secondsLeft <= 0 || state.lastWarningSecond === secondsLeft) return;
  state.lastWarningSecond = secondsLeft;
  playSound("warning");
}

function setMusicMode(mode) {
  if (state.musicMode === mode) return;
  state.musicMode = mode;
  stopMusic();
  startMusic();
}

function toggleMute() {
  state.muted = !state.muted;
  localStorage.setItem("holzzakMusicOff", state.muted ? "1" : "0");
  if (state.muted) stopMusic();
  else {
    startMusic();
    playSound("start");
  }
  syncMuteButton();
}

function syncMuteButton() {
  els.muteButton.textContent = state.muted ? "♪̸" : "♪";
  els.muteButton.classList.toggle("muted", state.muted);
  els.muteButton.setAttribute("aria-label", state.muted ? "음악 켜기" : "음악 끄기");
}

function startMusic() {
  if (state.muted || state.musicTimer) return;
  const context = getAudioContext();
  if (!context || context.state === "suspended") return;
  let step = 0;
  const normalMelody = [523.25, 659.25, 783.99, 659.25, 587.33, 739.99, 880, 739.99];
  const urgentMelody = [880, 987.77, 1046.5, 987.77, 880, 783.99, 880, 1174.66];
  state.musicTimer = setInterval(() => {
    if (state.muted) return;
    const now = context.currentTime;
    const melody = state.musicMode === "urgent" ? urgentMelody : normalMelody;
    playTone(melody[step % melody.length], now, state.musicMode === "urgent" ? 0.08 : 0.11, "triangle", state.musicMode === "urgent" ? 0.044 : 0.034);
    if (step % 2 === 0) playTone(state.musicMode === "urgent" ? 196 : 130.81, now, 0.1, "sine", state.musicMode === "urgent" ? 0.028 : 0.02);
    step += 1;
  }, state.musicMode === "urgent" ? 170 : 250);
}

function stopMusic() {
  clearInterval(state.musicTimer);
  state.musicTimer = null;
}

function playSound(type) {
  if (state.muted) return;
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
    claim: [[987.77, 0], [1318.51, 0.07], [1567.98, 0.14]],
    warning: [[1108.73, 0]],
    error: [[220, 0], [196, 0.1]]
  };
  (soundMap[type] || soundMap.select).forEach(([frequency, delay]) => {
    const isSharp = type === "error" || type === "warning";
    playTone(frequency, now + delay, isSharp ? 0.16 : 0.14, isSharp ? "square" : "sine", type === "warning" ? 0.09 : isSharp ? 0.05 : 0.075);
  });
}

function playTone(frequency, startAt, duration, wave, volume) {
  if (state.muted) return;
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
  if (state.audioContext.state === "suspended") state.audioContext.resume().then(startMusic).catch(() => {});
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
