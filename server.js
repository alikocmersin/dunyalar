const express = require('express');
const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'terra-masterpiece-2026';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* --- REALTIME SOCKETS --- */
const onlineUsers = new Map(); 

io.on('connection', (socket) => {
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.userId = decoded.userId;
      onlineUsers.set(decoded.userId, socket.id);
      
      const user = db.prepare('SELECT username FROM users WHERE id = ?').get(decoded.userId);
      if(user) io.emit('system_message', { text: `[AĞA KATILDI]: ${user.username}` });
    } catch (err) {}
  });

  socket.on('send_message', (data) => {
    try {
      const decoded = jwt.verify(data.token, JWT_SECRET);
      const user = db.prepare('SELECT username, role FROM users WHERE id = ?').get(decoded.userId);
      if (user) {
        io.emit('new_message', { 
          username: user.username, 
          role: user.role, 
          text: data.text,
          timestamp: new Date().toLocaleTimeString()
        });
      }
    } catch (err) {}
  });

  socket.on('disconnect', () => {
    if (socket.userId) onlineUsers.delete(socket.userId);
  });
});

/* --- MIDDLEWARE --- */
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Yetkisiz erişim' });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).userId;
    next();
  } catch (err) { return res.status(401).json({ error: 'Geçersiz oturum' }); }
};

/* --- AUTH --- */
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || password.length < 4) return res.status(400).json({ error: 'Min. 4 haneli şifre girin.' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const role = (username.toLowerCase() === 'admin') ? 'admin' : 'player';
    const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, role);
    const userId = result.lastInsertRowid;

    db.prepare('INSERT INTO player_progress (user_id) VALUES (?)').run(userId);
    const planets = db.prepare('SELECT * FROM planets').all();
    const insertPlanet = db.prepare('INSERT INTO player_planets (user_id, planet_id, temperature, pressure, oxygen, water) VALUES (?, ?, ?, ?, ?, ?)');
    planets.forEach(p => insertPlanet.run(userId, p.id, p.initial_temp, p.initial_pressure, p.initial_oxygen, p.initial_water));

    res.json({ success: true, token: jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' }), username, role });
  } catch (error) { res.status(400).json({ error: 'Bu kullanıcı adı zaten alınmış.' }); }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(400).json({ error: 'Hatalı şifre.' });
  res.json({ success: true, token: jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' }), username: user.username, role: user.role });
});

/* --- GAME STATE & TICK --- */
app.get('/api/game-state', authenticate, (req, res) => {
  const user = db.prepare('SELECT username, role FROM users WHERE id = ?').get(req.userId);
  const progress = db.prepare('SELECT * FROM player_progress WHERE user_id = ?').get(req.userId);
  const planets = db.prepare(`SELECT pp.*, p.name, p.order_index FROM player_planets pp JOIN planets p ON pp.planet_id = p.id WHERE pp.user_id = ? ORDER BY p.order_index ASC`).all(req.userId);
  const buildings = db.prepare(`SELECT b.*, COALESCE(pb.count, 0) as current_count FROM buildings b LEFT JOIN player_buildings pb ON pb.building_id = b.id AND pb.user_id = ? AND pb.planet_id = ?`).all(req.userId, progress.current_planet_id);

  const now = new Date();
  const lastLogin = new Date(progress.last_login);
  const deltaSeconds = Math.min(Math.floor((now - lastLogin) / 1000), 86400); 

  if (deltaSeconds > 0) {
    let creditGain = 0, tempDelta = 0, pressDelta = 0, oxyDelta = 0, waterDelta = 0;
    buildings.forEach(b => {
      if (b.current_count > 0) {
        creditGain += b.credit_rate * b.current_count * deltaSeconds * 0.1;
        tempDelta += b.temp_rate * b.current_count * (deltaSeconds / 60);
        pressDelta += b.pressure_rate * b.current_count * (deltaSeconds / 60);
        oxyDelta += b.oxygen_rate * b.current_count * (deltaSeconds / 60);
        waterDelta += b.water_rate * b.current_count * (deltaSeconds / 60);
      }
    });

    const newCredits = progress.credits + creditGain;
    db.prepare('UPDATE player_progress SET credits = ?, last_login = CURRENT_TIMESTAMP WHERE user_id = ?').run(newCredits, req.userId);
    
    // Absolute bounds check
    db.prepare(`
      UPDATE player_planets 
      SET temperature = MAX(-273.15, temperature + ?), 
          pressure = MAX(0, pressure + ?), 
          oxygen = MAX(0, MIN(100, oxygen + ?)), 
          water = MAX(0, MIN(100, water + ?)) 
      WHERE user_id = ? AND planet_id = ?
    `).run(tempDelta, pressDelta, oxyDelta, waterDelta, req.userId, progress.current_planet_id);
    progress.credits = newCredits;
  }

  res.json({ progress, planets, buildings, user });
});

/* --- ACTIVE CLICK MINING --- */
const clickCooldowns = new Map();
app.post('/api/click-mine', authenticate, (req, res) => {
  const now = Date.now();
  const lastClick = clickCooldowns.get(req.userId) || 0;
  if(now - lastClick < 100) return res.status(429).json({ error: 'Too fast' }); // 100ms anti-macro
  clickCooldowns.set(req.userId, now);

  db.prepare('UPDATE player_progress SET credits = credits + 10 WHERE user_id = ?').run(req.userId);
  res.json({ success: true, earned: 10 });
});

app.post('/api/build', authenticate, (req, res) => {
  const { buildingId } = req.body;
  const progress = db.prepare('SELECT * FROM player_progress WHERE user_id = ?').get(req.userId);
  const building = db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId);
  const playerBuilding = db.prepare(`SELECT count FROM player_buildings WHERE user_id = ? AND planet_id = ? AND building_id = ?`).get(req.userId, progress.current_planet_id);

  const currentCount = playerBuilding ? playerBuilding.count : 0;
  const cost = Math.floor(building.base_cost * Math.pow(1.15, currentCount));

  if (progress.credits < cost) return res.status(400).json({ error: 'Yetersiz Kredi!' });

  db.prepare('UPDATE player_progress SET credits = credits - ? WHERE user_id = ?').run(cost, req.userId);

  if (playerBuilding) {
    db.prepare(`UPDATE player_buildings SET count = count + 1 WHERE user_id = ? AND planet_id = ? AND building_id = ?`).run(req.userId, progress.current_planet_id, buildingId);
  } else {
    db.prepare(`INSERT INTO player_buildings (user_id, planet_id, building_id, count) VALUES (?, ?, ?, 1)`).run(req.userId, progress.current_planet_id, buildingId);
  }
  res.json({ success: true });
});

app.post('/api/select-planet', authenticate, (req, res) => {
  db.prepare('UPDATE player_progress SET current_planet_id = ? WHERE user_id = ?').run(req.body.planetId, req.userId);
  res.json({ success: true });
});

/* --- ADMIN --- */
app.get('/api/admin/users', authenticate, (req, res) => {
  if (db.prepare('SELECT role FROM users WHERE id = ?').get(req.userId).role !== 'admin') return res.status(403).json({ error: 'Yetkisiz' });
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, p.credits,
    (SELECT COALESCE(SUM(count), 0) FROM player_buildings WHERE user_id = u.id) as level
    FROM users u JOIN player_progress p ON u.id = p.user_id
  `).all();
  users.forEach(u => { u.isOnline = onlineUsers.has(u.id); });
  res.json(users);
});

app.post('/api/admin/action', authenticate, (req, res) => {
  if (db.prepare('SELECT role FROM users WHERE id = ?').get(req.userId).role !== 'admin') return res.status(403).json({ error: 'Yetkisiz' });
  const { targetUserId, action, amount } = req.body;
  if (action === 'add_credits') db.prepare('UPDATE player_progress SET credits = credits + ? WHERE user_id = ?').run(amount, targetUserId);
  else if (action === 'kick' && onlineUsers.get(targetUserId)) io.to(onlineUsers.get(targetUserId)).emit('force_logout', 'Sistem Yöneticisi tarafından bağlantınız kesildi.');
  else if (action === 'reset') {
    db.prepare('DELETE FROM player_buildings WHERE user_id = ?').run(targetUserId);
    db.prepare('UPDATE player_progress SET credits = 1500 WHERE user_id = ?').run(targetUserId);
  }
  res.json({ success: true });
});

server.listen(PORT, () => console.log(`Terra Origin v6 (Masterpiece) hazır: http://localhost:${PORT}`));
