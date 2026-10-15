// Disposable, loopback-only fixture for native Chrome acceptance.
import { createServer } from 'node:http';
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Set-Cookie', ['zing_http_only=native-cookie-value; HttpOnly; SameSite=Lax; Path=/', 'zing_visible=visible-cookie-value; SameSite=Lax; Path=/']);
  response.end(`<!doctype html><html><head><title>zing Storage Acceptance</title></head><body style="font:16px system-ui;max-width:680px;margin:60px auto"><h1>zing Storage Acceptance</h1><p>Disposable local fixture. Open zing and search local storage, session storage, or cookie.</p><p>Local: zing.config → {"theme":"snazzy","message":"你好"}</p><p>Session: zing.session → session-native-value</p><p>HttpOnly cookie: zing_http_only → native-cookie-value</p><label>Paste copied value here <textarea aria-label="Paste copied value" style="display:block;width:100%;height:100px"></textarea></label><script>localStorage.setItem('zing.config','{"theme":"snazzy","message":"你好"}');localStorage.setItem('zing.empty','');sessionStorage.setItem('zing.session','session-native-value');</script></body></html>`);
});
server.listen(0, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port));
