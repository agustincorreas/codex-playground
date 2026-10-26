// Sector (industria) de cada acción: Massive (`sic_description` de la ficha del ticker; el plan gratis
// alcanza) o, si no, la SEC (la misma descripción SIC). Se guarda en la caché del disco para siempre.
import { cacheDir, getJson, type Log, type RateLimiter } from './util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Las industrias SIC más comunes entre las small caps, en castellano; el resto queda en inglés. */
const ES: Array<[RegExp, string]> = [
  [/^pharmaceutical preparations$/i, 'Farmacéutica'],
  [/^biological products/i, 'Biotecnología'],
  [/in vitro|in vivo diagnostic/i, 'Diagnóstico médico'],
  [/^surgical|^orthopedic|electromedical|medical instruments|^dental/i, 'Dispositivos médicos'],
  [/^services-prepackaged software|^prepackaged software/i, 'Software'],
  [/computer programming|data processing|computer processing/i, 'Servicios informáticos'],
  [/^semiconductors/i, 'Semiconductores'],
  [/^electronic computers|computer peripheral|computer communications/i, 'Hardware'],
  [/^blank checks?$/i, 'SPAC (cheque en blanco)'],
  [/^finance services|^finance lessors|personal credit|^loan brokers/i, 'Servicios financieros'],
  [/^state commercial banks|^national commercial banks|^savings institution/i, 'Bancos'],
  [/^security brokers|investment advice|^investors, nec/i, 'Inversiones'],
  [/real estate investment trusts/i, 'REIT (inmobiliario)'],
  [/^real estate|operators of (nonresidential|apartment)/i, 'Inmobiliario'],
  [/^crude petroleum|^oil & gas|^drilling oil|oil royalty/i, 'Petróleo y gas'],
  [/^gold and silver ores|^metal mining|^mining & quarrying|^miscellaneous metal ores/i, 'Minería'],
  [/^motor vehicles & passenger|^motor vehicle parts/i, 'Automotriz'],
  [/^electric services|^cogeneration|small power producers/i, 'Energía'],
  [/^semiconductors|^electrical industrial|^electronic components/i, 'Electrónica'],
  [/^retail-|^retail /i, 'Comercio minorista'],
  [/^wholesale-|^wholesale /i, 'Comercio mayorista'],
  [/^retail-eating|^eating places/i, 'Restaurantes'],
  [/^hotels|^motels/i, 'Hotelería'],
  [/^air transportation|^aircraft/i, 'Aviación'],
  [/^deep sea foreign transportation|^water transportation|^ship/i, 'Transporte marítimo'],
  [/^trucking|^transportation services|^arrangement of transportation/i, 'Transporte y logística'],
  [/^telephone communications|^radiotelephone|^communications services/i, 'Telecomunicaciones'],
  [/^cable & other pay television|^television broadcasting|^radio broadcasting/i, 'Medios'],
  [/^services-educational|^educational services/i, 'Educación'],
  [/^services-engineering|^services-management consulting|^services-business services|^services-misc/i, 'Servicios'],
  [/^services-health services|^hospitals|^services-nursing|^services-home health|^services-medical lab/i, 'Salud'],
  [/^services-advertising|^services-computer integrated/i, 'Servicios'],
  [/^agricultural|^agriculture/i, 'Agro'],
  [/^beverages|^bottled|^malt beverages|^distilled/i, 'Bebidas'],
  [/^food and kindred|^canned|^grain mill|^bakery|^sugar/i, 'Alimentos'],
  [/^perfumes|^cosmetics/i, 'Cosmética'],
  [/^medicinal chemicals|^plastics materials|^industrial organic|^industrial inorganic|^chemicals/i, 'Química'],
  [/^construction|^heavy construction|^operative builders/i, 'Construcción'],
  [/^apparel|^footwear|^women's|^men's/i, 'Indumentaria'],
  [/^games, toys|^dolls|^sporting/i, 'Juguetes y deportes'],
  [/^ship & boat|^guided missiles|^ordnance/i, 'Defensa'],
  [/^special industry machinery|^general industrial machinery|^industrial trucks|^metalworking/i, 'Maquinaria'],
  [/^search, detection|^measuring & controlling|^optical instruments|^laboratory analytical/i, 'Instrumentos'],
  [/^patent owners|^lessors of real property/i, 'Licencias y propiedad'],
  [/^wholesale-drugs|^drug stores/i, 'Farmacias y droguerías'],
  [/^services-amusement|^services-motion picture|^motion picture/i, 'Entretenimiento'],
  [/^cigarettes|^tobacco/i, 'Tabaco'],
  [/^steel works|^primary smelting|^rolling drawing|^nonferrous/i, 'Metalurgia'],
  [/^household appliances|^household furniture|^household audio/i, 'Hogar'],
  [/^gas transmission|^natural gas distribution|^petroleum refining/i, 'Gas y refinación'],
  [/^insurance|^fire, marine|^life insurance|^accident & health/i, 'Seguros'],
  [/^services-commercial physical|^research/i, 'Investigación y desarrollo'],
  [/^cryptocurrency|^crypto|digital assets|bitcoin|^finance services$/i, 'Cripto y finanzas'],
];

export function spanishIndustry(desc: string): string {
  const d = desc.trim();
  if (!d) return '';
  for (const [re, es] of ES) if (re.test(d)) return es;
  // Sin traducción: la descripción SIC en inglés, con mayúsculas normales.
  return d.length > 3 && d === d.toUpperCase() ? d.charAt(0) + d.slice(1).toLowerCase() : d;
}

interface MassiveTicker {
  results?: { sic_description?: string; sic_code?: string };
}

export class SectorLookup {
  private cache = new Map<string, string>();
  private inFlight = new Map<string, Promise<string>>();
  private readonly file = join(cacheDir(), 'sectores.json');
  private dirty = false;

  constructor(
    private readonly massive: { restUrl: string; key: string; limiter: RateLimiter } | null,
    private readonly sec: { industry(sym: string): Promise<string | null> } | null,
    private readonly log: Log,
  ) {
    try {
      if (existsSync(this.file)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>)) this.cache.set(k, v);
    } catch {
      // Caché ilegible: se vuelve a armar.
    }
    setInterval(() => this.flush(), 60_000).unref();
  }

  get available(): boolean {
    return !!(this.massive || this.sec);
  }

  /** Sector en castellano ('' si no se conoce). Se pide una sola vez por símbolo. */
  get(sym: string): Promise<string> {
    const hit = this.cache.get(sym);
    if (hit !== undefined) return Promise.resolve(hit);
    const pending = this.inFlight.get(sym);
    if (pending) return pending;
    const p = this.lookup(sym)
      .then((v) => {
        this.cache.set(sym, v);
        this.dirty = true;
        return v;
      })
      .finally(() => this.inFlight.delete(sym));
    this.inFlight.set(sym, p);
    return p;
  }

  has(sym: string): boolean {
    return this.cache.has(sym);
  }

  private async lookup(sym: string): Promise<string> {
    if (this.massive) {
      try {
        const res = await getJson<MassiveTicker>(`${this.massive.restUrl}/v3/reference/tickers/${encodeURIComponent(sym)}?apiKey=${this.massive.key}`, { limiter: this.massive.limiter });
        const desc = res.results?.sic_description ?? '';
        if (desc) return spanishIndustry(desc);
      } catch (e) {
        this.log('warn', `Sector de ${sym} (Massive): ${(e as Error).message.replace(/apiKey=[^&\s]+/g, 'apiKey=…')}`);
      }
    }
    if (this.sec) {
      try {
        const desc = await this.sec.industry(sym);
        if (desc) return spanishIndustry(desc);
      } catch {
        // La SEC ya avisó en su registro.
      }
    }
    return '';
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      mkdirSync(cacheDir(), { recursive: true });
      writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.cache)));
    } catch (e) {
      this.log('warn', `No se pudo guardar la caché de sectores: ${(e as Error).message}`);
    }
  }
}
