/* ==========================================================================
   CAMPANA · fichas de las acciones y paleta de sectores
   Cada sector define su instrumento, su forma de frasear y su color.
   ========================================================================== */
(function (g) {
  'use strict';

  // instrumento: preset del motor · ritmo: patrón del solista · registro: corrimiento en semitonos
  const SECTORES = {
    indice:   { nombre: 'Índice de mercado',        color: '#9fb8ff', instrumento: 'pad',     ritmo: 'sostenido', registro: 0 },
    internet: { nombre: 'Internet y redes sociales', color: '#5ad1ff', instrumento: 'arpa',    ritmo: 'arpegio',   registro: 2 },
    software: { nombre: 'Software e IA',             color: '#7cf0e3', instrumento: 'pulso',   ritmo: 'arpegio',   registro: 3 },
    semis:    { nombre: 'Semiconductores',           color: '#c9a3ff', instrumento: 'cristal', ritmo: 'motor',     registro: 5 },
    biotec:   { nombre: 'Biotecnología',             color: '#ff9ad5', instrumento: 'coro',    ritmo: 'rubato',    registro: 7 },
    farma:    { nombre: 'Farmacéutica',              color: '#ffb3e6', instrumento: 'coro',    ritmo: 'rubato',    registro: 5 },
    salud:    { nombre: 'Salud y dispositivos',      color: '#ffc2d1', instrumento: 'cristal', ritmo: 'rubato',    registro: 4 },
    energia:  { nombre: 'Petróleo y gas',            color: '#ffb067', instrumento: 'bronce',  ritmo: 'sostenido', registro: -7 },
    bancos:   { nombre: 'Bancos y finanzas',         color: '#ffd56b', instrumento: 'epiano',  ritmo: 'swing',     registro: -2 },
    cripto:   { nombre: 'Cripto',                    color: '#9dff8a', instrumento: 'chip',    ritmo: 'glitch',    registro: 4 },
    consumo:  { nombre: 'Consumo y comercio',        color: '#ffcf9f', instrumento: 'marimba', ritmo: 'tresillo',  registro: 0 },
    auto:     { nombre: 'Automotriz',                color: '#ff8f7a', instrumento: 'metal',   ritmo: 'motor',     registro: -3 },
    mineria:  { nombre: 'Minería',                   color: '#d7b98a', instrumento: 'gong',    ritmo: 'sostenido', registro: -10 },
    maritimo: { nombre: 'Transporte marítimo',       color: '#6fd3c7', instrumento: 'bronce',  ritmo: 'ola',       registro: -5 },
    hardware: { nombre: 'Hardware y telecomunicaciones', color: '#b5c7d8', instrumento: 'organo', ritmo: 'arpegio', registro: 0 },
    otros:    { nombre: 'Otros',                     color: '#e0e0e0', instrumento: 'pulso',   ritmo: 'arpegio',   registro: 0 },
  };

  // Fichas de los símbolos incluidos en los días grabados (capital en dólares, aproximado).
  const FICHAS = {
    SPY:  { nombre: 'SPDR S&P 500 ETF Trust',  sector: 'indice',   tipo: 'ETF', capital: 1.1e12 },
    META: { nombre: 'Meta Platforms',          sector: 'internet', capital: 1.58e12 },
    NVDA: { nombre: 'Nvidia',                  sector: 'semis',    capital: 4.88e12 },
    MRNA: { nombre: 'Moderna',                 sector: 'biotec',   capital: 8.8e10 },
    XOM:  { nombre: 'ExxonMobil',              sector: 'energia',  capital: 7.3e11 },
    JPM:  { nombre: 'JPMorgan Chase',          sector: 'bancos',   capital: 9.5e11 },
    COIN: { nombre: 'Coinbase',                sector: 'cripto',   capital: 5e10 },
    VRME: { nombre: 'VerifyMe',                sector: 'software', capital: 1.5e8 },
    GRML: { nombre: 'Greenland Mines',         sector: 'mineria',  capital: 5.5e7 },
    AMZN: { nombre: 'Amazon',                  sector: 'consumo',  capital: 2.5e12 },
    PLTR: { nombre: 'Palantir',                sector: 'software', capital: 4.3e11 },
    TSLA: { nombre: 'Tesla',                   sector: 'auto',     capital: 1.3e12 },
    AIOK: { nombre: 'AI OKTO',                 sector: 'maritimo', capital: 5.5e7 },
    CLRO: { nombre: 'ClearOne',                sector: 'hardware', capital: 1.5e7 },
    KO:   { nombre: 'Coca-Cola',               sector: 'consumo',  capital: 3.8e11 },
    AAPL: { nombre: 'Apple',                   sector: 'hardware', capital: 5.1e12 },
    MSFT: { nombre: 'Microsoft',               sector: 'software', capital: 3.9e12 },
    GOOGL:{ nombre: 'Alphabet',                sector: 'internet', capital: 3.4e12 },
    AMD:  { nombre: 'AMD',                     sector: 'semis',    capital: 9e11 },
    GS:   { nombre: 'Goldman Sachs',           sector: 'bancos',   capital: 2.8e11 },
    CVX:  { nombre: 'Chevron',                 sector: 'energia',  capital: 4e11 },
    PFE:  { nombre: 'Pfizer',                  sector: 'farma',    capital: 1.7e11 },
    WMT:  { nombre: 'Walmart',                 sector: 'consumo',  capital: 9.8e11 },
    BA:   { nombre: 'Boeing',                  sector: 'auto',     capital: 1.3e11 },
    DIS:  { nombre: 'Disney',                  sector: 'consumo',  capital: 2e11 },
    QQQ:  { nombre: 'Invesco QQQ (Nasdaq 100)', sector: 'indice', tipo: 'ETF', capital: 4e11 },
    IWM:  { nombre: 'iShares Russell 2000',    sector: 'indice',   tipo: 'ETF', capital: 7e10 },
  };

  // Traduce la descripción SIC que devuelve Massive en una clave de sector (para el modo en vivo).
  const SIC = [
    [/semiconductor/i, 'semis'],
    [/biological|biotech/i, 'biotec'],
    [/pharmaceutical|medicinal/i, 'farma'],
    [/surgical|medical|dental|hospital|health|diagnostic/i, 'salud'],
    [/computer programming|data processing|prepackaged software|services-computer/i, 'software'],
    [/internet|advertising|information retrieval/i, 'internet'],
    [/petroleum|crude|oil|gas|drilling|refining/i, 'energia'],
    [/bank|savings|finance|security broker|investment|insurance|loan|credit/i, 'bancos'],
    [/crypto|digital asset|bitcoin|blockchain/i, 'cripto'],
    [/retail|wholesale|beverage|food|apparel|eating|restaurant|hotel|amusement|motion picture/i, 'consumo'],
    [/motor vehicle|aircraft|aerospace|truck|machinery|industrial/i, 'auto'],
    [/mining|gold|silver|metal|ores|steel|smelting/i, 'mineria'],
    [/water transportation|deep sea|ship|marine|tanker/i, 'maritimo'],
    [/telephone|telegraph|radio|television|communications|electronic|computer peripheral|hardware/i, 'hardware'],
  ];

  function sectorDesdeSic(desc, nombre) {
    const texto = `${desc || ''} ${nombre || ''}`;
    for (const [re, k] of SIC) if (re.test(texto)) return k;
    return 'otros';
  }

  // Tramo de capitalización: define el peso del registro y la "gravedad" de la textura.
  function tramoCapital(capital) {
    if (!capital) return { clave: 'desconocido', nombre: 'capitalización desconocida', peso: 0.5 };
    if (capital >= 2e11) return { clave: 'mega', nombre: 'mega cap', peso: 1 };
    if (capital >= 1e10) return { clave: 'grande', nombre: 'large cap', peso: 0.8 };
    if (capital >= 2e9) return { clave: 'mediana', nombre: 'mid cap', peso: 0.6 };
    if (capital >= 3e8) return { clave: 'pequena', nombre: 'small cap', peso: 0.4 };
    return { clave: 'micro', nombre: 'micro cap', peso: 0.2 };
  }

  function ficha(sym) {
    const f = FICHAS[sym] || { nombre: sym, sector: 'otros' };
    const sector = SECTORES[f.sector] || SECTORES.otros;
    return Object.assign({ sym, tipo: 'CS', sectorClave: f.sector }, f, { sectorInfo: sector, tramo: tramoCapital(f.capital) });
  }

  function registrarFicha(sym, datos) {
    FICHAS[sym] = Object.assign({}, FICHAS[sym] || {}, datos);
  }

  g.Campana = g.Campana || {};
  Object.assign(g.Campana, { SECTORES, FICHAS, ficha, registrarFicha, sectorDesdeSic, tramoCapital });
})(window);
