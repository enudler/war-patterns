'use strict';

const { _test } = require('../src/routes/alerts');
const { areaParams, timeClause, isDST } = _test;

describe('areaParams', () => {
  test('returns base name and LIKE pattern for a plain area', () => {
    expect(areaParams('אשקלון')).toEqual(['אשקלון', 'אשקלון - %']);
  });

  test('strips subdivision suffix for a sub-area', () => {
    expect(areaParams('אשקלון - דרום')).toEqual(['אשקלון', 'אשקלון - %']);
  });

  test('handles multi-word area names', () => {
    expect(areaParams('תל אביב')).toEqual(['תל אביב', 'תל אביב - %']);
  });
});

describe('timeClause', () => {
  test('today=1 produces a DATE_TRUNC clause with no params', () => {
    const tc = timeClause({ today: '1' }, 1);
    expect(tc.clause).toContain('DATE_TRUNC');
    expect(tc.params).toEqual([]);
    expect(tc.label).toBe('today');
  });

  test('days=7 produces an interval clause with days param', () => {
    const tc = timeClause({ days: '7' }, 1);
    expect(tc.clause).toContain('interval');
    expect(tc.params).toEqual([7]);
    expect(tc.label).toBe('7d');
  });

  test('clamps days above 14 to 14', () => {
    const tc = timeClause({ days: '99' }, 1);
    expect(tc.params).toEqual([14]);
    expect(tc.label).toBe('14d');
  });

  test('clamps days below 1 to 1', () => {
    const tc = timeClause({ days: '0' }, 1);
    expect(tc.params).toEqual([1]);
    expect(tc.label).toBe('1d');
  });

  test('defaults to 7 days when days param is absent', () => {
    const tc = timeClause({}, 1);
    expect(tc.params).toEqual([7]);
    expect(tc.label).toBe('7d');
  });

  test('uses custom paramBase index in the clause', () => {
    const tc = timeClause({ days: '3' }, 5);
    expect(tc.clause).toContain('$5');
    expect(tc.params).toEqual([3]);
  });
});

describe('isDST', () => {
  test('July is always DST', () => {
    expect(isDST(new Date('2024-07-15T12:00:00Z'))).toBe(true);
  });

  test('May is always DST', () => {
    expect(isDST(new Date('2024-05-01T12:00:00Z'))).toBe(true);
  });

  test('January is not DST', () => {
    expect(isDST(new Date('2024-01-15T12:00:00Z'))).toBe(false);
  });

  test('December is not DST', () => {
    expect(isDST(new Date('2024-12-15T12:00:00Z'))).toBe(false);
  });

  test('November is not DST', () => {
    expect(isDST(new Date('2024-11-01T12:00:00Z'))).toBe(false);
  });
});
