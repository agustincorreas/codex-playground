// Pulso de escritorio: una ventana propia que arranca el servidor de Pulso como proceso hijo, pide las
// claves la primera vez (quedan en el perfil del usuario, nunca en el código) y muestra la interfaz.
// Sin claves corre el simulador; con las de Alpaca (gratis) muestra el mercado real.
const { app, BrowserWindow, Menu, dialog, ipcMain, screen, shell, utilityProcess, clipboard } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const PORT = 8787;
const APP_DIR = path.join(__dirname, 'app');
const SERVER = path.join(APP_DIR, 'server.cjs');
const MAX_LOG = 400;

let win = null;
let setupWin = null;
let server = null;
let serverGen = 0;
let serverReady = false;
let lastError = '';
const logLines = [];

// ------------------------------------------------------------------ ajustes y registro

const userData = () => app.getPath('userData');
const settingsPath = () => path.join(userData(), 'pulso.json');
const logPath = () => path.join(userData(), 'pulso.log');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(s) {
  fs.mkdirSync(userData(), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
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

/** Dirección para abrir Pulso desde otro equipo de la red (con el token). */
function lanUrl(s) {
  const ips = localIps();
  return `http://${ips[0] ?? 'IP-DE-ESTA-COMPU'}:${PORT}/?t=${ensureToken(s)}`;
}

const LOCAL_ORIGIN = `http://127.0.0.1:${PORT}`;
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
 * las claves del dueño). La primera vez se copian a los ajustes y no se pide nada.
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

function serverEnv(s) {
  const env = {
    PORT: String(PORT),
    HOST: s.lan ? '0.0.0.0' : '127.0.0.1',
    DATA_PROVIDER: hasKeys(s) ? 'alpaca' : 'demo',
    ALPACA_KEY_ID: s.alpacaKey || '',
    ALPACA_SECRET_KEY: s.alpacaSecret || '',
    ALPACA_FEED: s.alpacaFeed === 'sip' ? 'sip' : 'auto',
    MASSIVE_API_KEY: s.massiveKey || '',
    MASSIVE_PLAN: s.massivePlan || 'basic',
    SEC_USER_AGENT: s.secUserAgent || '',
    ANTHROPIC_API_KEY: s.anthropicKey || '',
    PULSO_TOKEN: s.lan ? ensureToken(s) : '',
    PULSO_CACHE_DIR: path.join(userData(), 'cache'),
    PULSO_DATA_DIR: userData(),
    PULSO_DIST_DIR: path.join(APP_DIR, 'dist'),
    PULSO_DESKTOP: '1',
  };
  const merged = { ...process.env };
  // Lo que el usuario dejó vacío no se manda (la configuración lo trata como "sin definir").
  for (const [k, v] of Object.entries(env)) {
    if (v) merged[k] = v;
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
  try {
    s.kill();
  } catch {
    // Ya estaba terminado.
  }
}

function startServer() {
  stopServer();
  const gen = ++serverGen;
  lastError = '';
  const s = readSettings();
  pushLog(`[Pulso] Arrancando el servidor (${hasKeys(s) ? 'datos reales con Alpaca' : 'simulador'})…`);
  const child = utilityProcess.fork(SERVER, [], { env: serverEnv(s), stdio: 'pipe', serviceName: 'pulso-server' });
  server = child;
  let buf = '';
  const onData = (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) pushLog(line);
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('exit', (code) => {
    if (gen !== serverGen) return;
    server = null;
    serverReady = false;
    lastError = `El servidor se cerró (código ${code}).`;
    pushLog(`[Pulso] ${lastError}`);
    showStatus();
  });
  void waitForServer(gen);
}

function health() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout: 2000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 ? JSON.parse(body) : null);
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
      pushLog('[Pulso] Interfaz lista.');
      if (win && !win.isDestroyed()) void win.loadURL(`http://127.0.0.1:${PORT}/`);
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
    if (originOf(url) !== LOCAL_ORIGIN) openOutside(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (originOf(url) !== LOCAL_ORIGIN && !url.startsWith('file:')) {
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
        { label: 'Reiniciar el servidor', click: () => (showStatus(), startServer()) },
        { type: 'separator' },
        { label: 'Abrir en el navegador', click: () => shell.openExternal(`http://127.0.0.1:${PORT}/`) },
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
        { label: 'Conseguir las claves de Alpaca (gratis)', click: () => shell.openExternal('https://alpaca.markets') },
        { label: 'Conseguir la clave de Massive (gratis, float)', click: () => shell.openExternal('https://massive.com') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function copyLanUrl() {
  const s = readSettings();
  const ips = localIps();
  if (!s.lan) {
    dialog.showMessageBox(win, { type: 'info', message: 'Para abrirlo desde el celular, activá "Permitir desde el celular" en Claves y conexión.', buttons: ['Entendido'] });
    return;
  }
  const url = lanUrl(s);
  clipboard.writeText(url);
  dialog.showMessageBox(win, { type: 'info', message: `Dirección copiada: ${url}`, detail: 'Abrila en el celular conectado a la misma Wi-Fi. Lleva un token al final: sin él nadie de la red puede entrar.', buttons: ['Listo'] });
}

// ------------------------------------------------------------------ IPC (lo que ven las páginas de la app)

ipcMain.handle('settings:get', (e) => {
  const s = readSettings();
  // Las claves solo las ve la ventana de configuración (un archivo de la app), nunca la interfaz web.
  const trusted = String(e.senderFrame?.url ?? '').startsWith('file:');
  const out = trusted ? { ...s, token: s.lan ? ensureToken(s) : s.token } : { ...s, alpacaKey: '', alpacaSecret: '', massiveKey: '', anthropicKey: '', secUserAgent: '', token: '' };
  return { ...out, ips: localIps(), port: PORT, hasKeys: hasKeys(s) };
});
ipcMain.handle('settings:save', (_e, s) => {
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
  startServer();
  return true;
});
ipcMain.handle('settings:demo', () => {
  const s = readSettings();
  if (!s.setupSeen) writeSettings({ ...s, setupSeen: true });
  if (setupWin && !setupWin.isDestroyed()) setupWin.close();
  if (!server) startServer();
  return true;
});
ipcMain.handle('setup:open', () => (openSetup(), true));
ipcMain.handle('log:get', () => logLines.slice());
ipcMain.handle('server:restart', () => (showStatus(), startServer(), true));
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
    startServer();
    if (!hasKeys(s) && !s.setupSeen) openSetup();
    app.on('activate', () => {
      if (!win) createWindow();
    });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => stopServer());
}
