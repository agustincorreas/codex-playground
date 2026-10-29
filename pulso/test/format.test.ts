import { describe, expect, it } from 'vitest';
import { fmtDuration, fmtInt, fmtMoney, fmtMoneyShort, fmtPrice, fmtSignedMoney, parseDecimal, parseMoney } from '../src/client/lib/format';

describe('formateadores (es-AR)', () => {
  it('montos con punto de miles y coma decimal', () => {
    expect(fmtMoney(1234.5)).toBe('$1.234,50');
    expect(fmtMoney(-12)).toBe('−$12,00');
    expect(fmtMoney(0)).toBe('$0,00');
    expect(fmtMoney(5000, 0)).toBe('$5.000');
    expect(fmtMoney(NaN)).toBe('—');
    expect(fmtSignedMoney(120.5)).toBe('+$120,50');
    expect(fmtSignedMoney(-8)).toBe('−$8,00');
  });

  it('montos abreviados para capitalización', () => {
    expect(fmtMoneyShort(1_250_000)).toBe('$1,3M');
    expect(fmtMoneyShort(2_500_000_000)).toBe('$2,5B');
    expect(fmtMoneyShort(850_000)).toBe('$850K');
    expect(fmtMoneyShort(42)).toBe('$42');
  });

  it('enteros con punto de miles', () => {
    expect(fmtInt(1000)).toBe('1.000');
    expect(fmtInt(250)).toBe('250');
    expect(fmtInt(1234567)).toBe('1.234.567');
  });

  it('precios con punto decimal (como el eje del gráfico y el ticket)', () => {
    expect(fmtPrice(12.345)).toBe('12.35');
    expect(fmtPrice(0.85123)).toBe('0.8512');
    expect(fmtPrice(NaN)).toBe('—');
  });

  it('duraciones', () => {
    expect(fmtDuration(45_000)).toBe('45s');
    expect(fmtDuration(185_000)).toBe('3m 05s');
    expect(fmtDuration(80 * 60_000)).toBe('1h 20m');
  });
});

describe('parseDecimal (ajustes numéricos)', () => {
  it('acepta coma y punto como decimal', () => {
    expect(parseDecimal('2,5')).toBe(2.5);
    expect(parseDecimal('2.5')).toBe(2.5);
    expect(parseDecimal('0,001')).toBe(0.001);
    expect(parseDecimal('0.001')).toBe(0.001);
    expect(parseDecimal('25')).toBe(25);
    expect(parseDecimal('0')).toBe(0);
  });
  it('con los dos separadores, el último es el decimal', () => {
    expect(parseDecimal('1.500,50')).toBe(1500.5);
    expect(parseDecimal('1,500.50')).toBe(1500.5);
  });
  it('vacío o ilegible no es un número', () => {
    expect(parseDecimal('')).toBeUndefined();
    expect(parseDecimal('   ')).toBeUndefined();
    expect(parseDecimal(',')).toBeUndefined();
    expect(parseDecimal('abc')).toBeUndefined();
  });
  it('mientras se escribe, "2," vale 2 y no se pierde el valor', () => {
    expect(parseDecimal('2,')).toBe(2);
  });
});

describe('parseMoney', () => {
  it('lee montos con miles y decimales en cualquier convención', () => {
    expect(parseMoney('5000')).toBe(5000);
    expect(parseMoney('5.000')).toBe(5000);
    expect(parseMoney('25,000')).toBe(25000);
    expect(parseMoney('1.500,50')).toBe(1500.5);
    expect(parseMoney('1,500.50')).toBe(1500.5);
    expect(parseMoney('$ 1.234,56')).toBe(1234.56);
  });
  it('rechaza vacío y cero', () => {
    expect(parseMoney('')).toBeUndefined();
    expect(parseMoney('0')).toBeUndefined();
  });
});
