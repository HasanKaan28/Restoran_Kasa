import { describe, expect, it } from 'vitest';
import { activationCodeOf, typedActivationCode } from './activationCode';

describe('typedActivationCode', () => {
  it('groups what is typed in fours, in capitals', () => {
    expect(typedActivationCode('')).toBe('');
    expect(typedActivationCode('abcd')).toBe('ABCD');
    expect(typedActivationCode('abcde')).toBe('ABCD-E');
    expect(typedActivationCode('ABCD efgh  jkmn')).toBe('ABCD-EFGH-JKMN');
  });

  it('drops the RK the code is written with, typed or pasted', () => {
    expect(typedActivationCode('RK-ABCD-EFGH-JKMN')).toBe('ABCD-EFGH-JKMN');
    expect(typedActivationCode('rk abcd efgh jkmn')).toBe('ABCD-EFGH-JKMN');
    expect(typedActivationCode('rkabcdefghjkmn')).toBe('ABCD-EFGH-JKMN');
    expect(typedActivationCode('RK-AB')).toBe('AB');
  });

  it('keeps a code that itself begins with RK when it is typed without the prefix', () => {
    expect(typedActivationCode('RKAB-CDEF-GHJK')).toBe('RKAB-CDEF-GHJK');
  });

  it('finds the code in a pasted message', () => {
    expect(
      typedActivationCode(
        'Restoran Kasa kurulum kodunuz: RK-ABCD-EFGH-JKMN  Uygulama: https://restorankasa.vercel.app/app/ → Restoran kur',
      ),
    ).toBe('ABCD-EFGH-JKMN');
    // A one-line field drops the message's line break: the next word runs into the code.
    expect(
      typedActivationCode(
        'Restoran Kasa kurulum kodunuz: RK-C32E-XP4D-TP7SUygulama: https://restorankasa.vercel.app/app/',
      ),
    ).toBe('C32E-XP4D-TP7S');
  });

  it('keeps at most twelve characters', () => {
    expect(typedActivationCode('ABCD-EFGH-JKMN-PQRS')).toBe('ABCD-EFGH-JKMN');
  });
});

describe('activationCodeOf', () => {
  it('is the full code once twelve characters are in, else nothing', () => {
    expect(activationCodeOf('ABCD-EFGH-JKMN')).toBe('RK-ABCD-EFGH-JKMN');
    expect(activationCodeOf('ABCD-EFGH-JKM')).toBeNull();
    expect(activationCodeOf('')).toBeNull();
  });
});
