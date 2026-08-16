const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'game.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'player',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS player_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credits REAL DEFAULT 1500.0,
    current_planet_id INTEGER DEFAULT 1,
    last_login DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS planets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    initial_temp REAL,
    initial_pressure REAL,
    initial_oxygen REAL,
    initial_water REAL,
    unlocked_by_default INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS player_planets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    planet_id INTEGER NOT NULL,
    temperature REAL,
    pressure REAL,
    oxygen REAL,
    water REAL,
    biomass REAL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(planet_id) REFERENCES planets(id)
  );

  CREATE TABLE IF NOT EXISTS buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    base_cost REAL NOT NULL,
    temp_rate REAL DEFAULT 0,
    pressure_rate REAL DEFAULT 0,
    oxygen_rate REAL DEFAULT 0,
    water_rate REAL DEFAULT 0,
    credit_rate REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS player_buildings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    planet_id INTEGER NOT NULL,
    building_id INTEGER NOT NULL,
    count INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

const planetCount = db.prepare('SELECT COUNT(*) as count FROM planets').get();
if (planetCount.count === 0) {
  const insertPlanet = db.prepare('INSERT INTO planets (name, order_index, initial_temp, initial_pressure, initial_oxygen, initial_water, unlocked_by_default) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertPlanet.run('Dünya (Kopya)', 1, 15.0, 1.0, 21.0, 70.0, 1);
  insertPlanet.run('Ay (Luna)', 2, -130.0, 0.0, 0.0, 0.0, 0);
  insertPlanet.run('Mars', 3, -63.0, 0.006, 0.13, 0.0, 0);
  insertPlanet.run('Venüs', 4, 464.0, 92.0, 0.0, 0.0, 0);
  insertPlanet.run('Titan', 5, -179.0, 1.45, 0.0, 2.0, 0);
}

const buildingCount = db.prepare('SELECT COUNT(*) as count FROM buildings').get();
if (buildingCount.count === 0) {
  const insertBuilding = db.prepare('INSERT INTO buildings (name, category, base_cost, temp_rate, pressure_rate, oxygen_rate, water_rate, credit_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insertBuilding.run('Sera Gazı Fabrikası', 'temperature', 100, 0.5, 0.01, 0, 0, 1);
  insertBuilding.run('Soğutucu Yörünge Aynası', 'temperature_down', 400, -0.6, 0, 0, 0, 2);
  insertBuilding.run('Atmosfer Pompası', 'pressure', 150, 0, 0.05, 0, 0, 1.5);
  insertBuilding.run('Karbon Emici Tesis', 'pressure_down', 500, -0.1, -0.06, 0, 0, 2.5);
  insertBuilding.run('Bakteriyel Koloni', 'biology', 300, 0.1, 0.02, 0.4, 0.1, 2);
  insertBuilding.run('Yosun / Alg Çiftliği', 'biology', 750, 0.2, 0.01, 1.0, 0.5, 5);
  insertBuilding.run('Kutup Buzu Isıtıcı', 'water', 500, 0.4, 0.01, 0, 0.8, 3);
}

module.exports = db;
