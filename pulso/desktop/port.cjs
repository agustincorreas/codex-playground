// Puerto del servidor de la app de escritorio: se prueba primero el de siempre (8787) para que la dirección
// del celular casi nunca cambie y, si está ocupado (otro Pulso abierto, otro programa), se deja que el
// sistema elija uno libre (PORT=0). El servidor avisa el puerto real con una línea `PULSO_PORT=…` en su
// salida y la app la lee de ahí. Sin Electron: se prueba con Node pelado.
const net = require('node:net');

const PREFERRED_PORT = 8787;

/** ¿Se puede escuchar en ese puerto y dirección ahora mismo? (se abre y se cierra enseguida). */
function portFree(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.listen({ port, host, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}

/**
 * Puerto con el que arrancar el servidor: el preferido si está libre, o 0 (que el sistema elija uno).
 * `host` es el mismo en el que va a escuchar el servidor (0.0.0.0 si se permite el celular).
 */
async function pickPort(host, preferred = PREFERRED_PORT) {
  return (await portFree(preferred, host)) ? preferred : 0;
}

/** Puerto que anuncia una línea de la salida del servidor (`PULSO_PORT=12345`), o null si no es esa línea. */
function parsePortLine(line) {
  const m = /^PULSO_PORT=(\d{1,5})\s*$/.exec(line);
  if (!m) return null;
  const port = Number(m[1]);
  return port > 0 && port < 65536 ? port : null;
}

module.exports = { PREFERRED_PORT, portFree, pickPort, parsePortLine };
