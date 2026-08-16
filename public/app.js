let token = localStorage.getItem('terra_token');
let gameState = null;
let activePlanet = null;
let socket = null;

const authModal = document.getElementById('auth-modal');
const adminModal = document.getElementById('admin-modal');
const gameContainer = document.getElementById('game-container');
const chatContainer = document.getElementById('chat-container');
const authError = document.getElementById('auth-error');
const canvas = document.getElementById('planetCanvas');
const ctx = canvas.getContext('2d');
const bgCanvas = document.getElementById('starfield');
const bgCtx = bgCanvas.getContext('2d');

/* --- PARALLAX STARS --- */
let stars = [];
function initStarfield() {
  bgCanvas.width = window.innerWidth; bgCanvas.height = window.innerHeight;
  stars = [];
  for(let i = 0; i < 250; i++) {
    stars.push({ 
      x: Math.random() * bgCanvas.width, y: Math.random() * bgCanvas.height, 
      radius: Math.random() * 1.8, 
      speed: Math.random() * 0.4 + 0.1,
      layer: Math.floor(Math.random() * 3)
    });
  }
}
window.addEventListener('resize', initStarfield);
function animateStars() {
  bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
  stars.forEach(s => {
    bgCtx.fillStyle = s.layer === 2 ? '#00f0ff' : '#ffffff';
    bgCtx.globalAlpha = s.layer === 2 ? 0.8 : 0.4;
    bgCtx.beginPath(); bgCtx.arc(s.x, s.y, s.radius, 0, Math.PI * 2); bgCtx.fill();
    s.y -= s.speed;
    if(s.y < 0) { s.y = bgCanvas.height; s.x = Math.random() * bgCanvas.width; }
  });
  requestAnimationFrame(animateStars);
}
initStarfield(); animateStars();

/* --- SOCKET.IO --- */
function setupSocket() {
  if (!socket) {
    socket = io();
    socket.on('connect', () => socket.emit('authenticate', token));
    socket.on('new_message', (msg) => {
      const messagesDiv = document.getElementById('chat-messages');
      const row = document.createElement('div');
      row.className = 'msg-row ' + (msg.role === 'admin' ? 'msg-admin glitch-sm' : '');
      row.innerHTML = `<span class="msg-time">[${msg.timestamp}]</span> <span class="msg-user">${msg.role === 'admin' ? '👑 SYSTEM_OVERRIDE' : msg.username}:</span> <span class="msg-text">${msg.text}</span>`;
      messagesDiv.appendChild(row);
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    });
    socket.on('force_logout', (reason) => {
      alert(reason); localStorage.removeItem('terra_token'); location.reload();
    });
  }
}

document.getElementById('chat-send').addEventListener('click', sendChatMessage);
document.getElementById('chat-input').addEventListener('keypress', (e) => { if(e.key === 'Enter') sendChatMessage(); });
function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (text.length > 0 && socket) {
    socket.emit('send_message', { token, text });
    input.value = '';
  }
}

/* --- AUTH & API --- */
document.getElementById('btn-login').addEventListener('click', () => handleAuth('/api/login'));
document.getElementById('btn-register').addEventListener('click', () => handleAuth('/api/register'));
document.getElementById('btn-logout').addEventListener('click', () => { localStorage.removeItem('terra_token'); location.reload(); });
document.getElementById('btn-admin').addEventListener('click', openAdminPanel);

async function handleAuth(url) {
  authError.innerText = '';
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value.trim();
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    localStorage.setItem('terra_token', data.token); token = data.token; initGame();
  } catch (err) { authError.innerText = err.message; }
}

async function fetchGameState() {
  if (!token) return;
  try {
    const res = await fetch('/api/game-state', { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.status === 401) { localStorage.removeItem('terra_token'); location.reload(); return; }
    gameState = await res.json(); renderUI();
  } catch (err) { console.error(err); }
}

const IDEAL_TEMP = 15, IDEAL_PRESS = 1.0, IDEAL_OXY = 21, IDEAL_WATER = 65;    
let planetRotation = 0;
let clickParticles = [];
let laserAnim = 0;

function getStageText(hab) {
  if(hab < 10) return "EVRE 1: ÇORAK KAYA";
  if(hab < 30) return "EVRE 2: İLK ATMOSFER";
  if(hab < 50) return "EVRE 3: SIVI SU";
  if(hab < 70) return "EVRE 4: BİTKİ ÖRTÜSÜ";
  if(hab < 90) return "EVRE 5: HAYVANLAR";
  return "EVRE 6: İNSAN KOLONİSİ";
}

function renderUI() {
  authModal.classList.add('hidden'); gameContainer.classList.remove('hidden'); chatContainer.classList.remove('hidden');
  document.getElementById('player-name').innerText = gameState.user.username;
  
  // Animate credit counter
  const crEl = document.getElementById('player-credits');
  const currentCr = parseInt(crEl.innerText.replace(/,/g, '')) || 0;
  const newCr = Math.floor(gameState.progress.credits);
  crEl.innerText = newCr.toLocaleString();

  if (gameState.user.role === 'admin') document.getElementById('btn-admin').classList.remove('hidden');

  const planetListEl = document.getElementById('planet-list');
  planetListEl.innerHTML = '';
  gameState.planets.forEach(p => {
    const btn = document.createElement('div');
    btn.className = `planet-tab ${p.planet_id === gameState.progress.current_planet_id ? 'active' : ''}`;
    btn.innerText = p.name;
    btn.onclick = async () => {
      await fetch('/api/select-planet', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ planetId: p.planet_id }) });
      fetchGameState();
    };
    planetListEl.appendChild(btn);
  });

  activePlanet = gameState.planets.find(p => p.planet_id === gameState.progress.current_planet_id);
  if (!activePlanet) return;

  document.getElementById('stat-temp').innerText = `${activePlanet.temperature.toFixed(1)}°C`;
  document.getElementById('stat-press').innerText = `${activePlanet.pressure.toFixed(2)} atm`;
  document.getElementById('stat-oxy').innerText = `%${activePlanet.oxygen.toFixed(1)}`;
  document.getElementById('stat-water').innerText = `%${activePlanet.water.toFixed(1)}`;

  const tScore = Math.max(0, 100 - Math.abs(activePlanet.temperature - IDEAL_TEMP) * 2);
  const pScore = Math.max(0, 100 - Math.abs(activePlanet.pressure - IDEAL_PRESS) * 40);
  const oScore = Math.max(0, 100 - Math.abs(activePlanet.oxygen - IDEAL_OXY) * 4);
  const wScore = Math.max(0, 100 - Math.abs(activePlanet.water - IDEAL_WATER) * 1.5);
  const totalHab = Math.floor((tScore + pScore + oScore + wScore) / 4);
  
  document.getElementById('hab-percent').innerText = `%${totalHab}`;
  document.getElementById('stage-text').innerText = getStageText(totalHab);

  document.getElementById('bar-temp').style.width = `${tScore}%`;
  document.getElementById('bar-press').style.width = `${pScore}%`;
  document.getElementById('bar-oxy').style.width = `${oScore}%`;
  document.getElementById('bar-water').style.width = `${wScore}%`;

  const bList = document.getElementById('building-list');
  bList.innerHTML = '';
  gameState.buildings.forEach(b => {
    const cost = Math.floor(b.base_cost * Math.pow(1.15, b.current_count));
    let effectText = '';
    if(b.temp_rate) effectText += `Isı: ${b.temp_rate>0?'+':''}${b.temp_rate} `;
    if(b.pressure_rate) effectText += `Bas: ${b.pressure_rate>0?'+':''}${b.pressure_rate} `;
    if(b.oxygen_rate) effectText += `Oky: +${b.oxygen_rate} `;
    if(b.water_rate) effectText += `Su: +${b.water_rate} `;

    const card = document.createElement('div');
    card.className = 'building-item';
    card.innerHTML = `
      <div>
        <div class="b-title">${b.name} <span class="b-count">[LVL ${b.current_count}]</span></div>
        <div class="b-desc">${effectText} | Üretim: +${b.credit_rate}CR/s</div>
      </div>
      <button class="b-btn" ${gameState.progress.credits < cost ? 'disabled' : ''} onclick="buyBuilding(${b.id}, event)">
        [ İNŞA ET ] ${cost.toLocaleString()} CR
      </button>
    `;
    bList.appendChild(card);
  });
}

window.buyBuilding = async function(buildingId, e) {
  const res = await fetch('/api/build', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ buildingId }) });
  if (res.ok) fetchGameState();
};

/* --- ACTIVE CLICK MINING (LASER) --- */
canvas.addEventListener('mousedown', async (e) => {
  if(!token) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  // Laser animation trigger
  laserAnim = 1.0;
  
  // Particle explosion
  for(let i=0; i<8; i++) {
    clickParticles.push({
      x: x, y: y,
      vx: (Math.random()-0.5)*10, vy: (Math.random()-0.5)*10,
      life: 1.0, color: Math.random() > 0.5 ? '#00f0ff' : '#ffffff'
    });
  }

  // Floating text
  const flText = document.createElement('div');
  flText.className = 'floating-text';
  flText.style.left = `${e.clientX}px`;
  flText.style.top = `${e.clientY - 20}px`;
  flText.style.color = '#fcee0a';
  flText.innerText = '+10 CR';
  document.body.appendChild(flText);
  setTimeout(() => flText.remove(), 1000);

  // Send to server
  try {
    const res = await fetch('/api/click-mine', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
    if(res.ok) {
      const data = await res.json();
      gameState.progress.credits += data.earned;
      document.getElementById('player-credits').innerText = Math.floor(gameState.progress.credits).toLocaleString();
    }
  } catch(e) {}
});

/* --- MASTERPIECE RENDER ENGINE --- */
function drawPlanet() {
  if(!activePlanet) return;
  const habScore = parseInt(document.getElementById('hab-percent').innerText.replace('%',''));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cx = canvas.width / 2, cy = canvas.height / 2, radius = 120;

  // 1. Atmosphere Outer Glow (Rayleigh Scattering)
  if(activePlanet.pressure > 0.1) {
    const atmoThick = Math.min(40, 10 + activePlanet.pressure * 15);
    const glow = ctx.createRadialGradient(cx, cy, radius-5, cx, cy, radius + atmoThick);
    const atmoAlpha = Math.min(0.8, activePlanet.pressure / 1.2);
    const atmoColor = activePlanet.temperature > 100 && activePlanet.oxygen < 5 ? '255, 150, 0' : '0, 200, 255';
    glow.addColorStop(0, `rgba(${atmoColor}, ${atmoAlpha})`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(cx, cy, radius + atmoThick, 0, Math.PI * 2);
    ctx.fillStyle = glow; ctx.fill();
  }

  // 2. Base Planet Color
  let red = 200, green = 60, blue = 40; 
  if(activePlanet.water > 10) { red = 30; blue = 150 + activePlanet.water; green = 90; } 
  if(habScore > 40) { red = 10; green = 100; blue = 240; } 
  const grad = ctx.createRadialGradient(cx - 40, cy - 40, 10, cx, cy, radius);
  grad.addColorStop(0, `rgb(${red + 50}, ${green + 50}, ${blue + 50})`);
  grad.addColorStop(1, `rgb(${red}, ${green}, ${blue})`);
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = grad; ctx.fill();

  // 3. Continents & Terrain
  planetRotation += 0.0015;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI*2); ctx.clip();
  ctx.rotate(planetRotation);
  
  let contR = 150, contG = 60, contB = 20; 
  if(activePlanet.oxygen > 5) { contR = 90; contG = 130; contB = 50; } 
  if(habScore > 60) { contR = 20; contG = 160; contB = 30; } 

  ctx.fillStyle = `rgb(${contR}, ${contG}, ${contB})`;
  ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.ellipse(-30, -50, 70, 35, Math.PI / 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(60, 20, 50, 60, -Math.PI / 6, 0, Math.PI * 2); ctx.fill();
  
  // City Lights (Night Side mapping approximation)
  if(habScore > 80) {
    ctx.fillStyle = 'rgba(255, 240, 150, 0.9)';
    ctx.globalCompositeOperation = 'screen';
    ctx.beginPath(); ctx.arc(70, 15, 2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(50, 40, 1.5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(-20, -50, 2.5, 0, Math.PI*2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();

  // 4. Clouds
  if(activePlanet.pressure > 0.4) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI*2); ctx.clip();
    ctx.rotate(-planetRotation * 1.5); 
    ctx.globalAlpha = Math.min(0.6, activePlanet.pressure / 2.0); 
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(-70, -40, 30, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(50, 60, 40, 0, Math.PI*2); ctx.fill();
    ctx.restore();
  }

  // 5. Day/Night Terminator Line (Shadow)
  const shadowGrad = ctx.createLinearGradient(cx - radius*0.1, cy, cx + radius, cy);
  shadowGrad.addColorStop(0, 'rgba(0,0,0,0)');
  shadowGrad.addColorStop(0.5, 'rgba(0,4,12,0.7)');
  shadowGrad.addColorStop(1, 'rgba(0,2,8,0.98)');
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = shadowGrad; ctx.fill();

  // 6. Orbital Laser Strike Animation
  if(laserAnim > 0) {
    ctx.beginPath();
    ctx.moveTo(canvas.width, 0); // Comes from top right
    ctx.lineTo(cx + (Math.random()-0.5)*40, cy + (Math.random()-0.5)*40);
    ctx.strokeStyle = `rgba(0, 240, 255, ${laserAnim})`;
    ctx.lineWidth = 4;
    ctx.stroke();
    // Inner core
    ctx.beginPath();
    ctx.moveTo(canvas.width, 0); 
    ctx.lineTo(cx + (Math.random()-0.5)*40, cy + (Math.random()-0.5)*40);
    ctx.strokeStyle = `rgba(255, 255, 255, ${laserAnim})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    laserAnim -= 0.15;
  }

  // 7. Click Particles
  for(let i=clickParticles.length-1; i>=0; i--) {
    let p = clickParticles[i];
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI*2); ctx.fill();
    p.x += p.vx; p.y += p.vy; p.life -= 0.08;
    if(p.life <= 0) clickParticles.splice(i, 1);
  }
  ctx.globalAlpha = 1.0;
}

/* --- ADMIN --- */
async function openAdminPanel() {
  adminModal.classList.remove('hidden');
  const listEl = document.getElementById('admin-user-list');
  listEl.innerHTML = '<p>Veritabanı taranıyor...</p>';
  try {
    const res = await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${token}` } });
    const users = await res.json();
    listEl.innerHTML = '';
    users.forEach(u => {
      const statusClass = u.isOnline ? 'status-online' : 'status-offline';
      const div = document.createElement('div'); div.className = 'admin-user-item';
      div.innerHTML = `
        <div>
          <span class="status-dot ${statusClass}"></span>
          <strong>${u.username}</strong> <span style="color:#aaa; font-size:0.75rem;">(LVL ${u.level})</span>
          <br><span style="font-size:0.75rem; color:var(--accent-yellow); margin-left: 15px;">Kredi: ${Math.floor(u.credits)}</span>
        </div>
        <div class="admin-actions">
          <button class="admin-btn" onclick="adminAction(${u.id}, 'add_credits', 100000)">+100k CR</button>
          <button class="admin-btn admin-btn-red" onclick="adminAction(${u.id}, 'reset', 0)">Sıfırla</button>
          ${u.isOnline ? `<button class="admin-btn admin-btn-red" onclick="adminAction(${u.id}, 'kick', 0)">KICK</button>` : ''}
        </div>
      `;
      listEl.appendChild(div);
    });
  } catch (e) { listEl.innerHTML = 'Hata.'; }
}
window.closeAdminPanel = () => adminModal.classList.add('hidden');
window.adminAction = async (userId, action, amount) => {
  await fetch('/api/admin/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ targetUserId: userId, action: action, amount: amount }) });
  openAdminPanel();
};

function initGame() {
  if (token) {
    setupSocket();
    fetchGameState();
    setInterval(fetchGameState, 3000);
    setInterval(drawPlanet, 1000/60); // 60 FPS Render
  } else { authModal.classList.remove('hidden'); }
}

initGame();
