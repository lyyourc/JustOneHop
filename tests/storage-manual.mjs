// Disposable, loopback-only fixture for native Chrome acceptance.
import { createServer } from 'node:http';
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Set-Cookie', ['justonehop_http_only=native-cookie-value; HttpOnly; SameSite=Lax; Path=/', 'justonehop_visible=visible-cookie-value; SameSite=Lax; Path=/']);
  response.end(`<!doctype html><html><head><title>JustOneHop Storage Acceptance</title></head><body style="font:16px system-ui;max-width:680px;margin:60px auto"><h1>JustOneHop Storage Acceptance</h1><p>Disposable local fixture. Open JustOneHop and search local storage, session storage, or cookie.</p><p>Local: justonehop.config → {"theme":"snazzy","message":"你好"}</p><p>Session: justonehop.session → session-native-value</p><p>HttpOnly cookie: justonehop_http_only → native-cookie-value</p><label>Paste copied value here <textarea aria-label="Paste copied value" style="display:block;width:100%;height:100px"></textarea></label><script>localStorage.setItem('justonehop.config','{"theme":"snazzy","message":"你好"}');localStorage.setItem('justonehop.empty','');sessionStorage.setItem('justonehop.session','session-native-value');</script></body></html>`);
});
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port));
