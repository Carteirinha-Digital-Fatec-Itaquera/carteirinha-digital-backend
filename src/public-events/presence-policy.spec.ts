import { assertGeoPolicy, evaluatePosition } from './presence-policy';
import { validCpf } from './visitor.service';
describe('Public attendance policy', () => {
  const policy = {
    latitude: -23.5,
    longitude: -46.5,
    radius: 150,
    maxAccuracy: 50,
  };
  const point = {
    latitude: -23.5,
    longitude: -46.5,
    accuracy: 10,
    timestamp: 100000,
    challengeId: 'test',
  };
  it('accepts a recent precise position inside without retaining raw position', () => {
    expect(evaluatePosition(policy, point, 100001)).toEqual({
      decision: 'INSIDE',
      accuracyBand: 10,
    });
  });
  it.each([
    { ...point, latitude: 0 },
    { ...point, accuracy: 200 },
    { ...point, timestamp: 0 },
    { ...point, longitude: Infinity },
  ])('rejects outside, inconclusive and invalid evidence %#', (p) => {
    expect(() => evaluatePosition(policy, p, 100001)).toThrow();
  });
  it('rejects an invalid policy rather than silently disabling GPS', () => {
    expect(() => assertGeoPolicy({ ...policy, radius: -1 })).toThrow();
    expect(assertGeoPolicy(null)).toBeNull();
  });
  it('validates both CPF digits and rejects repeated digits', () => {
    expect(validCpf('52998224725')).toBe(true);
    expect(validCpf('52998224724')).toBe(false);
    expect(validCpf('11111111111')).toBe(false);
  });
});
