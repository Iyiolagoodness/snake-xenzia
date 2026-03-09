import { useState, useEffect, useRef, useCallback } from "react";

const GRID = 25;

function getCell() {
  const maxW = Math.min(window.innerWidth - 16, window.innerHeight - 200, 500);
  return Math.floor(maxW / GRID);
}

const SPEEDS = { easy: 170, medium: 105, hard: 58 };
const FOOD_TYPES = [
  { type: "normal", emoji: "🍎", color: "#ff4455", glow: "#ff2244", points: 10,  weight: 60 },
  { type: "rare",   emoji: "🍇", color: "#bb44ff", glow: "#9922ff", points: 50,  weight: 15 },
  { type: "bomb",   emoji: "💣", color: "#888899", glow: "#555566", points: -20, weight: 10 },
  { type: "time",   emoji: "⏱",  color: "#44aaff", glow: "#2288ff", points: 5,   weight: 15 },
];
const POWERUP_TYPES = [
  { type: "speed",  emoji: "⚡", color: "#ffdd00", label: "Speed Boost!",   duration: 5000 },
  { type: "slow",   emoji: "🐌", color: "#88ff44", label: "Slow Motion!",   duration: 6000 },
  { type: "double", emoji: "⭐", color: "#ffaa00", label: "Double Score!",  duration: 8000 },
  { type: "shield", emoji: "🛡",  color: "#44ddff", label: "Shield Active!", duration: 0    },
];
const SKINS = {
  classic: { name: "Classic",  unlockAt: 0,   head: "#4ade80", body: "#22c55e", tail: "#16a34a" },
  neon:    { name: "Neon",     unlockAt: 50,  head: "#00ffff", body: "#0088ff", tail: "#004499" },
  rainbow: { name: "Rainbow",  unlockAt: 150, head: null,      body: null,      tail: null      },
  fire:    { name: "🔥 Fire",  unlockAt: 300, head: "#ff6600", body: "#ff3300", tail: "#cc0000" },
};
const RAINBOW = ["#ff0000","#ff8800","#ffff00","#00ff00","#0088ff","#8800ff","#ff00ff"];

function createAudio() {
  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function beep(freq, dur, type = "sine", vol = 0.25) {
    try {
      const ac = getCtx();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain); gain.connect(ac.destination);
      osc.type = type; osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      osc.start(); osc.stop(ac.currentTime + dur);
    } catch (e) {}
  }
  return {
    eat:     () => { beep(520, 0.08, "square", 0.15); setTimeout(() => beep(780, 0.08, "square", 0.1), 70); },
    rare:    () => { [400,600,800,1000].forEach((f,i) => setTimeout(() => beep(f, 0.1, "sine", 0.18), i*55)); },
    powerup: () => { [300,500,700,900].forEach((f,i) => setTimeout(() => beep(f, 0.09, "triangle", 0.2), i*45)); },
    die:     () => { beep(200, 0.3, "sawtooth", 0.35); setTimeout(() => beep(100, 0.45, "sawtooth", 0.25), 200); },
    portal:  () => { beep(440, 0.12, "sine"); setTimeout(() => beep(880, 0.12, "sine"), 130); },
    click:   () => beep(440, 0.04, "square", 0.08),
    combo:   (n) => beep(400 + n*80, 0.18, "triangle", 0.2),
    levelup: () => { [500,700,900,1100].forEach((f,i) => setTimeout(() => beep(f, 0.12, "sine", 0.22), i*60)); },
  };
}

const rnd = (n) => Math.floor(Math.random() * n);
const randCell = () => ({ x: rnd(GRID), y: rnd(GRID) });
const cellEq = (a, b) => a.x === b.x && a.y === b.y;

function weightedRandom(items) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) { r -= item.weight; if (r <= 0) return item; }
  return items[0];
}

function freeCell(snake, foods, obstacles, powerups) {
  const occ = new Set([
    ...snake.map(s=>`${s.x},${s.y}`),
    ...foods.map(f=>`${f.x},${f.y}`),
    ...obstacles.map(o=>`${o.x},${o.y}`),
    ...powerups.map(p=>`${p.x},${p.y}`),
  ]);
  // Fast random search first
  for (let i = 0; i < 300; i++) {
    const c = randCell();
    if (!occ.has(`${c.x},${c.y}`)) return c;
  }
  // Full grid scan fallback — guarantees a result
  for (let x = 0; x < GRID; x++)
    for (let y = 0; y < GRID; y++)
      if (!occ.has(`${x},${y}`)) return { x, y };
  return randCell(); // grid completely full (shouldn't happen)
}

function makeObstacles(level, snake) {
  if (level < 2) return [];
  const count = Math.min((level - 1) * 4, 20);
  const obs = [];
  for (let i = 0; i < count; i++) {
    let c;
    do { c = randCell(); } while (snake.some(s => cellEq(s, c)) || obs.some(o => cellEq(o, c)));
    obs.push(c);
  }
  return obs;
}

function makePortals(snake, obstacles) {
  const a = freeCell(snake, [], obstacles, []);
  const b = freeCell(snake, [], obstacles, [{ ...a }]);
  return [{ ...a, exit: b, color: "#ff44ff" }, { ...b, exit: a, color: "#44ffff" }];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

export default function SnakeStudio() {
  const [cell, setCell] = useState(getCell);
  const W = GRID * cell;

  useEffect(() => {
    function onResize() { setCell(getCell()); }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [screen, setScreen]           = useState("menu");
  const [difficulty, setDifficulty]   = useState("medium");
  const [mode, setMode]               = useState("classic");
  const [soundOn, setSoundOn]         = useState(true);
  const [selectedSkin, setSkin]       = useState("classic");
  const [highScore, setHighScore]     = useState(0);
  const [scoreDisp, setScoreDisp]     = useState(0);
  const [levelDisp, setLevelDisp]     = useState(1);
  const [comboDisp, setComboDisp]     = useState(0);
  const [timeDisp, setTimeDisp]       = useState(60);
  const [activePU, setActivePU]       = useState([]);
  const [achievement, setAchievement] = useState(null);
  const [shieldActive, setShieldActive] = useState(false);
  const [countdown, setCountdown]       = useState(null); // null | "READY" | "3" | "2" | "1" | "GO!"

  const canvasRef  = useRef(null);
  const gameRef    = useRef(null);
  const audioRef   = useRef(createAudio());
  const animRef    = useRef(null);
  const achTimer   = useRef(null);
  const touchStart = useRef(null);

  const sfx = useCallback((name, ...args) => {
    if (soundOn) audioRef.current[name]?.(...args);
  }, [soundOn]);

  function toast(msg) {
    clearTimeout(achTimer.current);
    setAchievement(msg);
    achTimer.current = setTimeout(() => setAchievement(null), 3000);
  }

  function spawnFood(snake, foods, obstacles, powerupItems) {
    return { ...freeCell(snake, foods, obstacles, powerupItems), ...weightedRandom(FOOD_TYPES), id: Math.random() };
  }

  function initGame() {
    const initSnake = [{ x: 12, y: 12 }, { x: 11, y: 12 }, { x: 10, y: 12 }];
    const obs = makeObstacles(1, initSnake);
    const portals = mode === "classic" ? makePortals(initSnake, obs) : [];
    gameRef.current = {
      snake: initSnake, dir: { x: 1, y: 0 }, nextDir: { x: 1, y: 0 },
      foods: [spawnFood(initSnake, [], obs, [])],
      powerupItems: [], activePowerups: {}, score: 0, level: 1,
      combo: 0, lastEatTime: 0, obstacles: obs, portals, particles: [],
      timeLeft: 60, foodEaten: 0, achievements: new Set(),
      accumulator: 0, running: true, lastTimestamp: null,
    };
    setScoreDisp(0); setLevelDisp(1); setComboDisp(0);
    setTimeDisp(60); setActivePU([]); setShieldActive(false);
  }

  useEffect(() => {
    if (screen !== "playing") { cancelAnimationFrame(animRef.current); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    function getSpeed() {
      const g = gameRef.current;
      if (!g) return SPEEDS[difficulty];
      let spd = Math.max(38, SPEEDS[difficulty] - g.foodEaten * 2);
      if (g.activePowerups.speed) spd = Math.max(28, spd * 0.5);
      if (g.activePowerups.slow)  spd = spd * 1.9;
      return spd;
    }

    function loop(ts) {
      const g = gameRef.current;
      if (!g || !g.running) return;
      if (g.lastTimestamp === null) g.lastTimestamp = ts;
      const dt = Math.min(ts - g.lastTimestamp, 100);
      g.lastTimestamp = ts;
      g.accumulator += dt;

      if (mode === "timeattack") {
        g.timeLeft = Math.max(0, g.timeLeft - dt / 1000);
        setTimeDisp(Math.ceil(g.timeLeft));
        if (g.timeLeft <= 0) { endGame(); return; }
      }

      for (const key of Object.keys(g.activePowerups)) {
        if (key === "shield") continue;
        if (ts >= g.activePowerups[key].endsAt) delete g.activePowerups[key];
      }
      setActivePU(Object.keys(g.activePowerups));
      setShieldActive(!!g.activePowerups.shield);

      g.particles = g.particles
        .map(p => ({ ...p, x: p.x+p.vx, y: p.y+p.vy, life: p.life-1, vy: p.vy+0.12 }))
        .filter(p => p.life > 0);

      const C = getCell();
      const spd = getSpeed();
      while (g.accumulator >= spd) {
        g.accumulator -= spd;
        tick(g, ts, C);
        if (!g.running) return;
      }
      draw(ctx, g, ts, C);
      animRef.current = requestAnimationFrame(loop);
    }

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [screen, difficulty, mode, selectedSkin, soundOn, cell]);

  function tick(g, now, C) {
    g.dir = { ...g.nextDir };
    const head = { x: g.snake[0].x + g.dir.x, y: g.snake[0].y + g.dir.y };

    let teleported = false;
    for (const portal of g.portals) {
      if (cellEq(head, portal)) {
        head.x = portal.exit.x; head.y = portal.exit.y; teleported = true;
        sfx("portal"); spawnParticles(g, head.x*C+C/2, head.y*C+C/2, portal.color, 14); break;
      }
    }

    const wallHit = !teleported && (head.x<0||head.x>=GRID||head.y<0||head.y>=GRID);
    const selfHit = g.snake.some(s=>cellEq(s,head));
    const obsHit  = g.obstacles.some(o=>cellEq(o,head));

    if (wallHit || selfHit || obsHit) {
      if (g.activePowerups.shield) {
        delete g.activePowerups.shield; setShieldActive(false); toast("🛡 Shield absorbed hit!");
        // Wall hit: wrap to opposite side so snake keeps moving safely
        if (wallHit) {
          head.x = (head.x + GRID) % GRID;
          head.y = (head.y + GRID) % GRID;
        } else {
          // Obstacle or self hit: reverse direction so snake bounces away
          // and resets accumulator to give player time to react
          // Obstacle hit: just pass through (don't return, let snake continue)
          // Self hit: reverse so snake bounces away
          if (selfHit) {
            const rev = { x: -g.dir.x, y: -g.dir.y };
            g.dir = rev;
            g.nextDir = rev;
            g.accumulator = 0;
            return;
          }
          // obsHit: fall through and keep moving into that cell
        }
      } else {
        endGame(); return;
      }
    }

    g.snake.unshift(head);
    let grew = false;
    g.foods = g.foods.filter(food => { if (!cellEq(head,food)) return true; grew=true; handleFoodEat(g,food,now,C); return false; });
    g.powerupItems = g.powerupItems.filter(pu => { if (!cellEq(head,pu)) return true; handlePowerupEat(g,pu,now); return false; });
    if (!grew) g.snake.pop();

    while (g.foods.length < 1) g.foods.push(spawnFood(g.snake, g.foods, g.obstacles, g.powerupItems));
    if (Math.random() < 0.004 && g.foods.length < 3) g.foods.push(spawnFood(g.snake, g.foods, g.obstacles, g.powerupItems));
    if (Math.random() < 0.007 && g.powerupItems.length < 2) {
      const puType = POWERUP_TYPES[rnd(POWERUP_TYPES.length)];
      g.powerupItems.push({ ...freeCell(g.snake, g.foods, g.obstacles, g.powerupItems), ...puType, id: Math.random() });
    }
  }

  function handleFoodEat(g, food, now, C) {
    const timeSinceLast = now - g.lastEatTime;
    if (timeSinceLast < 3000 && g.lastEatTime > 0) g.combo++; else g.combo = 1;
    g.lastEatTime = now;
    const mult = g.activePowerups.double ? 2 : 1;
    const comboBonus = g.combo >= 3 ? (g.combo - 2) * 5 : 0;
    g.score = Math.max(0, g.score + (food.points >= 0 ? (food.points + comboBonus) * mult : food.points));
    g.foodEaten++;
    setScoreDisp(g.score); setComboDisp(g.combo);
    const newLevel = Math.floor(g.foodEaten / 5) + 1;
    if (newLevel > g.level) {
      g.level = newLevel; setLevelDisp(newLevel);
      const newObs = makeObstacles(newLevel, g.snake);
      g.obstacles = newObs;
      // Remove food/powerups buried under new obstacles, then respawn
      g.foods = g.foods.filter(f => !newObs.some(o => cellEq(o, f)));
      g.powerupItems = g.powerupItems.filter(p => !newObs.some(o => cellEq(o, p)));
      if (g.foods.length === 0)
        g.foods.push(spawnFood(g.snake, [], newObs, g.powerupItems));
      sfx("levelup"); toast(`⬆ Level ${newLevel}!`);
    }
    spawnParticles(g, food.x*C+C/2, food.y*C+C/2, food.glow, food.type==="bomb"?22:12);
    if (food.type==="rare") sfx("rare"); else sfx("eat");
    if (food.type==="time" && mode==="timeattack") { g.timeLeft=Math.min(60,g.timeLeft+10); toast("⏱ +10 seconds!"); }
    if (g.score > highScore) setHighScore(g.score);
    const ach = g.achievements;
    if (!ach.has("combo3")&&g.combo>=3){ ach.add("combo3"); toast("🏆 Combo Master! x"+g.combo); sfx("combo",g.combo); }
    if (!ach.has("c100")&&g.score>=100){ ach.add("c100"); toast("🏆 Century Club!"); }
    if (!ach.has("c500")&&g.score>=500){ ach.add("c500"); toast("🏆 High Roller!"); }
    if (!ach.has("rare")&&food.type==="rare"){ ach.add("rare"); toast("🏆 Rare Find! +50!"); }
    if (!ach.has("long")&&g.snake.length>=15){ ach.add("long"); toast("🏆 Big Snake! x15"); }
  }

  function handlePowerupEat(g, pu, now) {
    sfx("powerup");
    spawnParticles(g, pu.x*cell+cell/2, pu.y*cell+cell/2, pu.color, 22);
    if (pu.type==="shield") g.activePowerups.shield={endsAt:Infinity};
    else g.activePowerups[pu.type]={endsAt:now+pu.duration};
    setActivePU(Object.keys(g.activePowerups));
    toast(`${pu.emoji} ${pu.label}`);
  }

  function spawnParticles(g, x, y, color, count) {
    for (let i=0; i<count; i++) {
      const angle=(Math.PI*2*i)/count+Math.random()*0.4, speed=1.5+Math.random()*2.5;
      g.particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-1,color,life:22+rnd(14),size:2+Math.random()*3});
    }
  }

  function endGame() {
    if (!gameRef.current) return;
    gameRef.current.running=false; sfx("die");
    cancelAnimationFrame(animRef.current);
    setTimeout(() => setScreen("gameover"), 200);
  }

  function draw(ctx, g, now, C) {
    const GW=GRID*C, skin=SKINS[selectedSkin];
    ctx.clearRect(0,0,GW,GW); ctx.fillStyle="#080810"; ctx.fillRect(0,0,GW,GW);
    ctx.strokeStyle="rgba(255,255,255,0.028)"; ctx.lineWidth=0.5;
    for (let i=0;i<=GRID;i++) {
      ctx.beginPath();ctx.moveTo(i*C,0);ctx.lineTo(i*C,GW);ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,i*C);ctx.lineTo(GW,i*C);ctx.stroke();
    }
    for (const portal of g.portals) {
      const px=portal.x*C+C/2,py=portal.y*C+C/2;
      const grd=ctx.createRadialGradient(px,py,2,px,py,C*0.75);
      grd.addColorStop(0,portal.color+"cc"); grd.addColorStop(1,"transparent");
      ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(px,py,C*0.75,0,Math.PI*2); ctx.fill();
      ctx.save(); ctx.translate(px,py); ctx.rotate(now*0.003);
      ctx.strokeStyle=portal.color; ctx.lineWidth=2; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.arc(0,0,C*0.72,0,Math.PI*2); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
    }
    for (const obs of g.obstacles) {
      const ox=obs.x*C+1,oy=obs.y*C+1,sz=C-2;
      ctx.fillStyle="#1e2030"; roundRect(ctx,ox,oy,sz,sz,3); ctx.fill();
      ctx.strokeStyle="#444466"; ctx.lineWidth=1; roundRect(ctx,ox,oy,sz,sz,3); ctx.stroke();
    }
    for (const food of g.foods) {
      const fx=food.x*C+C/2,fy=food.y*C+C/2,pulse=0.88+0.12*Math.sin(now*0.004+food.id*9);
      ctx.save(); ctx.shadowColor=food.glow; ctx.shadowBlur=14*pulse;
      ctx.font=`${Math.round(C*0.85)}px serif`; ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(food.emoji,fx,fy); ctx.restore();
    }
    for (const pu of g.powerupItems) {
      const px=pu.x*C+C/2,py=pu.y*C+C/2,pulse=0.82+0.18*Math.sin(now*0.005);
      ctx.save(); ctx.shadowColor=pu.color; ctx.shadowBlur=18*pulse;
      ctx.save(); ctx.translate(px,py); ctx.rotate(now*0.004);
      ctx.strokeStyle=pu.color; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(0,0,C*0.62,0,Math.PI*2); ctx.stroke(); ctx.restore();
      ctx.font=`${Math.round(C*0.78)}px serif`; ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText(pu.emoji,px,py); ctx.restore();
    }
    for (let i=g.snake.length-1;i>=0;i--) {
      const seg=g.snake[i],sx=seg.x*C+1,sy=seg.y*C+1,sz=C-2;
      const isHead=i===0,isTail=i===g.snake.length-1;
      let color=selectedSkin==="rainbow"?RAINBOW[i%RAINBOW.length]:isHead?skin.head:isTail?skin.tail:skin.body;
      if (g.activePowerups.shield){ctx.shadowColor="#44ddff";ctx.shadowBlur=10;}
      ctx.fillStyle=color; roundRect(ctx,sx,sy,sz,sz,isHead?Math.max(3,C*0.35):isTail?2:Math.max(2,C*0.2)); ctx.fill();
      ctx.shadowBlur=0;
      const shine=ctx.createLinearGradient(sx,sy,sx,sy+sz*0.55);
      shine.addColorStop(0,"rgba(255,255,255,0.22)"); shine.addColorStop(1,"rgba(255,255,255,0)");
      ctx.fillStyle=shine; roundRect(ctx,sx,sy,sz,sz*0.55,isHead?Math.max(3,C*0.35):2); ctx.fill();
      if (isHead) {
        const mx=sx+sz/2,my=sy+sz/2,eo=C*0.18,er=Math.max(1.5,C*0.14),pr=Math.max(0.8,C*0.07);
        let ex1,ey1,ex2,ey2;
        if(g.dir.x===1){ex1=mx+eo;ey1=my-eo;ex2=mx+eo;ey2=my+eo;}
        else if(g.dir.x===-1){ex1=mx-eo;ey1=my-eo;ex2=mx-eo;ey2=my+eo;}
        else if(g.dir.y===-1){ex1=mx-eo;ey1=my-eo;ex2=mx+eo;ey2=my-eo;}
        else{ex1=mx-eo;ey1=my+eo;ex2=mx+eo;ey2=my+eo;}
        ctx.fillStyle="#fff";
        ctx.beginPath();ctx.arc(ex1,ey1,er,0,Math.PI*2);ctx.fill();
        ctx.beginPath();ctx.arc(ex2,ey2,er,0,Math.PI*2);ctx.fill();
        ctx.fillStyle="#111";
        ctx.beginPath();ctx.arc(ex1+g.dir.x*pr,ey1+g.dir.y*pr,pr,0,Math.PI*2);ctx.fill();
        ctx.beginPath();ctx.arc(ex2+g.dir.x*pr,ey2+g.dir.y*pr,pr,0,Math.PI*2);ctx.fill();
      }
    }
    for (const p of g.particles) {
      ctx.globalAlpha=Math.max(0,p.life/36);ctx.fillStyle=p.color;
      ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();
    }
    ctx.globalAlpha=1;
  }

  useEffect(() => {
    const DIR={ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},w:{x:0,y:-1},s:{x:0,y:1},a:{x:-1,y:0},d:{x:1,y:0}};
    const handler=(e)=>{
      const g=gameRef.current, nd=DIR[e.key]||DIR[e.key?.toLowerCase()];
      if(nd&&g){if(nd.x!==-g.dir.x||nd.y!==-g.dir.y)g.nextDir=nd;e.preventDefault();return;}
      if((e.key==="Escape"||e.key==="p"||e.key==="P")&&screen==="playing"){if(g)g.running=false;cancelAnimationFrame(animRef.current);setScreen("paused");}
    };
    window.addEventListener("keydown",handler);
    return ()=>window.removeEventListener("keydown",handler);
  },[screen]);

  // Touch swipe
  useEffect(()=>{
    const onTS=(e)=>{const t=e.touches[0];touchStart.current={x:t.clientX,y:t.clientY};};
    const onTE=(e)=>{
      if(!touchStart.current)return;
      const t=e.changedTouches[0],dx=t.clientX-touchStart.current.x,dy=t.clientY-touchStart.current.y;
      touchStart.current=null;
      if(Math.abs(dx)<8&&Math.abs(dy)<8)return;
      const g=gameRef.current;if(!g)return;
      let nd;
      if(Math.abs(dx)>Math.abs(dy))nd=dx>0?{x:1,y:0}:{x:-1,y:0};
      else nd=dy>0?{x:0,y:1}:{x:0,y:-1};
      if(nd.x!==-g.dir.x||nd.y!==-g.dir.y)g.nextDir=nd;
    };
    window.addEventListener("touchstart",onTS,{passive:true});
    window.addEventListener("touchend",onTE,{passive:true});
    return()=>{window.removeEventListener("touchstart",onTS);window.removeEventListener("touchend",onTE);};
  },[]);

  function runCountdown(steps, onDone) {
    let i = 0;
    setCountdown(steps[0]);
    const iv = setInterval(() => {
      i++;
      if (i < steps.length) {
        setCountdown(steps[i]);
      } else {
        clearInterval(iv);
        setCountdown(null);
        onDone();
      }
    }, 800);
  }

  function startGame() {
    initGame();
    setScreen("countdown");
    runCountdown(["READY", "3", "2", "1", "GO!"], () => setScreen("playing"));
  }

  function resume() {
    if (!gameRef.current) return;
    setScreen("countdown");
    runCountdown(["3", "2", "1", "GO!"], () => {
      if (!gameRef.current) return;
      gameRef.current.running = true;
      gameRef.current.lastTimestamp = null;
      setScreen("playing");
    });
  }
  const skinUnlocked=(k)=>highScore>=SKINS[k].unlockAt;

  function pressDir(nd){const g=gameRef.current;if(!g)return;if(nd.x!==-g.dir.x||nd.y!==-g.dir.y)g.nextDir=nd;}

  const CSS=`
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&display=swap');
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
    body{background:#05050c;overflow-x:hidden;}
    @keyframes glow2{0%,100%{text-shadow:0 0 20px #00ff88,0 0 40px #00ff4444}50%{text-shadow:0 0 40px #00ff88,0 0 80px #00ff44}}
    @keyframes slideIn{from{transform:translateY(-20px);opacity:0}to{transform:translateY(0);opacity:1}}
    @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}
    @keyframes achIn{from{transform:translateX(120px);opacity:0}10%{transform:translateX(0);opacity:1}80%{opacity:1}to{opacity:0}}
    @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
    @keyframes comboFlash{0%,100%{color:#ffdd00}50%{color:#ff8800}}
    .btn{font-family:'Share Tech Mono',monospace;background:#060f06;border:1px solid #1a5a1a;color:#88ff88;padding:9px 16px;font-size:clamp(11px,3vw,13px);cursor:pointer;border-radius:4px;letter-spacing:1.5px;transition:all 0.18s;outline:none;touch-action:manipulation;}
    .btn:hover,.btn:active{background:#0d2a0d;border-color:#44ff44;color:#fff;}
    .btn.primary{background:#0a2a0a;border-color:#00ff88;color:#00ff88;}
    .btn.sel{background:#0a3a0a;border-color:#00ff88;color:#00ff88;}
    .hud{background:#060d06;border:1px solid #142414;border-radius:6px;padding:5px 10px;text-align:center;}
    .hud-l{font-size:clamp(8px,2vw,9px);letter-spacing:2px;color:#336633;font-family:'Share Tech Mono',monospace;}
    .hud-v{font-size:clamp(15px,4vw,20px);font-weight:bold;font-family:'Orbitron',monospace;}
    .dpad{padding:12px 0 8px;}
    .dpad-btn{width:clamp(64px,18vw,80px);height:clamp(64px,18vw,80px);background:#0d1f0d;border:2px solid #2a5a2a;border-radius:16px;color:#66ee66;font-size:clamp(22px,7vw,30px);cursor:pointer;display:flex;align-items:center;justify-content:center;user-select:none;-webkit-user-select:none;touch-action:manipulation;box-shadow:0 4px 12px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.06);}
    .dpad-btn:active{background:#162a16;border-color:#44ff44;color:#fff;transform:scale(0.93);}
    .dpad-pause{width:clamp(54px,15vw,68px);height:clamp(54px,15vw,68px);background:#0a140a;border:2px solid #1a3a1a;border-radius:50%;color:#336633;font-size:clamp(18px,5vw,24px);}
    @media (hover:hover) and (pointer:fine){.dpad{display:none !important;}}
  `;

  const wrap={minHeight:"100vh",background:"radial-gradient(ellipse 90% 60% at 50% 0%,#081508 0%,#05050c 55%)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"8px",fontFamily:"'Share Tech Mono',monospace",color:"#c8ffc8",overflowX:"hidden"};

  if(screen==="countdown") return(
    <div style={{...wrap,justifyContent:"center"}}>
      <style>{CSS}</style>
      <div style={{
        fontFamily:"'Orbitron',monospace",
        fontSize: countdown==="READY" ? "clamp(32px,10vw,52px)" : countdown==="GO!" ? "clamp(48px,14vw,80px)" : "clamp(72px,20vw,120px)",
        color: countdown==="GO!" ? "#00ff88" : countdown==="READY" ? "#888888" : "#ffffff",
        textShadow: countdown==="GO!" ? "0 0 40px #00ff88, 0 0 80px #00ff4488" : countdown==="READY" ? "none" : "0 0 30px #ffffff88",
        letterSpacing: countdown==="READY" ? 8 : 4,
        animation: "slideIn 0.3s ease",
        userSelect: "none",
      }}>
        {countdown}
      </div>
    </div>
  );

  if(screen==="menu") return(
    <div style={wrap}>
      <style>{CSS}</style>
      <div style={{animation:"slideIn 0.5s ease",textAlign:"center",width:"100%",maxWidth:440,padding:"0 8px"}}>
        <div style={{fontSize:"clamp(36px,10vw,56px)",marginBottom:2}}>🐍</div>
        <h1 style={{fontFamily:"'Orbitron',monospace",fontSize:"clamp(26px,8vw,38px)",color:"#00ff88",margin:"0 0 2px",animation:"glow2 2.5s infinite",letterSpacing:"clamp(2px,1vw,5px)"}}>SNAKE</h1>
        <div style={{fontSize:"clamp(9px,2.5vw,11px)",letterSpacing:"clamp(3px,1.5vw,7px)",color:"#336633",marginBottom:20}}>STUDIO</div>
        <div style={{background:"#080f08",border:"1px solid #142414",borderRadius:8,padding:"14px 16px",marginBottom:10}}>
          <div style={{fontSize:"clamp(9px,2vw,10px)",letterSpacing:3,color:"#336633",marginBottom:8}}>MODE</div>
          <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:12,flexWrap:"wrap"}}>
            {[["classic","🎮 Classic"],["timeattack","⏱ Time Attack"]].map(([m,label])=>(
              <button key={m} className={`btn${mode===m?" sel":""}`} onClick={()=>{setMode(m);sfx("click");}}>{label}</button>
            ))}
          </div>
          <div style={{fontSize:"clamp(9px,2vw,10px)",letterSpacing:3,color:"#336633",marginBottom:8}}>DIFFICULTY</div>
          <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:12,flexWrap:"wrap"}}>
            {[["easy","🟢"],["medium","🟡"],["hard","🔴"]].map(([d,icon])=>(
              <button key={d} className={`btn${difficulty===d?" sel":""}`} onClick={()=>{setDifficulty(d);sfx("click");}}>{icon} {d}</button>
            ))}
          </div>
          <div style={{fontSize:"clamp(9px,2vw,10px)",letterSpacing:3,color:"#336633",marginBottom:8}}>SKIN</div>
          <div style={{display:"flex",gap:5,justifyContent:"center",flexWrap:"wrap"}}>
            {Object.entries(SKINS).map(([key,sk])=>{
              const u=skinUnlocked(key);
              return(<span key={key} onClick={()=>{if(u){setSkin(key);sfx("click");}}}
                style={{display:"inline-block",padding:"4px 10px",borderRadius:20,fontSize:"clamp(10px,2.5vw,11px)",cursor:u?"pointer":"not-allowed",border:`1px solid ${selectedSkin===key?"#00ff88":u?"#2a4a2a":"#1a1a1a"}`,color:selectedSkin===key?"#00ff88":u?"#88cc88":"#333",background:selectedSkin===key?"#0a2a0a":"transparent",letterSpacing:1}}>
                {u?sk.name:`🔒 ${sk.name} (${sk.unlockAt})`}
              </span>);
            })}
          </div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:12}}>
          <div className="hud"><div className="hud-l">BEST</div><div className="hud-v" style={{color:"#ffdd00"}}>{highScore}</div></div>
          <div className="hud" style={{display:"flex",flexDirection:"column",justifyContent:"center",gap:4}}>
            <div className="hud-l">SOUND</div>
            <button className="btn" style={{padding:"4px 10px",fontSize:"clamp(10px,2.5vw,11px)"}} onClick={()=>setSoundOn(v=>!v)}>{soundOn?"🔊 ON":"🔇 OFF"}</button>
          </div>
        </div>
        <button className="btn primary" style={{fontSize:"clamp(14px,4vw,17px)",padding:"12px clamp(24px,7vw,52px)",letterSpacing:"clamp(2px,1vw,4px)"}} onClick={()=>{sfx("click");startGame();}}>▶ START</button>
        <div style={{marginTop:10,fontSize:"clamp(9px,2vw,10px)",color:"#224422",letterSpacing:2}}>WASD / ARROWS / SWIPE · P PAUSE</div>
      </div>
    </div>
  );

  if(screen==="paused") return(
    <div style={wrap}>
      <style>{CSS}</style>
      <div style={{textAlign:"center"}}>
        <div style={{fontFamily:"'Orbitron',monospace",fontSize:"clamp(26px,8vw,36px)",color:"#ffdd00",letterSpacing:5,marginBottom:8}}>PAUSED</div>
        <div style={{color:"#448844",marginBottom:20,fontSize:"clamp(12px,3vw,14px)"}}>Score: <b style={{color:"#00ff88"}}>{scoreDisp}</b></div>
        <div style={{display:"flex",gap:10,justifyContent:"center"}}>
          <button className="btn primary" onClick={resume}>▶ RESUME</button>
          <button className="btn" onClick={()=>setScreen("menu")}>⬅ MENU</button>
        </div>
      </div>
    </div>
  );

  if(screen==="gameover") return(
    <div style={wrap}>
      <style>{CSS}</style>
      <div style={{textAlign:"center",animation:"shake 0.5s ease"}}>
        <div style={{fontSize:"clamp(36px,10vw,52px)",marginBottom:6}}>💀</div>
        <div style={{fontFamily:"'Orbitron',monospace",fontSize:"clamp(22px,7vw,34px)",color:"#ff4444",letterSpacing:5,marginBottom:16}}>GAME OVER</div>
        <div style={{background:"#080f08",border:"1px solid #142414",borderRadius:8,padding:"16px 28px",marginBottom:20,display:"inline-block"}}>
          <div style={{fontSize:"clamp(9px,2vw,10px)",letterSpacing:3,color:"#336633",marginBottom:4}}>FINAL SCORE</div>
          <div style={{fontFamily:"'Orbitron',monospace",fontSize:"clamp(34px,10vw,48px)",color:"#00ff88",marginBottom:4}}>{scoreDisp}</div>
          {scoreDisp>0&&scoreDisp>=highScore&&<div style={{color:"#ffdd00",fontSize:"clamp(11px,3vw,13px)",marginBottom:6}}>🏆 NEW HIGH SCORE!</div>}
          <div style={{fontSize:"clamp(10px,2.5vw,12px)",color:"#336633"}}>Best: {highScore}</div>
        </div>
        <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
          <button className="btn primary" style={{fontSize:"clamp(12px,3.5vw,14px)",padding:"11px 22px"}} onClick={()=>{sfx("click");startGame();}}>🔄 PLAY AGAIN</button>
          <button className="btn" onClick={()=>setScreen("menu")}>⬅ MENU</button>
        </div>
      </div>
    </div>
  );

  return(
    <div style={{...wrap,justifyContent:"flex-start",paddingTop:8}}>
      <style>{CSS}</style>
      {/* HUD */}
      <div style={{width:W,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,gap:6}}>
        <div style={{display:"flex",gap:6}}>
          <div className="hud"><div className="hud-l">SCORE</div><div className="hud-v" style={{color:"#00ff88"}}>{scoreDisp}</div></div>
          <div className="hud"><div className="hud-l">BEST</div><div className="hud-v" style={{color:"#ffdd00"}}>{highScore}</div></div>
          {comboDisp>=2&&<div className="hud" style={{borderColor:"#554400",background:"#0a0800",animation:"float 0.6s infinite"}}><div className="hud-l" style={{color:"#665500"}}>COMBO</div><div className="hud-v" style={{animation:"comboFlash 0.4s infinite"}}>×{comboDisp}</div></div>}
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {mode==="timeattack"&&<div className="hud" style={{borderColor:timeDisp<=10?"#aa2222":"#142414"}}><div className="hud-l" style={{color:timeDisp<=10?"#664444":"#336633"}}>TIME</div><div className="hud-v" style={{color:timeDisp<=10?"#ff4444":"#00ff88"}}>{timeDisp}s</div></div>}
          <div className="hud"><div className="hud-l">LVL</div><div className="hud-v" style={{color:"#88aaff"}}>{levelDisp}</div></div>
        </div>
      </div>

      {/* Canvas */}
      <div style={{position:"relative"}}>
        <canvas ref={canvasRef} width={W} height={W}
          style={{border:"1px solid #1a4a1a",borderRadius:6,display:"block",boxShadow:"0 0 48px #00ff4418,0 0 2px #00ff4444",touchAction:"none"}}/>
        {activePU.length>0&&(
          <div style={{position:"absolute",bottom:8,left:8,display:"flex",gap:5}}>
            {activePU.map(p=>{const pu=POWERUP_TYPES.find(x=>x.type===p);return pu?<div key={p} style={{background:"rgba(0,0,0,0.85)",border:`1px solid ${pu.color}`,borderRadius:4,padding:"3px 8px",fontSize:13,color:pu.color,animation:"float 1s infinite"}}>{pu.emoji}</div>:null;})}
          </div>
        )}
        {shieldActive&&<div style={{position:"absolute",top:8,left:8,background:"rgba(0,0,0,0.85)",border:"1px solid #44ddff",borderRadius:4,padding:"3px 8px",fontSize:"clamp(10px,2.5vw,11px)",color:"#44ddff"}}>🛡 SHIELD</div>}
      </div>

      {/* D-Pad */}
      <div className="dpad" style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10}}>
        <button className="dpad-btn" onTouchStart={(e)=>{e.preventDefault();pressDir({x:0,y:-1});}} onClick={()=>pressDir({x:0,y:-1})}>▲</button>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <button className="dpad-btn" onTouchStart={(e)=>{e.preventDefault();pressDir({x:-1,y:0});}} onClick={()=>pressDir({x:-1,y:0})}>◄</button>
          <button className="dpad-btn dpad-pause"
            onTouchStart={(e)=>{e.preventDefault();if(gameRef.current)gameRef.current.running=false;cancelAnimationFrame(animRef.current);setScreen("paused");}}
            onClick={()=>{if(gameRef.current)gameRef.current.running=false;cancelAnimationFrame(animRef.current);setScreen("paused");}}>⏸</button>
          <button className="dpad-btn" onTouchStart={(e)=>{e.preventDefault();pressDir({x:1,y:0});}} onClick={()=>pressDir({x:1,y:0})}>►</button>
        </div>
        <button className="dpad-btn" onTouchStart={(e)=>{e.preventDefault();pressDir({x:0,y:1});}} onClick={()=>pressDir({x:0,y:1})}>▼</button>
      </div>

      {achievement&&(
        <div style={{position:"fixed",top:60,right:12,background:"#060f06",border:"1px solid #00ff88",borderRadius:8,padding:"9px 16px",color:"#00ff88",fontSize:"clamp(11px,3vw,13px)",fontWeight:"bold",animation:"achIn 3s ease forwards",zIndex:999,letterSpacing:1,maxWidth:"70vw"}}>
          {achievement}
        </div>
      )}
    </div>
  );
}
