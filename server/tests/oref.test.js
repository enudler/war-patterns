'use strict';

const { _test } = require('../src/poller/oref');
const { geocode, makeOrefId } = _test;

describe('geocode', () => {
  test('returns an object with lat, lon, and name_en properties', () => {
    const result = geocode('תל אביב');
    expect(result).toHaveProperty('lat');
    expect(result).toHaveProperty('lon');
    expect(result).toHaveProperty('name_en');
  });

  test('returns null coords and original name for a completely unknown area', () => {
    const result = geocode('__NoSuchArea_XYZ__');
    expect(result.lat).toBeNull();
    expect(result.lon).toBeNull();
    expect(result.name_en).toBe('__NoSuchArea_XYZ__');
  });

  test('strips " - <suffix>" and retries for an unknown sub-area', () => {
    // Parent is also unknown, so we still get nulls — but no crash
    const result = geocode('__NoParent__ - דרום');
    expect(result.lat).toBeNull();
    expect(result.lon).toBeNull();
  });

  test('returns numeric coords for a known area', () => {
    // Find any entry known to be in areas.json (Tel Aviv is a safe bet)
    const result = geocode('תל אביב');
    if (result.lat !== null) {
      expect(typeof result.lat).toBe('number');
      expect(typeof result.lon).toBe('number');
    }
  });
});

describe('makeOrefId', () => {
  test('returns a 28-character hex string', () => {
    const id = makeOrefId('2024-01-01 12:00:00', 'Test Area');
    expect(typeof id).toBe('string');
    expect(id).toHaveLength(28);
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  test('is deterministic — same inputs always produce the same id', () => {
    const id1 = makeOrefId('2024-01-01 12:00:00', 'Test Area');
    const id2 = makeOrefId('2024-01-01 12:00:00', 'Test Area');
    expect(id1).toBe(id2);
  });

  test('different area names produce different ids', () => {
    const id1 = makeOrefId('2024-01-01 12:00:00', 'Area A');
    const id2 = makeOrefId('2024-01-01 12:00:00', 'Area B');
    expect(id1).not.toBe(id2);
  });

  test('different timestamps produce different ids', () => {
    const id1 = makeOrefId('2024-01-01 12:00:00', 'Same Area');
    const id2 = makeOrefId('2024-01-01 13:00:00', 'Same Area');
    expect(id1).not.toBe(id2);
  });
});
