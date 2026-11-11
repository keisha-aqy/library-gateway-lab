import { createRoot } from 'react-dom/client';
import keycloak from './keycloak';
import App from './App';

keycloak
  .init({ onLoad: 'check-sso', pkceMethod: 'S256', checkLoginIframe: false })
  .then(() => createRoot(document.getElementById('root')).render(<App />))
  .catch(() => { document.getElementById('root').innerText = 'Gagal terhubung ke Keycloak'; });