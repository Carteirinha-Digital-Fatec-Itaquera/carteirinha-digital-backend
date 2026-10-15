import { defaultEventVenue } from './event-venue.config';
describe('Local padrão de eventos', () => {
  it('preserva as coordenadas fornecidas e identifica os limites como provisórios', () => {
    const venue = defaultEventVenue({});
    expect(venue.policy).toEqual({
      latitude: -23.54503950757055,
      longitude: -46.46790057119243,
      radius: 150,
      maxAccuracy: 50,
    });
    expect(venue.address).toContain('Miguel Ignácio Curi, 360');
    expect(venue.calibrationRequired).toBe(true);
  });
  it('permite calibrar sem alterar o código e rejeita valores inválidos', () => {
    expect(
      defaultEventVenue({ EVENT_VENUE_RADIUS_METERS: '200' }).policy.radius,
    ).toBe(200);
    expect(() =>
      defaultEventVenue({ EVENT_VENUE_LATITUDE: 'inválida' }),
    ).toThrow();
  });
});
