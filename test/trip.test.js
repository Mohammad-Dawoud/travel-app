const { calendarOffset, validateTrip } = require('../src/shared/trip');
const { processForm } = require('../src/client/js/formHandler');
const today = '2026-01-30';
const input = {
  destination: 'Paris',
  departureDate: today,
  returnDate: '2026-02-02',
};

test('calculates UTC date boundaries and elapsed duration, including same-day trips', () => {
  expect(validateTrip(input, today)).toMatchObject({
    countdownDays: 0,
    durationDays: 3,
  });
  expect(validateTrip({ ...input, returnDate: today }, today)).toMatchObject({
    durationDays: 0,
  });
  expect(
    validateTrip({ ...input, returnDate: calendarOffset(today, 365) }, today),
  ).toMatchObject({ durationDays: 365 });
  expect(
    validateTrip({ ...input, returnDate: calendarOffset(today, 366) }, today),
  ).toBeNull();
});

test.each([
  { departureDate: '2026-01-29' },
  { returnDate: '2026-01-29' },
  { departureDate: '2026-02-30' },
  { departureDate: '2026-2-02' },
  { destination: 'A' },
  { destination: 'A'.repeat(81) },
  { destination: '東京\n東京' },
  { destination: '12345' },
  { extra: true },
])('rejects invalid dates or input fields (%o)', (patch) => {
  expect(validateTrip({ ...input, ...patch }, today)).toBeNull();
});

test('normalizes Unicode and accepts the inclusive character bounds', () => {
  expect(
    validateTrip({ ...input, destination: '  Sa\u0303o   Paulo ' }, today)
      .destination,
  ).toBe('São Paulo');
  expect(
    validateTrip({ ...input, destination: '東京' }, today).destination,
  ).toBe('東京');
  expect(
    validateTrip({ ...input, destination: 'Á'.repeat(80) }, today),
  ).not.toBeNull();
});

test('client validates before issuing a relative JSON request', async () => {
  const request = jest.fn(async () => Response.json({ synthetic: true }));
  const options = { request, now: new Date(today + 'T00:00:00Z') };
  await expect(
    processForm({ ...input, returnDate: '2026-01-29' }, options),
  ).resolves.toEqual({ error: 'invalid_trip' });
  expect(request).not.toHaveBeenCalled();
  await expect(processForm(input, options)).resolves.toEqual({
    synthetic: true,
  });
  expect(request).toHaveBeenCalledWith('/all-apis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
});
