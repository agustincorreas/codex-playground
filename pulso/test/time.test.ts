// Calendario NYSE por regla y curva de volumen esperado.
import { describe, expect, it } from 'vitest';
import { curveMinute, etParts, etWallToTs, expectedVolumeFraction, isTradingDay, nyseCalendar, regularCloseMinutes, sessionAt } from '../src/engine/time';

// Lo que estaba fijo a mano (verificado contra el calendario oficial) antes del cálculo por regla.
const FIXED_HOLIDAYS = [
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
];
const FIXED_EARLY = ['2025-07-03', '2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24', '2027-11-26'];

describe('calendario NYSE por regla', () => {
  it('los 30 feriados y 6 cierres anticipados de 2025-2027 salen de la regla; el duelo por Carter queda como excepción', () => {
    const holidays = [2025, 2026, 2027].flatMap((y) => [...nyseCalendar(y).holidays]).sort();
    expect(holidays).toEqual([...FIXED_HOLIDAYS].sort());
    const early = [2025, 2026, 2027].flatMap((y) => [...nyseCalendar(y).early]).sort();
    expect(early).toEqual([...FIXED_EARLY].sort());
    // 9/1/2025 (funeral de Estado de Jimmy Carter): cerrado aunque ninguna regla lo dé.
    expect(isTradingDay(etParts(etWallToTs(2025, 1, 9, 12 * 60)))).toBe(false);
    expect(nyseCalendar(2025).holidays.has('2025-01-09')).toBe(false);
    for (const d of FIXED_HOLIDAYS) {
      const [y, mo, day] = d.split('-').map(Number);
      expect(isTradingDay(etParts(etWallToTs(y, mo, day, 12 * 60)))).toBe(false);
    }
    for (const d of FIXED_EARLY) expect(regularCloseMinutes(d)).toBe(13 * 60);
    expect(regularCloseMinutes('2026-10-23')).toBe(16 * 60);
  });

  it('2028: el 1 de enero cae sábado y no se observa; el resto cae donde corresponde', () => {
    const { holidays, early } = nyseCalendar(2028);
    expect([...holidays].sort()).toEqual([
      '2028-01-17', // MLK
      '2028-02-21', // Presidentes
      '2028-04-14', // Viernes Santo (Pascua 16/4)
      '2028-05-29', // Memorial Day
      '2028-06-19', // Juneteenth (lunes)
      '2028-07-04', // Independencia (martes)
      '2028-09-04', // Labor Day
      '2028-11-23', // Acción de Gracias
      '2028-12-25', // Navidad (lunes)
    ]);
    expect(holidays.has('2027-12-31')).toBe(false);
    expect(isTradingDay(etParts(etWallToTs(2027, 12, 31, 12 * 60)))).toBe(true);
    // Cierres anticipados: 3 de julio (lunes, el 4 es martes) y el viernes después de Acción de Gracias; el 24/12 es domingo.
    expect([...early].sort()).toEqual(['2028-07-03', '2028-11-24']);
  });

  it('observancia: sábado → viernes, domingo → lunes', () => {
    // 4/7/2026 sábado → viernes 3; 4/7/2021 domingo → lunes 5; Navidad 2027 sábado → viernes 24.
    expect(nyseCalendar(2026).holidays.has('2026-07-03')).toBe(true);
    expect(nyseCalendar(2021).holidays.has('2021-07-05')).toBe(true);
    expect(nyseCalendar(2027).holidays.has('2027-12-24')).toBe(true);
    // Cuando el 24 es feriado no hay cierre anticipado, y el 3 de julio sábado tampoco.
    expect(nyseCalendar(2027).early.has('2027-12-24')).toBe(false);
    expect(nyseCalendar(2027).early.has('2027-07-03')).toBe(false);
    // Un año conocido más atrás: 2022 (Juneteenth observado el lunes 20).
    expect([...nyseCalendar(2022).holidays].sort()).toEqual([
      '2022-01-17', '2022-02-21', '2022-04-15', '2022-05-30', '2022-06-20', '2022-07-04', '2022-09-05', '2022-11-24', '2022-12-26',
    ]);
    expect([...nyseCalendar(2022).early].sort()).toEqual(['2022-11-25']);
  });

  it('la sesión de un día de cierre anticipado termina a las 13:00 y el after-hours a las 17:00', () => {
    expect(sessionAt(etWallToTs(2026, 11, 27, 12 * 60 + 59))).toBe('regular');
    expect(sessionAt(etWallToTs(2026, 11, 27, 13 * 60))).toBe('post');
    expect(sessionAt(etWallToTs(2026, 11, 27, 17 * 60))).toBe('closed');
    expect(sessionAt(etWallToTs(2028, 1, 17, 12 * 60))).toBe('closed');
  });
});

describe('curva de volumen esperado', () => {
  it('valores fijos: 9:30 ≈ 0,03, 10:00 ≈ 0,187, 16:00 ≈ 0,97, y el piso de 0,01 en la madrugada', () => {
    expect(expectedVolumeFraction(9 * 60 + 30)).toBeCloseTo(0.03, 6);
    expect(expectedVolumeFraction(10 * 60)).toBeCloseTo(0.187, 6);
    expect(expectedVolumeFraction(16 * 60)).toBeCloseTo(0.97, 6);
    expect(expectedVolumeFraction(9 * 60 + 45)).toBeCloseTo(0.12, 6);
    expect(expectedVolumeFraction(4 * 60)).toBe(0.01);
    expect(expectedVolumeFraction(2 * 60)).toBe(0.01);
    expect(expectedVolumeFraction(20 * 60)).toBe(1);
    expect(expectedVolumeFraction(23 * 60)).toBe(1);
    // Interpolación lineal entre puntos: a las 9:37:30 está a mitad de camino entre 0,03 y 0,12.
    expect(expectedVolumeFraction(9 * 60 + 37.5)).toBeCloseTo(0.075, 6);
    // Crece de forma monótona.
    let prev = 0;
    for (let m = 4 * 60; m <= 20 * 60; m++) {
      const f = expectedVolumeFraction(m);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });

  it('en una media rueda la curva se estira: a las 13:00 ya se hizo el día entero, y el pre-market no cambia', () => {
    const half = '2026-11-27';
    expect(expectedVolumeFraction(9 * 60 + 30, half)).toBeCloseTo(0.03, 6);
    expect(expectedVolumeFraction(13 * 60, half)).toBeCloseTo(0.97, 6);
    // 11:15 en una media rueda equivale a la mitad de la rueda normal (12:45 ≈ 0,5325).
    expect(curveMinute(11 * 60 + 15, 13 * 60)).toBeCloseTo(12 * 60 + 45, 6);
    expect(expectedVolumeFraction(11 * 60 + 15, half)).toBeCloseTo(expectedVolumeFraction(12 * 60 + 45), 6);
    expect(expectedVolumeFraction(11 * 60 + 15, half)).toBeGreaterThan(expectedVolumeFraction(11 * 60 + 15));
    expect(expectedVolumeFraction(8 * 60, half)).toBe(expectedVolumeFraction(8 * 60));
    // Un día normal con fecha: idéntico a sin fecha.
    expect(expectedVolumeFraction(11 * 60 + 15, '2026-10-23')).toBe(expectedVolumeFraction(11 * 60 + 15));
    // El after-hours de la media rueda (13:00-17:00) recorre lo que queda hasta 1.
    expect(expectedVolumeFraction(14 * 60, half)).toBeCloseTo(expectedVolumeFraction(17 * 60), 6);
  });
});
