const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());                       // agar body JSON otomatis terbaca di req.body

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const POD = process.env.POD_NAME || 'POD ?';   // identitas container (POD 1 / POD 2)
const MAX_LOANS = 3;                           // batas pinjaman aktif per anggota
const LOAN_DAYS = 7;                           // lama masa pinjam

// ---------- Inisialisasi database ----------
const SEED = [
  ['Laskar Pelangi', 'Andrea Hirata', 'Novel', 3],
  ['Bumi Manusia', 'Pramoedya Ananta Toer', 'Novel', 2],
  ['Clean Code', 'Robert C. Martin', 'Teknologi', 2],
  ['Atomic Habits', 'James Clear', 'Pengembangan Diri', 4],
  ['Sapiens', 'Yuval Noah Harari', 'Sejarah', 2],
];

async function init() {
  const c = await pool.connect();
  try {
    // Kunci ini membuat backend-1 dan backend-2 tidak saling bertabrakan saat membuat tabel
    await c.query('SELECT pg_advisory_lock(42)');
    await c.query(`CREATE TABLE IF NOT EXISTS books (
      id SERIAL PRIMARY KEY, title TEXT NOT NULL, author TEXT NOT NULL,
      isbn TEXT, category TEXT, stock INT NOT NULL DEFAULT 1 CHECK (stock >= 0))`);
    await c.query(`CREATE TABLE IF NOT EXISTS loans (
      id SERIAL PRIMARY KEY, book_id INT REFERENCES books(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, username TEXT,
      borrowed_at TIMESTAMPTZ DEFAULT now(), due_at TIMESTAMPTZ NOT NULL,
      returned_at TIMESTAMPTZ)`);
    const { rows } = await c.query('SELECT COUNT(*)::int AS n FROM books');
    if (rows[0].n === 0) {                     // isi data contoh hanya jika tabel kosong
      for (const [t, a, cat, s] of SEED)
        await c.query('INSERT INTO books(title,author,category,stock) VALUES($1,$2,$3,$4)', [t, a, cat, s]);
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(42)');
    c.release();
  }
}

// ---------- Autentikasi & otorisasi ----------
// Token sudah divalidasi APISIX. Backend hanya MEMBACA isinya (user id, nama, role).
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const payload = token && jwt.decode(token);
  if (!payload) return res.status(401).json({ error: 'Token tidak ada' });
  req.user = {
    id: payload.sub,                                   // ID unik user di Keycloak
    name: payload.preferred_username,
    roles: (payload.realm_access && payload.realm_access.roles) || [],
  };
  next();
}
const requireRole = (role) => (req, res, next) =>
  req.user.roles.includes(role) ? next() : res.status(403).json({ error: `Butuh role ${role}` });

// ---------- Endpoint publik ----------
app.get('/healthz', (req, res) => res.send('ok'));
app.get('/api/info', (req, res) => res.json({ pod: POD }));

app.get('/api/books', async (req, res) => {
  const q = req.query.q || null;
  const { rows } = await pool.query(
    `SELECT * FROM books
     WHERE ($1::text IS NULL OR title ILIKE '%'||$1||'%' OR author ILIKE '%'||$1||'%')
     ORDER BY id`, [q]);
  res.json(rows);
});

app.get('/api/books/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM books WHERE id=$1', [req.params.id]);
  rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'Buku tidak ditemukan' });
});

// ---------- Endpoint member ----------
app.post('/api/loans', auth, requireRole('member'), async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');                                  // transaksi: semua langkah berhasil atau batal semua
    const act = await c.query(
      'SELECT COUNT(*)::int AS n FROM loans WHERE user_id=$1 AND returned_at IS NULL', [req.user.id]);
    if (act.rows[0].n >= MAX_LOANS) {
      await c.query('ROLLBACK');
      return res.status(400).json({ error: `Maksimal ${MAX_LOANS} buku sekaligus` });
    }
    const upd = await c.query(                               // kurangi stok hanya jika stok > 0
      'UPDATE books SET stock = stock - 1 WHERE id=$1 AND stock > 0 RETURNING id', [req.body.book_id]);
    if (!upd.rowCount) {
      await c.query('ROLLBACK');
      return res.status(409).json({ error: 'Stok habis atau buku tidak ada' });
    }
    const loan = await c.query(
      `INSERT INTO loans(book_id,user_id,username,due_at)
       VALUES($1,$2,$3, now() + make_interval(days => $4)) RETURNING *`,
      [req.body.book_id, req.user.id, req.user.name, LOAN_DAYS]);
    await c.query('COMMIT');
    res.status(201).json(loan.rows[0]);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
});

app.get('/api/loans/me', auth, requireRole('member'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.*, b.title, (l.returned_at IS NULL AND l.due_at < now()) AS overdue
     FROM loans l JOIN books b ON b.id = l.book_id
     WHERE l.user_id=$1 ORDER BY l.id DESC`, [req.user.id]);
  res.json(rows);
});

app.post('/api/loans/:id/return', auth, requireRole('member'), async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await c.query(
      `UPDATE loans SET returned_at = now()
       WHERE id=$1 AND user_id=$2 AND returned_at IS NULL RETURNING book_id`,
      [req.params.id, req.user.id]);
    if (!r.rowCount) {
      await c.query('ROLLBACK');
      return res.status(404).json({ error: 'Pinjaman tidak ditemukan' });
    }
    await c.query('UPDATE books SET stock = stock + 1 WHERE id=$1', [r.rows[0].book_id]);
    await c.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
});

// ---------- Endpoint librarian ----------
app.post('/api/manage/books', auth, requireRole('librarian'), async (req, res) => {
  const { title, author, isbn, category, stock } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO books(title,author,isbn,category,stock) VALUES($1,$2,$3,$4,$5) RETURNING *',
    [title, author, isbn, category, stock ?? 1]);
  res.status(201).json(rows[0]);
});

app.put('/api/manage/books/:id', auth, requireRole('librarian'), async (req, res) => {
  const { title, author, isbn, category, stock } = req.body;
  const { rows } = await pool.query(
    `UPDATE books SET title=$1, author=$2, isbn=$3, category=$4, stock=$5
     WHERE id=$6 RETURNING *`, [title, author, isbn, category, stock, req.params.id]);
  rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'Buku tidak ditemukan' });
});

app.delete('/api/manage/books/:id', auth, requireRole('librarian'), async (req, res) => {
  await pool.query('DELETE FROM books WHERE id=$1', [req.params.id]);
  res.status(204).end();
});

app.get('/api/manage/loans', auth, requireRole('librarian'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.*, b.title, (l.returned_at IS NULL AND l.due_at < now()) AS overdue
     FROM loans l JOIN books b ON b.id = l.book_id ORDER BY l.id DESC`);
  res.json(rows);
});

// ---------- Endpoint admin ----------
app.get('/api/admin/stats', auth, requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM books) AS total_books,
    (SELECT COALESCE(SUM(stock),0)::int FROM books) AS total_stock,
    (SELECT COUNT(*)::int FROM loans WHERE returned_at IS NULL) AS active_loans,
    (SELECT COUNT(*)::int FROM loans WHERE returned_at IS NULL AND due_at < now()) AS overdue_loans`);
  res.json(rows[0]);
});

// ---------- Penanganan error & start ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Kesalahan server' });
});

init()
  .then(() => app.listen(3000, () => console.log(`${POD} siap di port 3000`)))
  .catch((e) => { console.error(e); process.exit(1); });