import { describe, expect, it } from 'vitest';
import { tenderFor, typedAmount } from './tender';

const none = { cashPart: '', given: '' };

describe('typedAmount', () => {
  it('tells nothing typed from an amount that cannot be read', () => {
    expect(typedAmount('  ')).toBeUndefined();
    expect(typedAmount('200,50')).toBe(20050);
    expect(typedAmount('200..')).toBeNull();
  });
});

describe('tenderFor', () => {
  it('pays all in cash, with change from what was given', () => {
    expect(tenderFor('cash', 49000, { ...none, given: '500' })).toEqual({
      payments: [{ method: 'cash', amount: 49000 }],
      cashGiven: 50000,
    });
    expect(tenderFor('cash', 49000, none)).toEqual({
      payments: [{ method: 'cash', amount: 49000 }],
    });
    expect(tenderFor('cash', 49000, { ...none, given: '400' })).toEqual({
      error: 'Alınan para tutardan az.',
    });
  });

  it('pays all by card, whatever was left in the cash field', () => {
    expect(tenderFor('card', 49000, { cashPart: 'x', given: 'y' })).toEqual({
      payments: [{ method: 'card', amount: 49000 }],
    });
  });

  it('takes part in cash and the rest by card', () => {
    expect(tenderFor('mixed', 49000, { cashPart: '200', given: '250' })).toEqual({
      payments: [
        { method: 'cash', amount: 20000 },
        { method: 'card', amount: 29000 },
      ],
      cashGiven: 25000,
    });
    expect(tenderFor('mixed', 49000, { cashPart: '200', given: '150' })).toEqual({
      error: 'Alınan para nakit kısmından az.',
    });
  });

  it('asks for a cash part between nothing and the whole bill', () => {
    for (const cashPart of ['', '0', '490', '600']) {
      expect(tenderFor('mixed', 49000, { cashPart, given: '' })).toHaveProperty('error');
    }
  });

  it('refuses an amount given that cannot be read, rather than taking it as none', () => {
    expect(tenderFor('cash', 49000, { ...none, given: '500..' })).toEqual({
      error: 'Alınan tutarı rakamla girin.',
    });
  });

  it('writes all of it on credit (veresiye), whatever was typed for cash', () => {
    expect(tenderFor('credit', 49000, { cashPart: '200', given: 'x' })).toEqual({
      payments: [{ method: 'credit', amount: 49000 }],
    });
    expect(tenderFor('credit', 0, none)).toEqual({ payments: [] });
  });

  it('takes no payment for a bill of nothing (treats only)', () => {
    expect(tenderFor('cash', 0, none)).toEqual({ payments: [] });
  });
});
