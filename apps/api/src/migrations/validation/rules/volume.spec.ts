import { classifyVolume, recommendStrategy, assessVolume } from './volume';

describe('classifyVolume', () => {
  it('small', () => expect(classifyVolume(100, 1000)).toBe('SMALL'));
  it('medium by rows', () => expect(classifyVolume(200_000, 0)).toBe('MEDIUM'));
  it('large by rows', () => expect(classifyVolume(2_000_000, 0)).toBe('LARGE'));
  it('very large by rows', () => expect(classifyVolume(20_000_000, 0)).toBe('VERY_LARGE'));
  it('large by bytes', () => expect(classifyVolume(10, 2 * 1024 ** 3)).toBe('LARGE'));
});

describe('recommendStrategy', () => {
  it('maps classes to strategies', () => {
    expect(recommendStrategy('SMALL')).toBe('SINGLE_TRANSACTION');
    expect(recommendStrategy('MEDIUM')).toBe('BATCH');
    expect(recommendStrategy('LARGE')).toBe('CHUNKED');
    expect(recommendStrategy('VERY_LARGE')).toBe('PARALLEL');
  });
});

describe('assessVolume', () => {
  it('estimates duration from rows', () => {
    const a = assessVolume(50_000, 1024);
    expect(a.classification).toBe('SMALL');
    expect(a.estimatedDurationSeconds).toBe(10); // 50000 / 5000
  });
  it('never returns 0 duration', () => {
    expect(assessVolume(0, 0).estimatedDurationSeconds).toBe(1);
  });
});
