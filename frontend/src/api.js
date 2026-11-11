import keycloak from './keycloak';

const BASE = 'http://localhost:9080';   // alamat APISIX

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (keycloak.authenticated) {
    await keycloak.updateToken(30);                       // perbarui token jika hampir kedaluwarsa
    headers.Authorization = `Bearer ${keycloak.token}`;   // sertakan token di setiap request
  }
  const res = await fetch(BASE + path, { method, headers, body: body && JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status}: ${data.error || data.error_msg || 'Request gagal'}`);
  return data;
}