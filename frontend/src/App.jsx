import { useEffect, useState } from 'react';
import keycloak from './keycloak';
import { api } from './api';

function Catalog() {
  const [books, setBooks] = useState([]);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => api(`/api/books?q=${encodeURIComponent(q)}`).then(setBooks).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const borrow = async (id) => {
    if (!keycloak.authenticated) return keycloak.login();   // belum login -> ke halaman Keycloak
    try {
      await api('/api/loans', { method: 'POST', body: { book_id: id } });
      setMsg('Berhasil meminjam buku!');
      load();
    } catch (e) { setMsg(e.message); }
  };

  return (
    <div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari judul/penulis" />
      <button onClick={load}>Cari</button>
      {msg && <p><b>{msg}</b></p>}
      <table border="1" cellPadding="6">
        <thead><tr><th>Judul</th><th>Penulis</th><th>Kategori</th><th>Stok</th><th></th></tr></thead>
        <tbody>
          {books.map((b) => (
            <tr key={b.id}>
              <td>{b.title}</td><td>{b.author}</td><td>{b.category}</td><td>{b.stock}</td>
              <td><button disabled={b.stock < 1} onClick={() => borrow(b.id)}>Pinjam</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MyLoans() {
  const [loans, setLoans] = useState([]);
  const [msg, setMsg] = useState('');
  const load = () => api('/api/loans/me').then(setLoans).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  const giveBack = (id) => api(`/api/loans/${id}/return`, { method: 'POST' }).then(load).catch((e) => setMsg(e.message));

  return (
    <div>
      {msg && <p><b>{msg}</b></p>}
      <table border="1" cellPadding="6">
        <thead><tr><th>Buku</th><th>Jatuh tempo</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {loans.map((l) => (
            <tr key={l.id}>
              <td>{l.title}</td>
              <td>{new Date(l.due_at).toLocaleDateString('id-ID')}</td>
              <td>{l.returned_at ? 'Dikembalikan' : l.overdue ? 'TERLAMBAT' : 'Dipinjam'}</td>
              <td>{!l.returned_at && <button onClick={() => giveBack(l.id)}>Kembalikan</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Manage() {
  const [form, setForm] = useState({ title: '', author: '', category: '', stock: 1 });
  const [books, setBooks] = useState([]);
  const [msg, setMsg] = useState('');
  const load = () => api('/api/books').then(setBooks);
  useEffect(() => { load(); }, []);

  const add = async () => {
    try {
      await api('/api/manage/books', { method: 'POST', body: { ...form, stock: Number(form.stock) } });
      setMsg('Buku ditambahkan'); load();
    } catch (e) { setMsg(e.message); }
  };
  const remove = (id) => api(`/api/manage/books/${id}`, { method: 'DELETE' }).then(load).catch((e) => setMsg(e.message));

  return (
    <div>
      {['title', 'author', 'category', 'stock'].map((f) => (
        <input key={f} placeholder={f} value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} />
      ))}
      <button onClick={add}>Tambah</button>
      {msg && <p><b>{msg}</b></p>}
      <ul>
        {books.map((b) => (
          <li key={b.id}>{b.title} (stok {b.stock}) <button onClick={() => remove(b.id)}>Hapus</button></li>
        ))}
      </ul>
    </div>
  );
}

function Admin() {
  const [stats, setStats] = useState(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { api('/api/admin/stats').then(setStats).catch((e) => setMsg(e.message)); }, []);
  return (
    <div>
      {msg && <p><b>{msg}</b></p>}
      {stats && <pre>{JSON.stringify(stats, null, 2)}</pre>}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState('catalog');
  const [pod, setPod] = useState('...');
  const loggedIn = keycloak.authenticated;
  const isLibrarian = keycloak.hasRealmRole('librarian');
  const isAdmin = keycloak.hasRealmRole('admin');

  useEffect(() => { api('/api/info').then((d) => setPod(d.pod)).catch(() => setPod('?')); }, [tab]);

  return (
    <div style={{ padding: 20, fontFamily: 'sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h2>Perpustakaan</h2>
        <div>
          <span style={{ background: pod === 'POD 1' ? '#cfe8ff' : '#d4f5d4', padding: '4px 10px', borderRadius: 12 }}>
            Dilayani oleh: {pod}
          </span>{' '}
          {loggedIn
            ? <>{keycloak.tokenParsed.preferred_username} <button onClick={() => keycloak.logout({ redirectUri: window.location.origin })}>Logout</button></>
            : <button onClick={() => keycloak.login()}>Login</button>}
        </div>
      </header>
      <nav style={{ margin: '10px 0' }}>
        <button onClick={() => setTab('catalog')}>Katalog</button>
        {loggedIn && <button onClick={() => setTab('loans')}>Pinjaman Saya</button>}
        {isLibrarian && <button onClick={() => setTab('manage')}>Kelola Buku</button>}
        {isAdmin && <button onClick={() => setTab('admin')}>Admin</button>}
      </nav>
      {tab === 'catalog' && <Catalog />}
      {tab === 'loans' && <MyLoans />}
      {tab === 'manage' && <Manage />}
      {tab === 'admin' && <Admin />}
    </div>
  );
}