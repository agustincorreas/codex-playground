// Panel del IA Trader: modo (apagado, sugerencias, automático), qué está mirando y por qué, las
// posiciones que maneja con su R en vivo, la sugerencia del momento con sus botones, la opinión de
// Claude, el resumen del día, las candidatas, las reglas y el registro.
import { useAiVersion, type AiTrader } from '../aitrader';
import { formatEtTime } from '../../engine/time';
import { PROFILE_HINT, PROFILE_LABEL } from '../../trading/playbook';

interface Props {
  trader: AiTrader;
  selected: string | null;
  onSelect: (sym: string) => void;
}

const PHASE: Record<string, string> = {
  off: 'Apagado',
  scanning: 'Recorriendo los escáneres',
  watching: 'Mirando de cerca',
  entering: 'Comprando',
  inPosition: 'Manejando la posición',
  paused: 'Parado por hoy',
};

const px = (v: number) => (v >= 1 ? v.toFixed(2) : v.toFixed(4));
const fmtR = (r: number) => `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}R`;

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : 0;
};

export function AiTraderPanel({ trader, selected, onSelect }: Props) {
  useAiVersion(trader);
  const st = trader.state;
  const s = trader.settings;
  const sug = st.suggestion;
  const aiLabel = st.ai === 'claude' ? 'Claude (desde Claude)' : st.ai === 'servidor' ? 'Claude (clave en el servidor)' : st.ai === 'no' ? 'sin IA: solo reglas' : 'buscando IA…';
  return (
    <div className="ai-panel">
      <div className="ai-row ai-head">
        <div className="seg" role="group" aria-label="Modo del IA Trader">
          {(['off', 'suggest', 'auto'] as const).map((m) => (
            <button key={m} className={s.mode === m ? 'is-active' : ''} onClick={() => trader.update({ mode: m })}>
              {m === 'off' ? 'Apagado' : m === 'suggest' ? 'Sugerencias' : 'Automático'}
            </button>
          ))}
        </div>
        <span className="t-muted small">
          {aiLabel}
          {st.calls > 0 && ` · ${st.calls} consulta${st.calls === 1 ? '' : 's'} (≈ US$ ${(st.calls * 0.02).toFixed(2)})`}
        </span>
      </div>
      <p className="t-muted small ai-note">Opera solo la cuenta de práctica (plata ficticia), con las reglas de momentum de Ross Cameron. No es asesoramiento financiero.</p>

      {s.mode !== 'off' && (
        <div className="ai-card ai-status">
          <b>{PHASE[st.phase] ?? st.phase}</b>
          {st.focus && (
            <>
              {' '}
              <button type="button" className="link" onClick={() => onSelect(st.focus!)}>
                {st.focus}
              </button>
            </>
          )}
          {st.thinking && <em className="ai-thinking"> · Claude está {st.asking === 'summary' ? 'resumiendo el día' : 'pensando'}…</em>}
          {st.phase === 'paused' && <div className="ai-paused">{st.pausedReason}</div>}
          {st.phase !== 'paused' && st.waiting && <div className="t-muted small ai-waiting">{st.waiting}</div>}
          {st.plan && (
            <div className="small ai-plan">
              Plan: {st.plan.kind.toLowerCase()} en <span className="mono">{st.plan.sym}</span>, {st.plan.shares} a ${px(st.plan.entry)}, stop ${px(st.plan.stop)}, objetivo ${px(st.plan.target)}
              {st.plan.note && <span className="t-muted"> · {st.plan.note}</span>}
            </div>
          )}
          {(st.day.trades > 0 || st.day.avoid.length > 0) && (
            <div className="t-muted small ai-day">
              Hoy: {st.day.trades} trade{st.day.trades === 1 ? '' : 's'}
              {st.day.trades > 0 && ` (${st.day.wins} ganador${st.day.wins === 1 ? '' : 'es'}), ${fmtR(st.day.netR)}`}
              {st.day.avoid.length > 0 && `; evita ${st.day.avoid.join(', ')}`}
            </div>
          )}
        </div>
      )}

      {s.mode !== 'off' && st.positions.length > 0 && (
        <div className="ai-card ai-positions">
          <div className="ai-sub">
            Posiciones ({st.positions.length}
            {s.rules.maxPositions > 1 ? ` de ${s.rules.maxPositions}` : ''})
          </div>
          {st.positions.map((p) => (
            <div key={p.sym} className={`ai-cand ai-pos ${p.sym === selected ? 'is-focus' : ''}`}>
              <button type="button" className="link mono" onClick={() => onSelect(p.sym)}>
                {p.sym}
              </button>
              <b className={p.r >= 0 ? 't-up' : 't-down'}>{fmtR(p.r)}</b>
              <span className="small">
                {p.shares} a ${px(p.avgCost)}
                {p.stop !== null && ` · stop ${px(p.stop)}`}
                {p.target !== null && ` · obj. ${px(p.target)}`}
                {p.halfTaken && ' · mitad tomada'}
                {p.added && ' · agregó'}
                {p.secondChance && ' · segunda chance'}
              </span>
              {p.kind && <span className="t-muted small"> · {p.kind}</span>}
            </div>
          ))}
        </div>
      )}

      {st.daySummary && (
        <div className="ai-card ai-advice">
          <b>Resumen del día (Claude)</b>
          <div>{st.daySummary}</div>
        </div>
      )}

      {sug && (
        <div className={`ai-card ai-sug ai-${sug.kind}`}>
          <div className="ai-sug-title">
            <b>{sug.title}</b> <span className="t-muted small">{formatEtTime(sug.ts, false)}</span>
          </div>
          <div className="ai-sug-text">{sug.text}</div>
          <div className="ai-row">
            <button type="button" className="btn primary small" onClick={() => trader.accept()}>
              {sug.kind === 'pick' ? 'Ver en el gráfico' : sug.kind === 'entry' ? 'Hacer este trade' : 'Hacerlo'}
            </button>
            <button type="button" className="btn small" onClick={() => trader.dismiss()}>
              Ignorar
            </button>
            {sug.kind !== 'pick' && sug.sym !== selected && (
              <button type="button" className="link" onClick={() => onSelect(sug.sym)}>
                Ver {sug.sym}
              </button>
            )}
          </div>
        </div>
      )}

      {st.advice && (
        <div className="ai-card ai-advice">
          <b>Claude</b> <span className={`badge ai-dec-${st.advice.decision}`}>{st.advice.decision}</span> {st.advice.sym && <span className="mono">{st.advice.sym}</span>}{' '}
          <span className="t-muted small">{formatEtTime(st.advice.ts, false)}</span>
          <div>{st.advice.text}</div>
        </div>
      )}
      {s.mode !== 'off' && st.ai !== 'no' && st.ai !== '?' && (
        <div className="ai-row">
          <button type="button" className="btn small" onClick={() => void trader.askNow()} disabled={st.thinking}>
            Preguntarle a Claude ahora
          </button>
        </div>
      )}

      {s.mode !== 'off' && (
        <div className="ai-card">
          <div className="ai-sub">Candidatas (las reglas)</div>
          {st.candidates.length === 0 && <div className="t-muted small">Nada que valga la pena ahora: faltan gappers con volumen, noticia y float chico.</div>}
          {st.candidates.slice(0, 5).map((c) => (
            <div key={c.sym} className={`ai-cand ${c.sym === st.focus ? 'is-focus' : ''}`}>
              <button type="button" className="link mono" onClick={() => onSelect(c.sym)}>
                {c.sym}
              </button>
              <span className="ai-score" title="Qué tanto se parece a la obvia del día">
                <i style={{ width: `${c.score}%` }} />
              </span>
              <span className="small">{c.reasons.join(' · ')}</span>
              {c.warnings.length > 0 && <span className="t-muted small"> · {c.warnings.join(', ')}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="ai-card ai-profile">
        <div className="ai-sub">Perfil del automático</div>
        <div className="seg" role="group" aria-label="Perfil del IA Trader">
          {(['conservador', 'equilibrado', 'agresivo'] as const).map((p) => (
            <button key={p} className={s.profile === p ? 'is-active' : ''} onClick={() => trader.update({ profile: p })} title={PROFILE_HINT[p]}>
              {PROFILE_LABEL[p]}
            </button>
          ))}
          {s.profile === 'personalizado' && (
            <button className="is-active" disabled>
              {PROFILE_LABEL.personalizado}
            </button>
          )}
        </div>
        <p className="t-muted small ai-note">{PROFILE_HINT[s.profile]}</p>
      </div>

      <details className="ai-card ai-rules">
        <summary>Reglas{s.profile === 'personalizado' ? ' (personalizadas)' : ''}</summary>
        <div className="ai-rules-grid">
          <label>
            Entradas desde
            <input type="time" value={hhmm(s.rules.entryFrom)} onChange={(e) => trader.update({ rules: { ...s.rules, entryFrom: toMin(e.target.value) } })} />
          </label>
          <label>
            hasta
            <input type="time" value={hhmm(s.rules.entryTo)} onChange={(e) => trader.update({ rules: { ...s.rules, entryTo: toMin(e.target.value) } })} />
          </label>
          <label>
            Trades por día
            <input type="number" min={1} max={30} value={s.rules.maxTrades} onChange={(e) => trader.update({ rules: { ...s.rules, maxTrades: Math.max(1, Number(e.target.value) || 1) } })} />
          </label>
          <label>
            Perdedores seguidos
            <input type="number" min={1} max={10} value={s.rules.maxLosers} onChange={(e) => trader.update({ rules: { ...s.rules, maxLosers: Math.max(1, Number(e.target.value) || 1) } })} />
          </label>
          <label>
            Pérdida máxima (R)
            <input type="number" min={1} max={10} step={0.5} value={s.rules.maxLossR} onChange={(e) => trader.update({ rules: { ...s.rules, maxLossR: Math.max(0.5, Number(e.target.value) || 1) } })} />
          </label>
          <label title="Puntaje mínimo (0-100) para mirar de cerca una candidata; para sugerirla hacen falta 10 más.">
            Candidata mínima
            <input type="number" min={0} max={100} value={s.rules.minScore} onChange={(e) => trader.update({ rules: { ...s.rules, minScore: Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))) } })} />
          </label>
          <label title="Multiplica el riesgo por trade de la cuenta (1 = el de Preferencias de práctica).">
            Riesgo ×
            <input type="number" min={0.25} max={3} step={0.25} value={s.rules.riskMult} onChange={(e) => trader.update({ rules: { ...s.rules, riskMult: Math.min(3, Math.max(0.25, Number(e.target.value) || 1)) } })} />
          </label>
          <label title="Objetivo del plan en múltiplos del riesgo (2 = 2:1).">
            Objetivo (R)
            <input type="number" min={1} max={5} step={0.5} value={s.rules.targetR} onChange={(e) => trader.update({ rules: { ...s.rules, targetR: Math.min(5, Math.max(1, Number(e.target.value) || 2)) } })} />
          </label>
          <label title="Si Claude propone otro stop u objetivo, el objetivo tiene que pagar al menos tantas veces el riesgo.">
            Mínimo que pague (R)
            <input type="number" min={1} max={3} step={0.1} value={s.rules.minRewardR} onChange={(e) => trader.update({ rules: { ...s.rules, minRewardR: Math.min(3, Math.max(1, Number(e.target.value) || 1.5)) } })} />
          </label>
          <label title="Minutos sin avanzar antes de salir sin esperar el stop.">
            Sin avanzar (min)
            <input type="number" min={2} max={20} value={s.rules.timeStopMin} onChange={(e) => trader.update({ rules: { ...s.rules, timeStopMin: Math.min(20, Math.max(2, Math.round(Number(e.target.value) || 6))) } })} />
          </label>
          <label title="Cuántas posiciones puede manejar a la vez (mientras administra una, sigue buscando otra).">
            Posiciones a la vez
            <input type="number" min={1} max={5} value={s.rules.maxPositions} onChange={(e) => trader.update({ rules: { ...s.rules, maxPositions: Math.min(5, Math.max(1, Math.round(Number(e.target.value) || 1))) } })} />
          </label>
          <label title="Riesgo abierto total (entrada − stop actual de todas las posiciones) en múltiplos del riesgo por trade.">
            Riesgo abierto (R)
            <input type="number" min={0.5} max={6} step={0.5} value={s.rules.maxOpenRiskR} onChange={(e) => trader.update({ rules: { ...s.rules, maxOpenRiskR: Math.min(6, Math.max(0.5, Number(e.target.value) || 1)) } })} />
          </label>
          <label title="Tope diario de consultas a Claude (0 = sin tope). Hoy van las que muestra el contador.">
            Consultas por día
            <input type="number" min={0} max={2000} value={s.maxCalls} onChange={(e) => trader.update({ maxCalls: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
          </label>
        </div>
        <label className="check-inline">
          <input type="checkbox" checked={s.consult} onChange={(e) => trader.update({ consult: e.target.checked })} /> Consultar a Claude antes de cada entrada (en Conservador, sin su visto bueno no entra; en los otros perfiles las reglas mandan)
        </label>
        <label className="check-inline">
          <input type="checkbox" checked={s.follow} onChange={(e) => trader.update({ follow: e.target.checked })} /> Mostrar en el gráfico lo que mira la IA (en automático)
        </label>
        <p className="t-muted small">
          Horario de Nueva York. Entra solo con un setup limpio (bull flag, micro pullback de 1 min o de 10 s, primera vela de 1 min que hace un máximo nuevo tras el retroceso, ruptura con volumen; siempre sobre VWAP y EMA 9), stop ajustado y el objetivo del perfil; vende la mitad en el
          objetivo, sube el stop a la entrada y deja correr el resto mientras respete la EMA 9 y el mínimo del último pullback de 10 s (desde 1R el stop sigue ese mínimo; a 2R una mecha de rechazo de 10 s toma ganancia). Con la mitad tomada agrega una vez si aparece otro setup. Maneja varias posiciones a la vez según el perfil, sin pasar el riesgo abierto ni abrir otra mientras una pierde más de 0,5R. Tras un stop, si la acción recupera el VWAP y arma otro setup, le da hasta dos segundas chances (el conservador no). Una acción con dos frenos o dos perdedores hoy baja en el ranking; un setup con dos perdedores sin ganar se evita el resto del día. Las salidas van por reglas; Claude opina en las entradas y resume el día al cierre.
        </p>
      </details>

      {st.log.length > 0 && (
        <div className="ai-card ai-log">
          {st.log
            .slice(-10)
            .reverse()
            .map((l) => (
              <div key={l.id} className={`ai-log-row tone-${l.tone}`}>
                <span className="mono t-muted">{formatEtTime(l.ts, false)}</span> {l.text}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
