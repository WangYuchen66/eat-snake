"use strict";

const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");

const scoreValue = document.querySelector("#scoreValue");
const bestValue = document.querySelector("#bestValue");
const levelValue = document.querySelector("#levelValue");
const statusText = document.querySelector("#statusText");
const overlay = document.querySelector("#overlay");
const startButton = document.querySelector("#startButton");
const pauseButton = document.querySelector("#pauseButton");
const resetButton = document.querySelector("#resetButton");
const difficultySelect = document.querySelector("#difficultySelect");
const soundToggle = document.querySelector("#soundToggle");

const gridSize = 24;
const cells = gridSize * gridSize;
const storageKey = "snake.bestScore.v1";

const directions = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const presets = {
  easy: {
    label: "轻松",
    speed: 145,
    multiplier: 1,
    walls: false,
    obstacles: 0,
  },
  classic: {
    label: "经典",
    speed: 112,
    multiplier: 1.4,
    walls: true,
    obstacles: 0,
  },
  hard: {
    label: "挑战",
    speed: 86,
    multiplier: 2,
    walls: true,
    obstacles: 16,
  },
};

let bestScore = Number(localStorage.getItem(storageKey) || 0);
let state = createInitialState();
let timerId = null;
let audioContext = null;
let touchStart = null;

bestValue.textContent = bestScore;
resizeCanvas();
resetGame(false);

window.addEventListener("resize", resizeCanvas);
window.addEventListener("keydown", handleKeydown);
startButton.addEventListener("click", startGame);
pauseButton.addEventListener("click", togglePause);
resetButton.addEventListener("click", () => resetGame(true));
difficultySelect.addEventListener("change", () => resetGame(false));
soundToggle.addEventListener("change", () => playTone(620, 0.03, "sine"));

document.querySelectorAll("[data-direction]").forEach((button) => {
  button.addEventListener("click", () => {
    setDirection(button.dataset.direction);
    if (state.phase === "idle") {
      startGame();
    }
  });
});

canvas.addEventListener("pointerdown", (event) => {
  touchStart = { x: event.clientX, y: event.clientY };
});

canvas.addEventListener("pointerup", (event) => {
  if (!touchStart) return;

  const dx = event.clientX - touchStart.x;
  const dy = event.clientY - touchStart.y;
  touchStart = null;

  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;

  if (Math.abs(dx) > Math.abs(dy)) {
    setDirection(dx > 0 ? "right" : "left");
  } else {
    setDirection(dy > 0 ? "down" : "up");
  }

  if (state.phase === "idle") {
    startGame();
  }
});

function createInitialState() {
  return {
    snake: [],
    direction: directions.right,
    nextDirection: directions.right,
    food: { x: 17, y: 12, type: "normal" },
    bonus: null,
    obstacles: [],
    score: 0,
    level: 1,
    eaten: 0,
    phase: "idle",
    particles: [],
    tickMs: presets.classic.speed,
  };
}

function resetGame(shouldStart) {
  stopLoop();

  const preset = getPreset();
  state = createInitialState();
  state.tickMs = preset.speed;
  state.snake = [
    { x: 10, y: 12 },
    { x: 9, y: 12 },
    { x: 8, y: 12 },
    { x: 7, y: 12 },
  ];
  state.obstacles = buildObstacles(preset.obstacles);
  state.food = createFood("normal");
  state.phase = "idle";

  updateHud();
  setOverlay("准备好了", "按开始进入棋盘", true);
  draw();

  if (shouldStart) {
    startGame();
  }
}

function startGame() {
  if (state.phase === "running") return;

  state.phase = "running";
  startButton.textContent = "继续";
  pauseButton.disabled = false;
  difficultySelect.disabled = true;
  setOverlay("", "", false);
  updateHud();
  startLoop();
  playTone(520, 0.05, "triangle");
}

function togglePause() {
  if (state.phase === "idle" || state.phase === "over") return;

  if (state.phase === "paused") {
    state.phase = "running";
    pauseButton.textContent = "暂停";
    setOverlay("", "", false);
    updateHud();
    startLoop();
    playTone(540, 0.04, "sine");
    return;
  }

  state.phase = "paused";
  pauseButton.textContent = "继续";
  setOverlay("已暂停", "继续后回到棋盘", true);
  updateHud();
  stopLoop();
  draw();
}

function startLoop() {
  stopLoop();
  timerId = window.setInterval(step, state.tickMs);
}

function stopLoop() {
  if (timerId) {
    window.clearInterval(timerId);
    timerId = null;
  }
}

function step() {
  if (state.phase !== "running") return;

  state.direction = state.nextDirection;
  const head = state.snake[0];
  let next = {
    x: head.x + state.direction.x,
    y: head.y + state.direction.y,
  };

  const preset = getPreset();
  if (!preset.walls) {
    next = wrapCell(next);
  }

  const willEatFood = sameCell(next, state.food);
  const willEatBonus = state.bonus && sameCell(next, state.bonus);
  const bodyToCheck = willEatFood || willEatBonus ? state.snake : state.snake.slice(0, -1);

  if (isOutOfBounds(next) || hasCell(bodyToCheck, next) || hasCell(state.obstacles, next)) {
    endGame();
    return;
  }

  state.snake.unshift(next);

  if (willEatFood || willEatBonus) {
    handleEat(next, willEatBonus ? "bonus" : "normal");
  } else {
    state.snake.pop();
  }

  decayParticles();
  maybeExpireBonus();
  draw();
}

function handleEat(cell, type) {
  const preset = getPreset();
  const base = type === "bonus" ? 45 : 10;
  const points = Math.round(base * preset.multiplier * state.level);
  state.score += points;

  if (type === "bonus") {
    state.bonus = null;
    emitParticles(cell, "#f3b833", 14);
    playTone(780, 0.08, "square");
  } else {
    state.eaten += 1;
    state.food = createFood("normal");
    emitParticles(cell, "#e34f3f", 9);
    playTone(640, 0.06, "triangle");

    if (state.eaten % 5 === 0) {
      increaseLevel();
    }

    if (state.eaten % 4 === 0) {
      state.bonus = createFood("bonus");
      state.bonus.life = 55;
    }
  }

  if (state.score > bestScore) {
    bestScore = state.score;
    localStorage.setItem(storageKey, String(bestScore));
  }

  if (state.snake.length + state.obstacles.length >= cells - 1) {
    winGame();
    return;
  }

  updateHud();
}

function increaseLevel() {
  state.level += 1;
  state.tickMs = Math.max(54, Math.round(state.tickMs * 0.9));

  if (state.phase === "running") {
    startLoop();
  }
}

function maybeExpireBonus() {
  if (!state.bonus) return;

  state.bonus.life -= 1;
  if (state.bonus.life <= 0) {
    state.bonus = null;
  }
}

function endGame() {
  state.phase = "over";
  stopLoop();
  pauseButton.disabled = true;
  pauseButton.textContent = "暂停";
  difficultySelect.disabled = false;
  startButton.textContent = "开始";
  setOverlay("游戏结束", `得分 ${state.score}`, true);
  updateHud();
  playTone(180, 0.12, "sawtooth");
  draw();
}

function winGame() {
  state.phase = "over";
  stopLoop();
  pauseButton.disabled = true;
  difficultySelect.disabled = false;
  setOverlay("完成全图", `得分 ${state.score}`, true);
  updateHud();
  playTone(920, 0.18, "triangle");
  draw();
}

function setDirection(name) {
  const next = directions[name];
  if (!next) return;

  const current = state.direction;
  const isReverse = current.x + next.x === 0 && current.y + next.y === 0;
  if (isReverse && state.snake.length > 1) return;

  state.nextDirection = next;
}

function createFood(type) {
  const blocked = [...state.snake, ...state.obstacles];
  if (state.bonus) blocked.push(state.bonus);

  let cell = null;
  let guard = 0;
  while (!cell && guard < cells * 2) {
    const candidate = {
      x: Math.floor(Math.random() * gridSize),
      y: Math.floor(Math.random() * gridSize),
    };

    if (!hasCell(blocked, candidate)) {
      cell = candidate;
    }
    guard += 1;
  }

  return {
    ...(cell || { x: 1, y: 1 }),
    type,
  };
}

function buildObstacles(count) {
  const startSafeZone = [
    { x: 7, y: 12 },
    { x: 8, y: 12 },
    { x: 9, y: 12 },
    { x: 10, y: 12 },
    { x: 11, y: 12 },
    { x: 12, y: 12 },
  ];
  const obstacles = [];

  while (obstacles.length < count) {
    const cell = {
      x: 2 + Math.floor(Math.random() * (gridSize - 4)),
      y: 2 + Math.floor(Math.random() * (gridSize - 4)),
    };

    if (!hasCell(startSafeZone, cell) && !hasCell(obstacles, cell)) {
      obstacles.push(cell);
    }
  }

  return obstacles;
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const cssSize = Math.min(canvas.clientWidth || 720, 720);
  canvas.width = Math.round(cssSize * dpr);
  canvas.height = Math.round(cssSize * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function draw() {
  const size = canvas.clientWidth || 720;
  const tile = size / gridSize;

  ctx.clearRect(0, 0, size, size);
  drawBoard(size, tile);
  drawObstacles(tile);
  drawFood(state.food, tile);

  if (state.bonus) {
    drawFood(state.bonus, tile);
  }

  drawSnake(tile);
  drawParticles(tile);
}

function drawBoard(size, tile) {
  ctx.fillStyle = "#f9fbf5";
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "rgba(102, 112, 97, 0.13)";
  ctx.lineWidth = 1;

  for (let i = 0; i <= gridSize; i += 1) {
    const position = Math.round(i * tile) + 0.5;
    ctx.beginPath();
    ctx.moveTo(position, 0);
    ctx.lineTo(position, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, position);
    ctx.lineTo(size, position);
    ctx.stroke();
  }
}

function drawSnake(tile) {
  state.snake.forEach((segment, index) => {
    const padding = index === 0 ? tile * 0.1 : tile * 0.15;
    const x = segment.x * tile + padding;
    const y = segment.y * tile + padding;
    const radius = tile * 0.23;
    const size = tile - padding * 2;

    ctx.fillStyle = index === 0 ? "#1d6739" : index % 2 === 0 ? "#2f8f4e" : "#48aa61";
    roundRect(x, y, size, size, radius);
    ctx.fill();

    if (index === 0) {
      drawEyes(segment, tile);
    }
  });
}

function drawEyes(head, tile) {
  const centerX = head.x * tile + tile / 2;
  const centerY = head.y * tile + tile / 2;
  const eyeOffset = tile * 0.18;
  const forwardX = state.direction.x * tile * 0.14;
  const forwardY = state.direction.y * tile * 0.14;
  const sideX = state.direction.y * eyeOffset;
  const sideY = -state.direction.x * eyeOffset;

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(centerX + forwardX + sideX, centerY + forwardY + sideY, tile * 0.075, 0, Math.PI * 2);
  ctx.arc(centerX + forwardX - sideX, centerY + forwardY - sideY, tile * 0.075, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#243027";
  ctx.beginPath();
  ctx.arc(centerX + forwardX + sideX, centerY + forwardY + sideY, tile * 0.035, 0, Math.PI * 2);
  ctx.arc(centerX + forwardX - sideX, centerY + forwardY - sideY, tile * 0.035, 0, Math.PI * 2);
  ctx.fill();
}

function drawFood(food, tile) {
  if (!food) return;

  const centerX = food.x * tile + tile / 2;
  const centerY = food.y * tile + tile / 2;
  const radius = food.type === "bonus" ? tile * 0.33 : tile * 0.29;

  ctx.fillStyle = food.type === "bonus" ? "#f3b833" : "#e34f3f";
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#2f8f4e";
  ctx.beginPath();
  ctx.ellipse(centerX + tile * 0.12, centerY - tile * 0.31, tile * 0.12, tile * 0.06, -0.5, 0, Math.PI * 2);
  ctx.fill();

  if (food.type === "bonus") {
    ctx.strokeStyle = "rgba(36, 48, 39, 0.38)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + tile * 0.1, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawObstacles(tile) {
  ctx.fillStyle = "#2d7e91";
  state.obstacles.forEach((cell) => {
    const padding = tile * 0.18;
    roundRect(
      cell.x * tile + padding,
      cell.y * tile + padding,
      tile - padding * 2,
      tile - padding * 2,
      tile * 0.16,
    );
    ctx.fill();
  });
}

function emitParticles(cell, color, count) {
  for (let i = 0; i < count; i += 1) {
    state.particles.push({
      x: cell.x + 0.5,
      y: cell.y + 0.5,
      dx: (Math.random() - 0.5) * 0.22,
      dy: (Math.random() - 0.5) * 0.22,
      life: 12 + Math.floor(Math.random() * 10),
      color,
    });
  }
}

function decayParticles() {
  state.particles.forEach((particle) => {
    particle.x += particle.dx;
    particle.y += particle.dy;
    particle.life -= 1;
  });
  state.particles = state.particles.filter((particle) => particle.life > 0);
}

function drawParticles(tile) {
  state.particles.forEach((particle) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, particle.life / 18));
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x * tile, particle.y * tile, tile * 0.08, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function handleKeydown(event) {
  const keyMap = {
    ArrowUp: "up",
    KeyW: "up",
    ArrowDown: "down",
    KeyS: "down",
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
  };

  if (keyMap[event.code]) {
    event.preventDefault();
    setDirection(keyMap[event.code]);
    if (state.phase === "idle") {
      startGame();
    }
  }

  if (event.code === "Space") {
    event.preventDefault();
    if (state.phase === "idle") startGame();
    else togglePause();
  }

  if (event.code === "Enter" && state.phase === "over") {
    event.preventDefault();
    resetGame(true);
  }
}

function updateHud() {
  scoreValue.textContent = state.score;
  bestValue.textContent = bestScore;
  levelValue.textContent = state.level;

  const phaseText = {
    idle: "准备开始",
    running: `${getPreset().label}模式`,
    paused: "已暂停",
    over: "本局结束",
  };
  statusText.textContent = phaseText[state.phase];
}

function setOverlay(title, detail, visible) {
  overlay.classList.toggle("hidden", !visible);
  overlay.querySelector("h2").textContent = title;
  overlay.querySelector("p").textContent = detail;
}

function playTone(frequency, duration, type) {
  if (!soundToggle.checked) return;

  audioContext ||= new AudioContext();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.value = 0.055;
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function wrapCell(cell) {
  return {
    x: (cell.x + gridSize) % gridSize,
    y: (cell.y + gridSize) % gridSize,
  };
}

function isOutOfBounds(cell) {
  return cell.x < 0 || cell.x >= gridSize || cell.y < 0 || cell.y >= gridSize;
}

function hasCell(collection, cell) {
  return collection.some((item) => sameCell(item, cell));
}

function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

function getPreset() {
  return presets[difficultySelect.value] || presets.classic;
}

function roundRect(x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
