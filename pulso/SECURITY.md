# Seguridad de Pulso: celular, token y claves

Pulso corre entero en tu computadora: un servidor local (el que habla con Alpaca, Massive, la SEC y
Claude) y una interfaz que se muestra en la ventana de la app o en el navegador. Esta página explica
qué pasa cuando lo abrís desde el celular, dónde quedan las claves y qué hacer si algo se pierde.

## Qué implica "Permitir desde el celular"

Con la casilla apagada (así viene), el servidor escucha solo en `127.0.0.1`: **nadie fuera de tu
computadora puede conectarse**, ni aunque esté en tu misma Wi-Fi.

Con la casilla prendida, el servidor escucha en todas las interfaces de red (`0.0.0.0`) y entra quien
traiga el **token**:

- **Token.** Es una cadena aleatoria que la app genera una sola vez y guarda en los ajustes. Va al final
  de la dirección que da el menú *Pulso → Copiar la dirección para el celular*
  (`http://IP:8787/?t=TOKEN`). Sin el token, el servidor responde `403` a todo (páginas, API y
  WebSocket).
- **Cookie.** La primera vez que un celular entra con el token, el servidor le deja una cookie
  (`pulso_t`, un año, `HttpOnly`, `SameSite=Strict`). Desde entonces, en ese celular la dirección sin
  token también sirve. La cookie vale lo mismo que el token: **quien tenga el celular, entra**.
- **Mismo origen.** Si el pedido trae `Origin` (lo manda todo navegador en la API y en el WebSocket),
  tiene que ser el mismo host al que le habla. Así una página web ajena abierta en tu navegador no
  puede usar tu servidor local aunque corra en tu computadora.
- **La propia computadora** entra siempre sin token (conexiones desde `127.0.0.1`).

Qué puede hacer alguien de tu red que tenga el token (o el celular con la cookie):

- Ver el escáner, las alertas, las noticias y las cotizaciones que Pulso muestra.
- **Operar la cuenta de práctica** (es una sola para todos los dispositivos): comprar, vender, borrar
  el historial, cambiar los ajustes del motor. Es plata ficticia, pero es tu registro de práctica.
- **Gastar tu clave de Claude** a través del IA Trader, dentro del tope del servidor: **30 pedidos por
  minuto** entre todos los que estén conectados (~US$ 0,02 cada uno). No puede verla ni sacarla.
- No puede ver ni sacar las claves de Alpaca, Massive ni Anthropic: nunca salen del servidor (ver
  abajo). Tampoco puede operar la cuenta real de Alpaca: Pulso solo usa la cuenta *paper* para datos.

El token viaja en claro por tu Wi-Fi (`http://`, no `https://`): **activalo solo en redes en las que
confiás** (tu casa), nunca en una Wi-Fi pública. Y cuando no lo uses, apagá la casilla: el servidor
vuelve a escuchar solo en tu computadora.

## Dónde quedan las claves

- **En la app de escritorio**, las claves (Alpaca Key ID y Secret, Massive, Anthropic) se guardan en
  `pulso.json` dentro de tu perfil de usuario (menú *Pulso → Abrir la carpeta de datos*), **cifradas
  con el almacenamiento seguro del sistema** (`safeStorage` de Electron): el llavero en Mac, DPAPI en
  Windows, el llavero del escritorio en Linux. En el archivo aparecen como `enc:…`; solo tu usuario, en
  esa computadora, las puede descifrar. Las claves que estaban en claro de una versión anterior se
  reescriben cifradas la primera vez que la app las lee.
- Si el sistema no ofrece cifrado (Linux sin llavero, o con el backend `basic_text`), la app lo avisa
  en el registro y en la ventana de claves, y las guarda en claro en ese archivo.
- Las claves van del proceso principal al **servidor hijo solo por variables de entorno**: no se
  escriben en ningún otro archivo ni se mandan a ninguna ventana. La ventana principal (la interfaz
  web) recibe los ajustes **con las claves y el token enmascarados**; solo la ventana *Claves y
  conexión* los ve, y es una página local de la app, no una del servidor.
- Si corrés el servidor a mano con Node, las claves están en `pulso/.env`, en claro (es un archivo tuyo
  que no se sube al repositorio: está en `.gitignore`).

## Qué nunca sale del servidor

- Las claves de Alpaca, Massive, Anthropic, FMP y tu `SEC_USER_AGENT`.
- Las respuestas crudas de los proveedores: el navegador recibe solo lo que arma el motor (vistas, velas,
  alertas, noticias, la ficha para el IA Trader).
- La opinión de Claude se pide desde el servidor; la clave no viaja al navegador ni al celular.
- El servidor no manda nada a ningún lado que no sea el proveedor de datos, la SEC, Nasdaq (halts por
  RSS) y Anthropic (si cargaste la clave). No hay telemetría.

## Cómo rotar el token

El token no se puede "cambiar": se genera otro y el anterior deja de servir (y con él, la cookie de cada
celular que había entrado). Tres caminos:

1. **Desde la app:** *Pulso → Claves y conexión…* → botón **Generar otro token** (aparece cuando
   "Permitir desde el celular" está guardado). La app genera uno nuevo, reinicia el servidor y muestra
   la dirección nueva. Copiala con *Copiar la dirección para el celular* y abrila en el celular.
2. **A mano:** cerrá Pulso, abrí `pulso.json` en la carpeta de datos y borrá la línea `"token": "…"`.
   Al volver a abrir la app se genera otro.
3. **Con Node** (`npm start`): cambiá `PULSO_TOKEN` en `.env` y reiniciá; si no está definido, cada
   arranque genera uno nuevo y lo muestra en el registro.

## Si perdiste el celular (o uno ajeno entró)

1. Abrí Pulso en la computadora → *Claves y conexión…* → **Generar otro token**. Con eso el celular
   perdido queda afuera aunque tenga la cookie. Si no querés que entre nadie más por ahora, apagá
   también "Permitir desde el celular" y guardá.
2. Revisá la cuenta de práctica (botón del saldo) por si operaron: es plata ficticia, pero podés borrar
   el historial desde ahí.
3. Las claves no estaban en el celular: no hace falta cambiarlas. Si igual querés, en la cuenta de
   Alpaca (*API Keys → Regenerate*) y en console.anthropic.com se generan otras, y las cargás en
   *Claves y conexión*.
4. La clave de Claude se pudo gastar solo mientras el celular tuvo acceso, y a lo sumo 30 pedidos por
   minuto; mirá el consumo en console.anthropic.com.

## Lo que Pulso no cubre

- No hay `https` ni usuarios: es una app para una persona en su red de confianza.
- La app de escritorio **no está firmada** (ver la sección de instalación del README): el sistema avisa
  la primera vez que la abrís. Bajala solo de los Releases del repositorio.
- Las claves cifradas se abren con tu sesión de usuario: si alguien usa tu computadora con tu usuario
  desbloqueado, puede abrir Pulso y verlas en *Claves y conexión* (como cualquier app con llavero).
