// Las indicaciones del trader para la IA: el intérprete simple (los 7 tipos con variantes de redacción,
// coma decimal, símbolo al principio o al final, lo que no se entiende es una nota), la ficha, el
// bloque para los prompts, la lectura del JSON de Claude y cómo acotan las reglas del perfil.
import { describe, expect, it } from 'vitest';
import { applyInstructions, avoidedSyms, instructionLabel, instructionsToPrompt, levelFor, parseInstruction, sanitizeRule, setupFilter, symbolsIn, watchedSyms, type Instruction } from '../src/trading/instructions';
import { instructionPrompt, parseInstructionRule } from '../src/trading/advisor';
import { DEFAULT_RULES, PROFILES } from '../src/trading/playbook';

const ins = (text: string, extra: Partial<Instruction> = {}): Instruction => ({ id: text, text, createdAt: 0, permanent: false, rule: parseInstruction(text), ...extra });

describe('parseInstruction', () => {
  it('nivel de compra: "supera", "rompe", "pasa", "arriba de", con coma o punto, símbolo al principio o al final', () => {
    expect(parseInstruction('si XYZ supera 4,50 me interesa comprar')).toEqual({ kind: 'level', sym: 'XYZ', price: 4.5, side: 'above' });
    expect(parseInstruction('me interesa comprar XYZ si rompe los 4.50')).toEqual({ kind: 'level', sym: 'XYZ', price: 4.5, side: 'above' });
    expect(parseInstruction('comprá ABC si pasa $2,10')).toEqual({ kind: 'level', sym: 'ABC', price: 2.1, side: 'above' });
    expect(parseInstruction('arriba de 0,85 me gusta DEF')).toEqual({ kind: 'level', sym: 'DEF', price: 0.85, side: 'above' });
    expect(parseInstruction('$F por encima de 12 es compra')).toEqual({ kind: 'level', sym: 'F', price: 12, side: 'above' });
  });

  it('evitar una acción: "no operes", "evitá", "nada de", "ni la mires"', () => {
    expect(parseInstruction('no operes ABC hoy')).toEqual({ kind: 'avoid', sym: 'ABC' });
    expect(parseInstruction('evitá ZZZZ')).toEqual({ kind: 'avoid', sym: 'ZZZZ' });
    expect(parseInstruction('nada de GHI por hoy')).toEqual({ kind: 'avoid', sym: 'GHI' });
    expect(parseInstruction('a JKL ni la mires')).toEqual({ kind: 'avoid', sym: 'JKL' });
    expect(parseInstruction('NO OPERES MNO HOY')).toEqual({ kind: 'avoid', sym: 'MNO' });
  });

  it('seguir una acción: "mirá", "seguí", "agregá", o el símbolo solo', () => {
    expect(parseInstruction('mirá DEF aunque no esté en el escáner')).toEqual({ kind: 'watch', sym: 'DEF' });
    expect(parseInstruction('seguí de cerca a PQR')).toEqual({ kind: 'watch', sym: 'PQR' });
    expect(parseInstruction('agregá STU a las candidatas')).toEqual({ kind: 'watch', sym: 'STU' });
    expect(parseInstruction('VWX')).toEqual({ kind: 'watch', sym: 'VWX' });
  });

  it('setups: "solo" y "nada de" con los nombres en castellano', () => {
    expect(parseInstruction('hoy solo bull flags y rupturas del máximo')).toEqual({ kind: 'setups', only: ['bullFlag', 'hodBreak'] });
    expect(parseInstruction('solamente micro pullbacks y la primera vela')).toEqual({ kind: 'setups', only: ['microPullback', 'newHigh'] });
    expect(parseInstruction('únicamente la ruptura del máximo pre-market')).toEqual({ kind: 'setups', only: ['pmhBreak'] });
    expect(parseInstruction('nada de micro pullbacks hoy')).toEqual({ kind: 'noSetups', skip: ['microPullback'] });
    expect(parseInstruction('no entres en bull flags')).toEqual({ kind: 'noSetups', skip: ['bullFlag'] });
  });

  it('horario: "después de las HH no", "antes de las", "hasta las", "de HH:MM a HH:MM"', () => {
    expect(parseInstruction('después de las 11 no entres')).toEqual({ kind: 'window', to: 11 * 60 });
    expect(parseInstruction('no operes después de las 11:30')).toEqual({ kind: 'window', to: 11 * 60 + 30 });
    expect(parseInstruction('antes de las 9:45 no entres')).toEqual({ kind: 'window', from: 9 * 60 + 45 });
    expect(parseInstruction('entradas solo hasta las 10.30')).toEqual({ kind: 'window', to: 10 * 60 + 30 });
    expect(parseInstruction('solo a partir de las 10')).toEqual({ kind: 'window', from: 10 * 60 });
    expect(parseInstruction('operá de 9:30 a 10:30 nada más')).toEqual({ kind: 'window', from: 9 * 60 + 30, to: 10 * 60 + 30 });
    expect(parseInstruction('entre las 10 y las 11')).toEqual({ kind: 'window', from: 10 * 60, to: 11 * 60 });
  });

  it('tope de trades: "máximo N", "no más de N", "un solo trade"', () => {
    expect(parseInstruction('máximo 3 trades hoy')).toEqual({ kind: 'maxTrades', n: 3 });
    expect(parseInstruction('no más de 2 operaciones')).toEqual({ kind: 'maxTrades', n: 2 });
    expect(parseInstruction('un solo trade hoy')).toEqual({ kind: 'maxTrades', n: 1 });
    expect(parseInstruction('hasta cinco entradas como mucho')).toEqual({ kind: 'maxTrades', n: 5 });
  });

  it('lo que no entiende es una nota (y las siglas no son símbolos)', () => {
    expect(parseInstruction('hoy el mercado está raro, cuidado con las extensiones')).toEqual({ kind: 'note' });
    expect(parseInstruction('respetá el VWAP y la EMA 9')).toEqual({ kind: 'note' });
    expect(parseInstruction('')).toEqual({ kind: 'note' });
    expect(symbolsIn('A las 11 no entres en VWAP ni en $T ni en IA')).toEqual(['T']);
  });
});

describe('ficha y prompt', () => {
  it('la ficha dice cómo se entendió cada indicación', () => {
    expect(instructionLabel({ kind: 'level', sym: 'XYZ', price: 4.5, side: 'above' })).toBe('XYZ: comprar si supera 4,50');
    expect(instructionLabel({ kind: 'avoid', sym: 'ABC' })).toBe('ABC: no se opera');
    expect(instructionLabel({ kind: 'watch', sym: 'DEF' })).toMatch(/^DEF: se sigue/);
    expect(instructionLabel({ kind: 'setups', only: ['bullFlag', 'hodBreak'] })).toBe('Solo bull flag, ruptura del máximo');
    expect(instructionLabel({ kind: 'noSetups', skip: ['microPullback'] })).toBe('Sin micro pullback');
    expect(instructionLabel({ kind: 'window', to: 11 * 60 })).toBe('Entradas hasta las 11:00');
    expect(instructionLabel({ kind: 'window', from: 9 * 60 + 30, to: 10 * 60 + 30 })).toBe('Entradas de 9:30 a 10:30');
    expect(instructionLabel({ kind: 'maxTrades', n: 1 })).toBe('Máximo 1 trade hoy');
    expect(instructionLabel({ kind: 'note' })).toBe('Nota para Claude');
  });

  it('el bloque para Claude lleva el texto y la ficha de las activas (las cumplidas no)', () => {
    expect(instructionsToPrompt([])).toBe('');
    const block = instructionsToPrompt([ins('no operes ABC hoy'), ins('si XYZ supera 4,50 me interesa comprar', { done: true }), ins('ojo con las extensiones')]);
    expect(block).toMatch(/^Indicaciones del trader/);
    expect(block).toMatch(/- no operes ABC hoy \[ABC: no se opera\]/);
    expect(block).toMatch(/- ojo con las extensiones$/m);
    expect(block).not.toMatch(/XYZ/);
  });

  it('el prompt para interpretar una indicación lleva el texto y los formatos; la respuesta se lee y se valida', () => {
    expect(instructionPrompt('si XYZ supera 4,50 me interesa comprar')).toMatch(/"si XYZ supera 4,50 me interesa comprar"/);
    expect(parseInstructionRule('{"kind":"level","sym":"xyz","price":4.5}')).toEqual({ kind: 'level', sym: 'XYZ', price: 4.5, side: 'above' });
    expect(parseInstructionRule('Acá va: {"rule":{"kind":"window","to":"11:00"}}')).toEqual({ kind: 'window', to: 660 });
    expect(parseInstructionRule('{"kind":"setups","only":["bullFlag","loQueSea"]}')).toEqual({ kind: 'setups', only: ['bullFlag'] });
    expect(parseInstructionRule('{"kind":"maxTrades","n":"3"}')).toEqual({ kind: 'maxTrades', n: 3 });
    expect(parseInstructionRule('{"decision":"enter","reason":"dale"}')).toBeNull();
    expect(parseInstructionRule('no es json')).toBeNull();
    expect(sanitizeRule({ kind: 'level', sym: 'XYZ', price: -1 })).toBeNull();
    expect(sanitizeRule({ kind: 'window' })).toBeNull();
  });
});

describe('aplicación sobre las reglas', () => {
  it('horario: intersección con el perfil; tope de trades: el menor', () => {
    const r = applyInstructions(PROFILES.equilibrado, [ins('después de las 11 no entres'), ins('máximo 3 trades hoy')]);
    expect(r).toMatchObject({ entryFrom: 7 * 60, entryTo: 11 * 60, maxTrades: 3 });
    // Un horario más ancho que el del perfil no lo agranda; un tope más alto no lo sube.
    expect(applyInstructions(PROFILES.conservador, [ins('de 9 a 12'), ins('máximo 9 trades')])).toEqual(PROFILES.conservador);
    expect(applyInstructions(DEFAULT_RULES, [])).toBe(DEFAULT_RULES);
  });

  it('acciones evitadas y seguidas; el nivel pendiente más bajo; los setups que quedan afuera', () => {
    const list = [ins('no operes ABC hoy'), ins('mirá DEF'), ins('si XYZ supera 4,50 me interesa comprar'), ins('si XYZ rompe 4,20 comprá', { done: true }), ins('mirá ABC')];
    expect([...avoidedSyms(list)]).toEqual(['ABC']);
    expect([...watchedSyms(list)].sort()).toEqual(['DEF', 'XYZ']);
    expect(levelFor(list, 'XYZ')?.rule).toMatchObject({ price: 4.5 });
    expect(levelFor(list, 'DEF')).toBeUndefined();
    expect([...setupFilter([ins('hoy solo bull flags')])].sort()).toEqual(['hodBreak', 'microPullback', 'newHigh', 'pmhBreak']);
    expect([...setupFilter([ins('nada de micro pullbacks')])]).toEqual(['microPullback']);
    expect(setupFilter([]).size).toBe(0);
  });
});
