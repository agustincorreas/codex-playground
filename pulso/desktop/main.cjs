// Pulso de escritorio: una ventana propia que arranca el servidor de Pulso como proceso hijo, pide las
// claves la primera vez (quedan en el perfil del usuario, cifradas con el sistema, nunca en el código) y
// muestra la interfaz. Sin claves corre el simulador; con las de Alpaca (gratis) muestra el mercado real.
const { app, BrowserWindow, Menu, dialog, ipcMain, safeStorage, screen, shell, utilityProcess, clipboard } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { PREFERRED_PORT, pickPort, parsePortLine } = require('./port.cjs');
const { SECRET_FIELDS, electronStore, openSettings, sealSettings } = require('./secrets.cjs');

const APP_DIR = path.join(__dirname, 'app');
const SERVER = path.join(APP_DIR, 'server.cjs');
const MAX_LOG = 400;

let win = null;
let setupWin = null;
let server = null;
let serverGen = 0;
let serverReady = false;
/** Puerto real del servidor en curso (0 hasta que el hijo lo avisa con `PULSO_PORT=`). */
let port = 0;
/** Identificador de este arranque del servidor: el health check lo exige para no confundirlo con otro Pulso. */
let instance = '';
/** Si el hijo murió por el puerto ocupado, se vuelve a arrancar una vez dejando que el sistema elija otro. */
let forceAnyPort = false;
let lastError = '';
const logLines = [];

// ------------------------------------------------------------------ ajustes y registro

const userData = () => app.getPath('userData');
const settingsPath = () => path.join(userData(), 'pulso.json');
const logPath = () => path.join(userData(), 'pulso.log');

/** Almacén seguro del sistema para las claves (solo sirve después de `app.whenReady()`). */
const store = electronStore(safeStorage);
let storeWarned = false;
let migrated = false;

/** Ajustes con las claves en claro (en el archivo van cifradas; ver secrets.cjs). */
function readSettings() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
  const { settings, migrate, failed } = openSettings(raw, store);
  if (failed.length) pushLog(`[Pulso] No se pudieron descifrar estas claves (cambió el usuario o el llavero del sistema): ${failed.join(', ')}. Volvé a cargarlas en Claves y conexión.`);
  if (migrate && !migrated) {
    // Primera lectura con el almacén disponible y claves en claro: se reescriben cifradas.
    migrated = true;
    writeSettings(settings);
    pushLog('[Pulso] Las claves pasaron al almacenamiento seguro del sistema.');
  }
  if (!storeWarned && !store.available() && SECRET_FIELDS.some((f) => settings[f])) {
    storeWarned = true;
    pushLog('[Pulso] Aviso: el sistema no ofrece almacenamiento seguro (sin llavero); las claves quedan en claro en pulso.json, dentro de tu perfil de usuario.');
  }
  return settings;
}

function writeSettings(s) {
  fs.mkdirSync(userData(), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(sealSettings(s, store), null, 2));
}

function hasKeys(s) {
  return !!(s.alpacaKey && s.alpacaSecret);
}

/** Token que tiene que traer el celular para entrar (va en la dirección que da la app). Se crea una vez. */
function ensureToken(s) {
  if (s.token && /^[a-z0-9]{16,}$/.test(s.token)) return s.token;
  s.token = crypto.randomBytes(12).toString('hex');
  writeSettings(s);
  return s.token;
}

/** Dirección para abrir Pulso desde otro equipo de la red (con el token y el puerto actual, no uno guardado). */
function lanUrl(s) {
  const ips = localIps();
  return `http://${ips[0] ?? 'IP-DE-ESTA-COMPU'}:${port || PREFERRED_PORT}/?t=${ensureToken(s)}`;
}

/** Origen de la interfaz en esta computadora (cambia si el puerto cambió entre arranques). */
const localOrigin = () => `http://127.0.0.1:${port || PREFERRED_PORT}`;
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}
/** Solo páginas web (http/https) se abren en el navegador: nunca file:, javascript: u otros esquemas. */
function openOutside(url) {
  if (/^https?:$/.test(originOf(url) ? new URL(url).protocol : '')) void shell.openExternal(url);
}

/**
 * Versión privada: las claves vienen dentro de la app (app/defaults.json, generado al compilar con
 * las claves del dueño). La primera vez se copian a los ajustes (cifradas, como las demás) y no se pide nada.
 */
function applyDefaults() {
  const s = readSettings();
  if (hasKeys(s) || s.setupSeen) return s;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'defaults.json'), 'utf8'));
    if (!d || !d.alpacaKey || !d.alpacaSecret) return s;
    const next = {
      ...s,
      alpacaKey: String(d.alpacaKey),
      alpacaSecret: String(d.alpacaSecret),
      alpacaFeed: d.alpacaFeed === 'sip' ? 'sip' : 'auto',
      massiveKey: String(d.massiveKey || ''),
      massivePlan: d.massivePlan || 'basic',
      setupSeen: true,
    };
    writeSettings(next);
    return next;
  } catch {
    return s;
  }
}

let logWrites = 0;
function pushLog(line) {
  const text = line.replace(/\s+$/, '');
  if (!text) return;
  logLines.push(text);
  if (logLines.length > MAX_LOG) logLines.splice(0, logLines.length - MAX_LOG);
  try {
    // Rotación: pasados los 5 MB el registro se guarda como .1 y se empieza otro (queda uno anterior).
    if (++logWrites % 500 === 0 && fs.statSync(logPath()).size > 5 * 1024 * 1024) fs.renameSync(logPath(), logPath() + '.1');
    fs.appendFileSync(logPath(), text + '\n');
  } catch {
    // Sin permisos para el registro: se sigue igual.
  }
  if (win && !win.isDestroyed()) win.webContents.send('log', text);
}

function localIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

// ------------------------------------------------------------------ servidor

const serverHost = (s) => (s.lan ? '0.0.0.0' : '127.0.0.1');

/** Variables para el servidor hijo: las claves solo viajan por acá, nunca por archivo ni por la ventana. */
function serverEnv(s, wantedPort, inst) {
  const env = {
    PORT: String(wantedPort),
    HOST: serverHost(s),
    DATA_PROVIDER: hasKeys(s) ? 'alpaca' : 'demo',
    ALPACA_KEY_ID: s.alpacaKey || '',
    ALPACA_SECRET_KEY: s.alpacaSecret || '',
    ALPACA_FEED: s.alpacaFeed === 'sip' ? 'sip' : 'auto',
    MASSIVE_API_KEY: s.massiveKey || '',
    MASSIVE_PLAN: s.massivePlan || 'basic',
    SEC_USER_AGENT: s.secUserAgent || '',
    ANTHROPIC_API_KEY: s.anthropicKey || '',
    PULSO_TOKEN: s.lan ? ensureToken(s) : '',
    PULSO_INSTANCE: inst,
    PULSO_CACHE_DIR: path.join(userData(), 'cache'),
    PULSO_DATA_DIR: userData(),
    PULSO_DIST_DIR: path.join(APP_DIR, 'dist'),
    PULSO_DESKTOP: '1',
  };
  const merged = { ...process.env };
  // Lo que el usuario dejó vacío no se manda (la configuración lo trata como "sin definir"), salvo PORT=0.
  for (const [k, v] of Object.entries(env)) {
    if (v || k === 'PORT') merged[k] = v;
    else delete merged[k];
  }
  delete merged.ELECTRON_RUN_AS_NODE;
  return merged;
}

function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  serverReady = false;
  port = 0;
  try {
    s.kill();
  } catch {
    // Ya estaba terminado.
  }
}

async function startServer() {
  stopServer();
  const gen = ++serverGen;
  lastError = '';
  const s = readSettings();
  // Primero el puerto de siempre; si está ocupado, uno libre que elige el sistema (el servidor lo avisa).
  const wanted = forceAnyPort ? 0 : await pickPort(serverHost(s));
  if (gen !== serverGen) return;
  const inst = crypto.randomBytes(8).toString('hex');
  instance = inst;
  pushLog(`[Pulso] Arrancando el servidor (${hasKeys(s) ? 'datos reales con Alpaca' : 'simulador'})…`);
  const child = utilityProcess.fork(SERVER, [], { env: serverEnv(s, wanted, inst), stdio: 'pipe', serviceName: 'pulso-server' });
  server = child;
  let buf = '';
  let sawAddrInUse = false;
  const onData = (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const p = parsePortLine(line);
      if (p && gen === serverGen) {
        port = p;
        if (p !== PREFERRED_PORT) {
          pushLog(`[Pulso] Aviso: el puerto ${PREFERRED_PORT} estaba ocupado (¿otro Pulso abierto u otro programa?), así que este arranque usa el ${p}. La dirección para el celular cambia: copiala de nuevo desde el menú Pulso.`);
        }
        continue;
      }
      if (/ya está en uso/.test(line)) sawAddrInUse = true;
      pushLog(line);
    }
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('exit', (code) => {
    if (gen !== serverGen) return;
    server = null;
    serverReady = false;
    port = 0;
    // Alguien tomó el puerto entre la prueba y el arranque: se reintenta una vez con uno libre.
    if (sawAddrInUse && !forceAnyPort) {
      forceAnyPort = true;
      pushLog('[Pulso] El puerto quedó ocupado justo antes de arrancar: se reintenta con uno libre.');
      void startServer();
      return;
    }
    lastError = `El servidor se cerró (código ${code}).`;
    pushLog(`[Pulso] ${lastError}`);
    showStatus();
  });
  void waitForServer(gen);
}

/** `/api/health` del servidor en curso; solo cuenta si trae el identificador de este arranque. */
function health() {
  return new Promise((resolve) => {
    if (!port) return resolve(null);
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const ours = res.headers['x-pulso-instance'] === instance;
          resolve(res.statusCode === 200 && ours ? JSON.parse(body) : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function waitForServer(gen) {
  for (let i = 0; i < 240 && gen === serverGen && server; i++) {
    const h = await health();
    if (h && h.app === 'pulso') {
      serverReady = true;
      forceAnyPort = false;
      pushLog('[Pulso] Interfaz lista.');
      if (win && !win.isDestroyed()) void win.loadURL(`${localOrigin()}/`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (gen === serverGen && !serverReady && !lastError) {
    lastError = 'El servidor no respondió en dos minutos.';
    pushLog(`[Pulso] ${lastError}`);
    showStatus();
  }
}

// ------------------------------------------------------------------ ventanas

function showStatus() {
  if (!win || win.isDestroyed()) return;
  void win.loadFile(path.join(__dirname, 'loading.html'), { query: { error: lastError } });
}

function createWindow() {
  // Que entre en la pantalla (en una notebook, 920 px de alto tapaban la barra de estado con el Dock).
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1500, area.width),
    height: Math.min(920, area.height),
    minWidth: 360,
    minHeight: 600,
    title: 'Pulso',
    backgroundColor: '#0c1019',
    autoHideMenuBar: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  editContextMenu(win.webContents);
  win.on('closed', () => {
    win = null;
  });
  // Los links externos (noticias, documentación) se abren en el navegador.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (originOf(url) !== localOrigin()) openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (originOf(url) !== localOrigin() && !url.startsWith('file:')) {
      e.preventDefault();
      openOutside(url);
    }
  });
  showStatus();
}

/** Clic derecho en un campo de texto: Cortar / Copiar / Pegar (en Windows y Linux no hay otro camino). */
function editContextMenu(contents) {
  contents.on('context-menu', (_e, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const items = [];
    if (params.isEditable) items.push({ role: 'cut', label: 'Cortar', enabled: !!params.selectionText });
    items.push({ role: 'copy', label: 'Copiar', enabled: !!params.selectionText });
    if (params.isEditable) items.push({ role: 'paste', label: 'Pegar' }, { type: 'separator' }, { role: 'selectAll', label: 'Seleccionar todo' });
    Menu.buildFromTemplate(items).popup();
  });
}

function openSetup() {
  if (setupWin && !setupWin.isDestroyed()) {
    setupWin.focus();
    return;
  }
  setupWin = new BrowserWindow({
    width: 620,
    height: 760,
    parent: win ?? undefined,
    modal: !!win,
    resizable: true,
    minimizable: false,
    title: 'Pulso · Claves y conexión',
    backgroundColor: '#0c1019',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false },
  });
  setupWin.setMenuBarVisibility(false);
  editContextMenu(setupWin.webContents);
  setupWin.on('closed', () => {
    setupWin = null;
  });
  setupWin.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  void setupWin.loadFile(path.join(__dirname, 'setup.html'));
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu', label: 'Pulso' }] : []),
    {
      label: 'Pulso',
      submenu: [
        { label: 'Claves y conexión…', accelerator: 'CmdOrCtrl+,', click: openSetup },
        { label: 'Reiniciar el servidor', click: () => (showStatus(), void startServer()) },
        { type: 'separator' },
        { label: 'Abrir en el navegador', click: openInBrowser },
        { label: 'Copiar la dirección para el celular', click: copyLanUrl },
        { label: 'Ver el registro del servidor', click: () => shell.openPath(logPath()) },
        { label: 'Abrir la carpeta de datos', click: () => shell.openPath(userData()) },
        { type: 'separator' },
        isMac ? { role: 'close', label: 'Cerrar ventana' } : { role: 'quit', label: 'Salir' },
      ],
    },
    {
      // Sin este menú, en Mac no funcionan Cmd+C / Cmd+V en ningún campo (ni en el de las claves).
      label: 'Edición',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamaño normal' },
        { role: 'zoomIn', label: 'Agrandar' },
        { role: 'zoomOut', label: 'Achicar' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [
        { label: 'Cómo se usa (README)', click: () => shell.openExternal('https://github.com/agustincorreas/codex-playground/tree/main/pulso#readme') },
        { label: 'Seguridad: celular, token y claves', click: () => shell.openExternal('https://github.com/agustincorreas/codex-playground/blob/main/pulso/SECURITY.md') },
        { label: 'Conseguir las claves de Alpaca (gratis)', click: () => shell.openExternal('https://alpaca.markets') },
        { label: 'Conseguir la clave de Massive (gratis, float)', click: () => shell.openExternal('https://massive.com') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openInBrowser() {
  if (!serverReady || !port) {
    dialog.showMessageBox(win, { type: 'info', message: 'El servidor todavía está arrancando: probá en unos segundos.', buttons: ['Entendido'] });
    return;
  }
  void shell.openExternal(`${localOrigin()}/`);
}

function copyLanUrl() {
  const s = readSettings();
  if (!s.lan) {
    dialog.showMessageBox(win, { type: 'info', message: 'Para abrirlo desde el celular, activá "Permitir desde el celular" en Claves y conexión.', buttons: ['Entendido'] });
    return;
  }
  if (!serverReady || !port) {
    dialog.showMessageBox(win, { type: 'info', message: 'El servidor todavía está arrancando: probá en unos segundos (la dirección lleva el puerto que le toque).', buttons: ['Entendido'] });
    return;
  }
  const url = lanUrl(s);
  clipboard.writeText(url);
  const portNote = port === PREFERRED_PORT ? '' : ` Este arranque usa el puerto ${port} porque el ${PREFERRED_PORT} estaba ocupado: la dirección de antes ya no sirve.`;
  dialog.showMessageBox(win, { type: 'info', message: `Dirección copiada: ${url}`, detail: `Abrila en el celular conectado a la misma Wi-Fi. Lleva un token al final: sin él nadie de la red puede entrar.${portNote}`, buttons: ['Listo'] });
}

/** Token nuevo (el anterior deja de servir, cookies incluidas) y el servidor se reinicia si escucha la red. */
function rotateToken() {
  const s = readSettings();
  delete s.token;
  const token = ensureToken(s);
  pushLog('[Pulso] Token nuevo para el celular: la dirección anterior (y la cookie de cada celular) ya no sirve.');
  if (s.lan) {
    showStatus();
    void startServer();
  }
  return token;
}

// ------------------------------------------------------------------ IPC (lo que ven las páginas de la app)

/** ¿El pedido viene de una página de la app (claves, carga) y no de la interfaz web? */
const trustedFrame = (e) => String(e.senderFrame?.url ?? '').startsWith('file:');

ipcMain.handle('settings:get', (e) => {
  const s = readSettings();
  // Las claves solo las ve la ventana de configuración (un archivo de la app), nunca la interfaz web.
  const out = trustedFrame(e) ? { ...s, token: s.lan ? ensureToken(s) : s.token } : { ...s, alpacaKey: '', alpacaSecret: '', massiveKey: '', anthropicKey: '', secUserAgent: '', token: '' };
  return { ...out, ips: localIps(), port, preferredPort: PREFERRED_PORT, serverReady, secureStore: store.available(), hasKeys: hasKeys(s) };
});
ipcMain.handle('settings:save', (e, s) => {
  if (!trustedFrame(e)) return false;
  const clean = {
    alpacaKey: String(s.alpacaKey ?? '').trim(),
    alpacaSecret: String(s.alpacaSecret ?? '').trim(),
    alpacaFeed: s.alpacaFeed === 'sip' ? 'sip' : 'auto',
    massiveKey: String(s.massiveKey ?? '').trim(),
    massivePlan: ['basic', 'starter', 'developer', 'advanced'].includes(s.massivePlan) ? s.massivePlan : 'basic',
    secUserAgent: String(s.secUserAgent ?? '').trim(),
    anthropicKey: String(s.anthropicKey ?? '').trim(),
    lan: !!s.lan,
    token: readSettings().token,
  };
  writeSettings(clean);
  if (setupWin && !setupWin.isDestroyed()) setupWin.close();
  showStatus();
  void startServer();
  return true;
});
ipcMain.handle('settings:demo', () => {
  const s = readSettings();
  if (!s.setupSeen) writeSettings({ ...s, setupSeen: true });
  if (setupWin && !setupWin.isDestroyed()) setupWin.close();
  if (!server) void startServer();
  return true;
});
ipcMain.handle('token:rotate', (e) => (trustedFrame(e) ? rotateToken() : ''));
ipcMain.handle('setup:open', () => (openSetup(), true));
ipcMain.handle('log:get', () => logLines.slice());
ipcMain.handle('server:restart', () => (showStatus(), void startServer(), true));
ipcMain.handle('log:open', () => shell.openPath(logPath()));

// ------------------------------------------------------------------ ciclo de vida

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    const s = applyDefaults();
    void startServer();
    if (!hasKeys(s) && !s.setupSeen) openSetup();
    app.on('activate', () => {
      if (!win) createWindow();
    });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => stopServer());
}
