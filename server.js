require('dotenv').config(); // Membaca file .env
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg'); // Driver Postgres
const crypto = require('crypto'); // Modul crypto bawaan Node.js

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Memasang sistem keamanan (Middleware)
// CATATAN: Menonaktifkan CSP default Helmet agar landing page bisa memuat resource luar seperti FontAwesome & Google Fonts
app.use(helmet({
    contentSecurityPolicy: false,
}));
app.use(cors());   // Mengizinkan akses dari frontend luar
app.use(express.json()); // Mengizinkan API membaca data format JSON
app.use(express.static('public')); // Menyajikan static files dari folder public

// 2. Meracik konfigurasi koneksi ke kontainer Postgres
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
});

// 3. Inisialisasi Database (Membuat tabel users jika belum ada)
const initializeDatabase = async () => {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            password_salt VARCHAR(255) NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    try {
        await pool.query(createTableQuery);
        console.log('Tabel users siap digunakan.');
    } catch (err) {
        console.error('Gagal menginisialisasi tabel users:', err.message);
    }
};
initializeDatabase();

// 4. Utilitas Autentikasi (Password Hashing & JWT-like Tokens menggunakan crypto bawaan)
const JWT_SECRET = process.env.JWT_SECRET || 'hexaobserve_stable_secret_key_987654321';

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, hash) {
    const testHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return testHash === hash;
}

function generateToken(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url'); // Berlaku 1 hari
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
}

function verifyToken(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;
    const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (signature !== expectedSignature) return null;
    
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (payload.exp && Date.now() > payload.exp) {
            return null; // Token kedaluwarsa
        }
        return payload;
    } catch (err) {
        return null;
    }
}

// Middleware untuk memvalidasi Token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Format: Bearer <token>
    
    if (!token) return res.status(401).json({ status: 'ERROR', pesan: 'Akses ditolak. Token tidak disediakan.' });
    
    const user = verifyToken(token);
    if (!user) return res.status(403).json({ status: 'ERROR', pesan: 'Token tidak valid atau kedaluwarsa.' });
    
    req.user = user;
    next();
}

// 5. Endpoint Autentikasi (Sign Up, Login, Me)
app.post('/api/auth/signup', async (req, res) => {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
        return res.status(400).json({ status: 'ERROR', pesan: 'Username, email, dan password wajib diisi.' });
    }
    
    try {
        const { salt, hash } = hashPassword(password);
        
        const query = 'INSERT INTO users(username, email, password_hash, password_salt) VALUES($1, $2, $3, $4) RETURNING id, username, email';
        const result = await pool.query(query, [username, email, hash, salt]);
        
        res.status(201).json({
            status: 'SUKSES',
            pesan: 'User berhasil didaftarkan.',
            user: result.rows[0]
        });
    } catch (error) {
        console.error('Sign Up Error:', error.message);
        if (error.code === '23505') {
            return res.status(400).json({ status: 'ERROR', pesan: 'Username atau email sudah digunakan.' });
        }
        res.status(500).json({ status: 'ERROR', pesan: 'Terjadi kesalahan pada server.' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ status: 'ERROR', pesan: 'Username dan password wajib diisi.' });
    }
    
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) {
            return res.status(400).json({ status: 'ERROR', pesan: 'Username atau password salah.' });
        }
        
        const user = result.rows[0];
        const isMatch = verifyPassword(password, user.password_salt, user.password_hash);
        
        if (!isMatch) {
            return res.status(400).json({ status: 'ERROR', pesan: 'Username atau password salah.' });
        }
        
        const token = generateToken({ id: user.id, username: user.username, email: user.email });
        
        res.json({
            status: 'SUKSES',
            pesan: 'Login berhasil.',
            token,
            user: { id: user.id, username: user.username, email: user.email }
        });
    } catch (error) {
        console.error('Login Error:', error.message);
        res.status(500).json({ status: 'ERROR', pesan: 'Terjadi kesalahan pada server.' });
    }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
    res.json({
        status: 'SUKSES',
        user: req.user
    });
});

// 6. API Endpoint untuk mengambil status real-time sistem (Protected)
app.get('/api/status', authenticateToken, async (req, res) => {
    let dbConnected = false;
    let dbLatency = 0;
    
    try {
        const start = Date.now();
        await pool.query('SELECT 1');
        dbLatency = Date.now() - start;
        dbConnected = true;
    } catch (err) {
        console.error('Koneksi DB Gagal untuk /api/status:', err.message);
    }
    
    res.json({
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        database: {
            connected: dbConnected,
            latency: dbLatency
        },
        system: {
            platform: process.platform,
            arch: process.arch
        }
    });
});

// 7. Endpoint untuk mengetes koneksi database secara riil (Protected)
app.get('/test-db', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() as waktu_database');
        
        res.json({
            status: 'SUKSES',
            pesan: 'Aplikasi Node.js berhasil terkoneksi dengan Postgres!',
            waktu_server_pg: result.rows[0].waktu_database
        });
    } catch (error) {
        console.error('Koneksi DB Gagal:', error.message);
        res.status(500).json({
            status: 'GAGAL',
            pesan: 'Gagal terhubung ke database Postgres',
            error: error.message
        });
    }
});

// 8. Menjalankan Server
app.listen(PORT, () => {
    console.log(`Aplikasi berjalan di port ${PORT}`);
});

// 9. Metrik Prometheus (Unsecured agar Prometheus dapat melakukan scraping)
const client = require('prom-client');
client.collectDefaultMetrics(); 

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});