import { useCallback, useEffect, useState } from 'react';
import keycloak from './keycloak';
import { api } from './api';
import './index.css';

// ---------- Helper ----------
// Warna sampul dibuat dari nama kategori, jadi buku sekategori terlihat sekelompok di rak.
const hueOf = (text = '') => {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};
const fmtDate = (d) =>
  new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

// ---------- Komponen kecil ----------
function Cover({ book }) {
  return (
    <div className="cover" style={{ '--h': hueOf(book.category || book.title) }}>
      <span className="cover-title">{book.title}</span>
      <span className="cover-author">{book.author}</span>
    </div>
  );
}

function Empty({ title, children }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

function LoanStatus({ loan }) {
  if (loan.returned_at) return <span className="pill done">Dikembalikan</span>;
  if (loan.overdue) return <span className="pill late">Terlambat</span>;
  return <span className="pill active">Dipinjam</span>;
}

// ---------- Katalog ----------
function Catalog({ notify }) {
  const [books, setBooks] = useState(null);
  const [q, setQ] = useState('');

  const load = useCallback(
    () =>
      api(`/api/books?q=${encodeURIComponent(q)}`)
        .then(setBooks)
        .catch((e) => {
          notify(e.message, 'error');
          setBooks([]);
        }),
    [q, notify]
  );

  // Pencarian berjalan otomatis setelah pengguna berhenti mengetik sebentar
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const borrow = async (book) => {
    if (!keycloak.authenticated) return keycloak.login();
    try {
      await api('/api/loans', { method: 'POST', body: { book_id: book.id } });
      notify(`Kamu meminjam “${book.title}”. Jatuh tempo 7 hari lagi.`);
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  return (
    <>
      <section className="hero">
        <h1>Temukan buku berikutnya</h1>
        <p>Cari berdasarkan judul atau nama penulis. Katalog bisa dilihat siapa saja.</p>
        <input
          className="search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari judul atau penulis"
          aria-label="Cari buku"
        />
      </section>

      {!keycloak.authenticated && (
        <p className="note">Masuk dengan akunmu untuk meminjam buku.</p>
      )}

      {books === null ? (
        <div className="shelf" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" />)}
        </div>
      ) : books.length === 0 ? (
        <Empty title="Tidak ada buku yang cocok">
          Coba kata kunci lain atau hapus pencarian.
        </Empty>
      ) : (
        <div className="shelf">
          {books.map((b) => (
            <article className="book" key={b.id}>
              <Cover book={b} />
              <div className="book-info">
                <span className="book-cat">{b.category || 'Tanpa kategori'}</span>
                <span className={`stock ${b.stock === 0 ? 'out' : b.stock === 1 ? 'low' : ''}`}>
                  {b.stock === 0 ? 'Stok habis' : `Tersedia ${b.stock}`}
                </span>
                <button className="btn block" disabled={b.stock < 1} onClick={() => borrow(b)}>
                  {b.stock < 1 ? 'Stok habis' : 'Pinjam'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

// ---------- Pinjaman saya ----------
function MyLoans({ notify }) {
  const [loans, setLoans] = useState(null);

  const load = useCallback(
    () =>
      api('/api/loans/me')
        .then(setLoans)
        .catch((e) => {
          notify(e.message, 'error');
          setLoans([]);
        }),
    [notify]
  );
  useEffect(() => { load(); }, [load]);

  const giveBack = async (loan) => {
    try {
      await api(`/api/loans/${loan.id}/return`, { method: 'POST' });
      notify(`“${loan.title}” sudah dikembalikan.`);
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  return (
    <>
      <h2 className="page-title">Pinjaman saya</h2>
      {loans === null ? null : loans.length === 0 ? (
        <Empty title="Belum ada pinjaman">Buka katalog dan pilih buku yang ingin kamu baca.</Empty>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr><th>Buku</th><th>Dipinjam</th><th>Jatuh tempo</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id}>
                  <td>{l.title}</td>
                  <td>{fmtDate(l.borrowed_at)}</td>
                  <td>{fmtDate(l.due_at)}</td>
                  <td><LoanStatus loan={l} /></td>
                  <td className="actions">
                    {!l.returned_at && (
                      <button className="btn ghost small" onClick={() => giveBack(l)}>Kembalikan</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------- Kelola buku (pustakawan) ----------
const EMPTY_FORM = { title: '', author: '', category: '', stock: 1 };

function Manage({ notify }) {
  const [books, setBooks] = useState([]);
  const [loans, setLoans] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);

  const load = useCallback(() => {
    api('/api/books').then(setBooks).catch((e) => notify(e.message, 'error'));
    api('/api/manage/loans').then(setLoans).catch((e) => notify(e.message, 'error'));
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const setField = (name) => (e) => setForm({ ...form, [name]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    const body = { ...form, stock: Number(form.stock) };
    try {
      if (editId) await api(`/api/manage/books/${editId}`, { method: 'PUT', body });
      else await api('/api/manage/books', { method: 'POST', body });
      notify(editId ? 'Perubahan disimpan.' : 'Buku ditambahkan.');
      setForm(EMPTY_FORM);
      setEditId(null);
      load();
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const startEdit = (b) => {
    setEditId(b.id);
    setForm({ title: b.title, author: b.author, category: b.category || '', stock: b.stock });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const cancelEdit = () => { setEditId(null); setForm(EMPTY_FORM); };

  const remove = async (b) => {
    if (!window.confirm(`Hapus “${b.title}” dari katalog?`)) return;
    try {
      await api(`/api/manage/books/${b.id}`, { method: 'DELETE' });
      notify('Buku dihapus.');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  return (
    <>
      <form className="panel" onSubmit={save}>
        <h2>{editId ? 'Ubah buku' : 'Tambah buku'}</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="f-title">Judul</label>
            <input id="f-title" required value={form.title} onChange={setField('title')} />
          </div>
          <div className="field">
            <label htmlFor="f-author">Penulis</label>
            <input id="f-author" required value={form.author} onChange={setField('author')} />
          </div>
          <div className="field">
            <label htmlFor="f-cat">Kategori</label>
            <input id="f-cat" value={form.category} onChange={setField('category')} />
          </div>
          <div className="field">
            <label htmlFor="f-stock">Stok</label>
            <input id="f-stock" type="number" min="0" required value={form.stock} onChange={setField('stock')} />
          </div>
        </div>
        <div className="form-actions">
          <button className="btn" type="submit">{editId ? 'Simpan perubahan' : 'Tambah buku'}</button>
          {editId && <button className="btn ghost" type="button" onClick={cancelEdit}>Batal</button>}
        </div>
      </form>

      <h2 className="page-title">Daftar buku</h2>
      <div className="panel table-wrap">
        <table>
          <thead><tr><th>Judul</th><th>Penulis</th><th>Kategori</th><th>Stok</th><th /></tr></thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.id}>
                <td>{b.title}</td>
                <td>{b.author}</td>
                <td>{b.category}</td>
                <td>{b.stock}</td>
                <td className="actions">
                  <button className="btn ghost small" onClick={() => startEdit(b)}>Ubah</button>
                  <button className="btn danger small" onClick={() => remove(b)}>Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="page-title">Semua peminjaman</h2>
      {loans.length === 0 ? (
        <Empty title="Belum ada peminjaman">Peminjaman anggota akan muncul di sini.</Empty>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead><tr><th>Buku</th><th>Peminjam</th><th>Jatuh tempo</th><th>Status</th></tr></thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id}>
                  <td>{l.title}</td>
                  <td>{l.username}</td>
                  <td>{fmtDate(l.due_at)}</td>
                  <td><LoanStatus loan={l} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------- Admin ----------
function Admin({ notify }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api('/api/admin/stats').then(setStats).catch((e) => notify(e.message, 'error'));
  }, [notify]);

  if (!stats) return null;
  const tiles = [
    ['Judul buku', stats.total_books],
    ['Total stok tersedia', stats.total_stock],
    ['Sedang dipinjam', stats.active_loans],
    ['Terlambat', stats.overdue_loans, stats.overdue_loans > 0],
  ];
  return (
    <>
      <h2 className="page-title">Ringkasan perpustakaan</h2>
      <div className="stats">
        {tiles.map(([label, value, warn]) => (
          <div className={`stat ${warn ? 'warn' : ''}`} key={label}>
            <div className="num">{value}</div>
            <div className="label">{label}</div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---------- Aplikasi ----------
export default function App() {
  const [tab, setTab] = useState('catalog');
  const [pod, setPod] = useState(null);
  const [toast, setToast] = useState(null);

  const notify = useCallback((text, type = 'ok') => setToast({ text, type, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(t);
  }, [toast]);

  const loggedIn = keycloak.authenticated;
  const isLibrarian = keycloak.hasRealmRole('librarian');
  const isAdmin = keycloak.hasRealmRole('admin');
  const username = loggedIn ? keycloak.tokenParsed.preferred_username : '';
  const roleLabel = isAdmin ? 'Admin' : isLibrarian ? 'Pustakawan' : 'Anggota';

  // Badge ini membuktikan load balancing: identitas POD bisa berganti tiap request
  useEffect(() => {
    api('/api/info').then((d) => setPod(d.pod)).catch(() => setPod('?'));
  }, [tab]);

  const tabs = [
    ['catalog', 'Katalog', true],
    ['loans', 'Pinjaman saya', loggedIn],
    ['manage', 'Kelola buku', isLibrarian],
    ['admin', 'Ringkasan', isAdmin],
  ].filter(([, , visible]) => visible);

  const podClass = pod === 'POD 1' ? 'pod-1' : pod === 'POD 2' ? 'pod-2' : 'pod-x';

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
              <rect x="3" y="5" width="5" height="17" rx="1" fill="#7fc4ae" />
              <rect x="10" y="3" width="5" height="19" rx="1" fill="#f0c36a" />
              <rect x="17" y="6" width="5" height="16" rx="1" fill="#9db9ea" />
            </svg>
            Perpustakaan
          </div>

          <span className={`pod-badge ${podClass}`} title="Server yang melayani permintaan terakhir">
            Dilayani oleh {pod || '…'}
          </span>

          {loggedIn ? (
            <div className="user-chip">
              <div className="avatar" aria-hidden="true">{username.charAt(0).toUpperCase()}</div>
              <div className="user-meta">
                <strong>{username}</strong>
                <span>{roleLabel}</span>
              </div>
              <button
                className="btn ghost small"
                onClick={() => keycloak.logout({ redirectUri: window.location.origin })}
              >
                Keluar
              </button>
            </div>
          ) : (
            <button className="btn ghost small" onClick={() => keycloak.login()}>Masuk</button>
          )}
        </div>
      </header>

      <main className="shell">
        <nav className="tabs" aria-label="Menu utama">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              className="tab"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <section className="page-content" key={tab}>
          {tab === 'catalog' && <Catalog notify={notify} />}
          {tab === 'loans' && <MyLoans notify={notify} />}
          {tab === 'manage' && <Manage notify={notify} />}
          {tab === 'admin' && <Admin notify={notify} />}
        </section>
      </main>

      {toast && (
        <div key={toast.id} className={`toast ${toast.type === 'error' ? 'error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </>
  );
}