// 29 колец — годовые кольца компании.
// Скетч для p5.js editor: вставить целиком в sketch.js и нажать Play.
// Работает на p5.js 1.x и 2.x. Рисование — через Canvas 2D (drawingContext).

// =====================================================================
// CONFIG — все настройки в одном месте
// =====================================================================
const CONFIG = {
  ringCount: 29,              // число колец (= лет компании)
  outerRadiusRatio: 0.9,      // последнее кольцо = 90% от min(w, h) / 2

  // Цвета (HSL, сдвиг оттенка на золотой угол)
  hueStart: 18,               // тёплый стартовый оттенок
  hueStep: 137.508,           // золотой угол
  saturation: 72,
  lightness: 63,

  // Линии и свечение
  lineWidthMin: 3,            // толщина внутреннего кольца, px
  lineWidthMax: 5,            // толщина внешнего кольца, px
  glowWidthFactor: 2.4,       // ширина «свечения» относительно линии
  glowAlpha: 0.22,            // прозрачность прохода свечения

  // Появление колец
  appearDuration: 400,        // мс: рост радиуса + fade-in
  intervalMin: 80,            // мс между кольцами, мышь в центре
  intervalMax: 1000,          // мс между кольцами, мышь у края
  intervalCurvePower: 2,      // нелинейность (2 = квадратичная)
  speedSmoothing: 180,        // мс, постоянная времени сглаживания скорости
  idlePointerDistance: 0.5,   // нормализованное расстояние, пока мышь не двигалась

  // Пульсация после появления всех колец
  pulseAmplitude: 0.03,       // масштаб 1 ± 0.03
  pulseFrequency: 0.45,       // Гц
  pulsePhaseShift: 0.16,      // рад на кольцо: волна от центра наружу
  pulseFadeIn: 1800,          // мс плавного старта пульсации

  // Указатель вокруг курсора
  pointerRadius: 18,

  // HUD
  hudFlashDuration: 1300,     // мс вспышки HUD после 29-го кольца
  hudYearsFadeIn: 800,        // мс появления надписи «29 лет»

  // Защита от больших скачков времени (вкладка в фоне и т.п.)
  maxDeltaTime: 100,

  // Фон
  bgInner: '#16110d',
  bgOuter: '#0a0807',
  vignetteStrength: 0.6,
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const N = CONFIG.ringCount;

// =====================================================================
// Состояние
// =====================================================================
let ctx;                      // CanvasRenderingContext2D от p5

const view = {
  cx: 0, cy: 0,
  maxRadius: 0,               // радиус последнего кольца
  cornerDist: 1,              // расстояние от центра до угла (для нормализации)
  bgGradient: null,
  vignette: null,
};

const pointer = {
  x: 0, y: 0,
  known: false,               // курсор/палец хоть раз появлялся
  active: false,              // сейчас над канвасом / палец прижат
  alpha: 0,                   // сглаженная видимость кольца-указателя
};

const state = {
  time: 0,                              // собственные часы анимации, мс
  visible: 0,                           // Уровень 2: счётчик появившихся колец
  spawnProgress: 1,                     // Уровень 2: накопленная доля интервала
  birthTimes: new Float64Array(N),      // когда каждое кольцо начало появляться
  interval: CONFIG.intervalMax,         // Уровень 3: текущий (сглаженный) интервал
  targetInterval: CONFIG.intervalMax,
  pulseStart: -1,                       // когда стартовала пульсация (-1 = нет)
  completeAt: -1,                       // когда появилось 29-е кольцо (для HUD)
  hudHeight: 0,                         // сглаженная высота HUD
};

// Уровень 1: цвета колец — HSL со сдвигом оттенка на золотой угол.
// Одинаковые насыщенность/яркость дают гармонию, золотой угол — контраст соседей.
const ringColors = Array.from({ length: N }, (_, i) => {
  const hue = (CONFIG.hueStart + i * CONFIG.hueStep) % 360;
  return `hsl(${hue.toFixed(1)}, ${CONFIG.saturation}%, ${CONFIG.lightness}%)`;
});

// =====================================================================
// Утилиты
// =====================================================================
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const smoothstep01 = (t) => t * t * (3 - 2 * t);

function yearsWord(n) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'год';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'года';
  return 'лет';
}

function setLetterSpacing(px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px';
}

function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

// =====================================================================
// p5: setup / windowResized / draw
// =====================================================================
function setup() {
  // Чистая страница без скролла — и в editor, и в полноэкранном превью
  document.documentElement.style.cssText += 'margin:0;height:100%;overflow:hidden;background:#0d0a08;';
  document.body.style.cssText += 'margin:0;height:100%;overflow:hidden;background:#0d0a08;';

  const c = createCanvas(windowWidth, windowHeight);
  c.elt.style.display = 'block';
  c.elt.style.touchAction = 'none';       // палец не скроллит страницу

  // Уровень 3 / Визуал: devicePixelRatio — чёткость на ретине
  pixelDensity(Math.min(window.devicePixelRatio || 1, 3));

  ctx = drawingContext;
  resize();
  restart();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  resize();
}

function draw() {
  const dt = Math.min(Math.max(deltaTime || 0, 0), CONFIG.maxDeltaTime);
  update(dt);
  render();
}

// =====================================================================
// resize — размеры и кэш градиентов
// =====================================================================
function resize() {
  view.cx = width / 2;
  view.cy = height / 2;
  // Уровень 1: последнее кольцо ≈ 90% от min(w, h) / 2 — узор всегда влезает
  view.maxRadius = CONFIG.outerRadiusRatio * Math.min(width, height) / 2;
  view.cornerDist = Math.max(1, Math.hypot(view.cx, view.cy));

  // Фон: почти чёрный, чуть тёплый, светлее к центру
  const bg = ctx.createRadialGradient(view.cx, view.cy, 0, view.cx, view.cy, view.cornerDist);
  bg.addColorStop(0, CONFIG.bgInner);
  bg.addColorStop(1, CONFIG.bgOuter);
  view.bgGradient = bg;

  // Виньетка поверх колец
  const v = ctx.createRadialGradient(
    view.cx, view.cy, Math.min(width, height) * 0.3,
    view.cx, view.cy, view.cornerDist
  );
  v.addColorStop(0, 'rgba(0, 0, 0, 0)');
  v.addColorStop(1, `rgba(0, 0, 0, ${CONFIG.vignetteStrength})`);
  view.vignette = v;
}

// =====================================================================
// Ввод: мышь и touch (палец работает как курсор)
// =====================================================================
function insideCanvas(x, y) {
  return x >= 0 && y >= 0 && x <= width && y <= height;
}

function trackPointer() {
  if (!insideCanvas(mouseX, mouseY)) return;
  pointer.x = mouseX;
  pointer.y = mouseY;
  pointer.known = true;
  pointer.active = true;
}

function mouseMoved()   { trackPointer(); }
function mouseDragged() { trackPointer(); }
function touchMoved()   { trackPointer(); return false; }
function touchStarted() { trackPointer(); }            // без return false — чтобы тап давал click
function touchEnded()   { pointer.active = false; }

// Клик / тап — перезапуск
function mouseClicked() {
  if (insideCanvas(mouseX, mouseY)) restart();
}

// Пробел — перезапуск
function keyPressed() {
  if (key === ' ') {
    restart();
    return false;                                      // не скроллить страницу
  }
}

// =====================================================================
// restart — начать всё с нуля
// =====================================================================
function restart() {
  state.visible = 0;
  state.spawnProgress = 1;     // первое кольцо — сразу
  state.pulseStart = -1;
  state.completeAt = -1;
  state.birthTimes.fill(0);
}

// =====================================================================
// Уровень 3: нормализованное расстояние курсора до центра [0..1]
// =====================================================================
function pointerDistanceNorm() {
  if (!pointer.known) return CONFIG.idlePointerDistance;
  const d = Math.hypot(pointer.x - view.cx, pointer.y - view.cy);
  return clamp01(d / view.cornerDist);
}

// =====================================================================
// update — логика кадра
// =====================================================================
function update(dt) {
  state.time += dt;

  // Мышь ушла за пределы канваса — прячем указатель (скорость помним)
  if (pointer.active && !insideCanvas(mouseX, mouseY)) pointer.active = false;

  // Уровень 3: целевой интервал — нелинейно (квадратично) от расстояния до центра
  const d = pointerDistanceNorm();
  state.targetInterval = mix(
    CONFIG.intervalMin,
    CONFIG.intervalMax,
    Math.pow(d, CONFIG.intervalCurvePower)
  );

  // Уровень 3: сглаживание скорости (frame-rate independent lerp)
  const k = 1 - Math.exp(-dt / CONFIG.speedSmoothing);
  state.interval = mix(state.interval, state.targetInterval, k);

  // Уровень 2: таймер на кадрах p5 (requestAnimationFrame) с накоплением delta time.
  // Копим dt в долях текущего интервала — при смене скорости на лету
  // накопленный прогресс сохраняется, поэтому рывков нет.
  if (state.visible < N) {
    state.spawnProgress += dt / state.interval;
    if (state.spawnProgress >= 1) {
      state.spawnProgress = Math.min(state.spawnProgress - 1, 1); // не больше одного кольца за кадр
      spawnRing();
    }
  }

  // Уровень 3: как только последнее кольцо доросло — запускаем пульсацию
  if (state.visible === N && state.pulseStart < 0) {
    if (state.time - state.birthTimes[N - 1] >= CONFIG.appearDuration) {
      state.pulseStart = state.time;
    }
  }

  // Плавное появление/исчезновение указателя
  pointer.alpha = mix(pointer.alpha, pointer.active ? 1 : 0, 1 - Math.exp(-dt / 120));

  // Плавное раскрытие HUD под надпись «29 лет»
  const targetH = state.completeAt >= 0 ? 1 : 0;
  state.hudHeight = mix(state.hudHeight, targetH, 1 - Math.exp(-dt / 160));
}

// Уровень 2: добавить следующее кольцо
function spawnRing() {
  state.birthTimes[state.visible] = state.time;
  state.visible++;
  if (state.visible === N) state.completeAt = state.time;   // вспышка HUD и «29 лет»
}

// =====================================================================
// render — отрисовка кадра
// =====================================================================
function render() {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowBlur = 0;

  // Фон
  ctx.fillStyle = view.bgGradient;
  ctx.fillRect(0, 0, width, height);

  drawRings();

  // Виньетка
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = view.vignette;
  ctx.fillRect(0, 0, width, height);

  drawPointer();
  drawHud();
  drawHint();

  ctx.restore();
}

function drawRings() {
  // Уровень 1: шаг радиуса от размера окна
  const step = view.maxRadius / N;
  // На маленьких экранах не даём линиям слипаться
  const widthCap = Math.max(1.2, step * 0.55);

  // Уровень 3: пульсация с плавным стартом
  let pulseMix = 0;
  let pulseTime = 0;
  if (state.pulseStart >= 0) {
    pulseTime = state.time - state.pulseStart;
    pulseMix = smoothstep01(clamp01(pulseTime / CONFIG.pulseFadeIn));
  }
  const omega = 2 * Math.PI * CONFIG.pulseFrequency / 1000; // рад/мс

  for (let i = 0; i < state.visible; i++) {
    // Уровень 2: анимация появления — easeOutCubic по радиусу, fade-in по альфе
    const p = clamp01((state.time - state.birthTimes[i]) / CONFIG.appearDuration);
    const eased = easeOutCubic(p);

    const rFrom = step * i;          // вырастает от предыдущего кольца
    const rTo = step * (i + 1);
    let r = mix(rFrom, rTo, eased);

    // Уровень 3: волна 1 ± A по синусу, фазовый сдвиг растёт наружу
    if (pulseMix > 0) {
      r *= 1 + CONFIG.pulseAmplitude * pulseMix *
        Math.sin(omega * pulseTime - i * CONFIG.pulsePhaseShift);
    }
    if (r <= 0) continue;

    const lw = Math.min(mix(CONFIG.lineWidthMin, CONFIG.lineWidthMax, i / (N - 1)), widthCap);

    ctx.beginPath();
    ctx.arc(view.cx, view.cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = ringColors[i];

    // Проход 1: мягкое свечение — широкая полупрозрачная линия
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = p * CONFIG.glowAlpha;
    ctx.lineWidth = lw * CONFIG.glowWidthFactor;
    ctx.stroke();

    // Проход 2: основная линия
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = p;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// Уровень 3: кольцо-указатель вокруг курсора, яркость = близость к центру
function drawPointer() {
  if (pointer.alpha < 0.01 || !pointer.known) return;

  const closeness = 1 - pointerDistanceNorm();
  const a = pointer.alpha * (0.12 + 0.68 * Math.pow(closeness, 1.5));
  const r = CONFIG.pointerRadius;

  ctx.strokeStyle = 'rgb(255, 232, 210)';
  ctx.fillStyle = 'rgb(255, 232, 210)';

  // Мягкий ореол
  ctx.globalAlpha = a * 0.25;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(pointer.x, pointer.y, r, 0, Math.PI * 2);
  ctx.stroke();

  // Тонкое кольцо
  ctx.globalAlpha = a;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Точка в центре
  ctx.globalAlpha = a * 0.8;
  ctx.beginPath();
  ctx.arc(pointer.x, pointer.y, 1.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
}

// HUD: «Кольцо 12 / 29», полоска скорости, вспышка и «29 лет»
function drawHud() {
  const x = 18, y = 18, w = 168;
  const baseH = 62, extraH = 38;
  const h = baseH + extraH * state.hudHeight;

  // Вспышка после 29-го кольца
  let flash = 0;
  if (state.completeAt >= 0) {
    flash = 1 - clamp01((state.time - state.completeAt) / CONFIG.hudFlashDuration);
    flash = flash * flash;
  }

  // Подложка
  ctx.save();
  if (flash > 0) {
    ctx.shadowColor = `rgba(255, 180, 110, ${0.45 * flash})`;
    ctx.shadowBlur = 46 * flash;
  }
  roundRectPath(x, y, w, h, 10);
  ctx.fillStyle = `rgba(${mix(255, 255, flash)}, ${mix(240, 214, flash)}, ${mix(225, 170, flash)}, ${mix(0.035, 0.32, flash)})`;
  ctx.fill();
  ctx.restore();

  roundRectPath(x + 0.5, y + 0.5, w - 1, h - 1, 10);
  ctx.strokeStyle = `rgba(255, ${mix(240, 214, flash)}, ${mix(225, 170, flash)}, ${mix(0.06, 0.6, flash)})`;
  ctx.lineWidth = 1;
  ctx.stroke();

  const textA = mix(0.62, 1, flash);
  const strongA = mix(0.9, 1, flash);

  // «Кольцо 12 / 29»
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  setLetterSpacing(0.3);
  let tx = x + 14;
  const ty = y + 27;

  ctx.font = `400 13px ${FONT}`;
  ctx.fillStyle = `rgba(255, 238, 222, ${textA})`;
  ctx.fillText('Кольцо ', tx, ty);
  tx += ctx.measureText('Кольцо ').width;

  ctx.font = `600 13px ${FONT}`;
  ctx.fillStyle = `rgba(255, 244, 232, ${strongA})`;
  const num = String(state.visible);
  ctx.fillText(num, tx, ty);
  tx += ctx.measureText(num).width;

  ctx.font = `400 13px ${FONT}`;
  ctx.fillStyle = `rgba(255, 238, 222, ${textA})`;
  ctx.fillText(` / ${N}`, tx, ty);

  // «СКОРОСТЬ» + тонкая полоска
  ctx.font = `400 10.5px ${FONT}`;
  setLetterSpacing(1.3);
  ctx.fillStyle = 'rgba(255, 238, 222, 0.34)';
  const label = 'СКОРОСТЬ';
  const ly = y + 47;
  ctx.fillText(label, x + 14, ly);
  const labelW = ctx.measureText(label).width;
  setLetterSpacing(0);

  const barX = x + 14 + labelW + 8;
  const barW = x + w - 14 - barX;
  const barY = ly - 4;
  const speed = clamp01((CONFIG.intervalMax - state.interval) / (CONFIG.intervalMax - CONFIG.intervalMin));

  ctx.fillStyle = 'rgba(255, 240, 225, 0.1)';
  ctx.fillRect(barX, barY, barW, 2);

  const fillW = barW * Math.max(0.03, speed);
  const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  grad.addColorStop(0, '#ff9d6b');
  grad.addColorStop(1, '#ffd28f');
  ctx.fillStyle = grad;
  ctx.fillRect(barX, barY, fillW, 2);

  // «29 лет»
  if (state.completeAt >= 0) {
    const t = clamp01((state.time - state.completeAt - 150) / CONFIG.hudYearsFadeIn);
    const e = easeOutCubic(t);
    if (e > 0) {
      ctx.save();
      ctx.globalAlpha = e * state.hudHeight;
      ctx.font = `600 22px ${FONT}`;
      setLetterSpacing(0.2);
      ctx.fillStyle = '#ffc58f';
      ctx.shadowColor = 'rgba(255, 180, 110, 0.45)';
      ctx.shadowBlur = 18;
      ctx.fillText(`${N} ${yearsWord(N)}`, x + 14, y + 88 + (1 - e) * 4);
      ctx.restore();
    }
  }
  setLetterSpacing(0);
}

// Подсказка внизу
function drawHint() {
  ctx.font = `400 12px ${FONT}`;
  setLetterSpacing(0.5);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255, 238, 222, 0.24)';
  ctx.fillText('ближе к центру — быстрее · клик или пробел — заново', width / 2, height - 18);
  ctx.textAlign = 'left';
  setLetterSpacing(0);
}
