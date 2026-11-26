import { calendarDay, calendarOffset, validateTrip } from '../../shared/trip';
import { safeImagePath } from '../../shared/images';

const messages = {
  invalid_trip:
    'Enter a destination and dates in order within the next 365 days.',
  destination_not_found:
    'That destination is outside the demo catalog. Try Paris, Tokyo or Cairo.',
  location_timeout: 'The demo location lookup timed out. Try again.',
  location_unavailable: 'The demo location lookup is unavailable. Try again.',
  trip_capacity: 'The demo is busy. Try again shortly.',
};
const warningMessages = {
  weather_unavailable: 'Demo weather is unavailable for this date.',
  image_unavailable: 'Showing a local fallback illustration.',
};

export async function processForm(
  input,
  { request = fetch, now = new Date() } = {},
) {
  if (!validateTrip(input, calendarDay(now))) return { error: 'invalid_trip' };
  const response = await request('/all-apis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return response.json();
}

function renderTrip(document, trip) {
  const text = (id, value) => {
    document.getElementById(id).textContent = value;
  };
  text('destination-name', trip.location.name + ', ' + trip.location.country);
  text('depart-date', trip.departureDate);
  text('return-date', trip.returnDate);
  text(
    'countdown',
    trip.countdownDays === 0 ? 'Today' : trip.countdownDays + ' days',
  );
  text(
    'duration',
    trip.durationDays + (trip.durationDays === 1 ? ' day' : ' days'),
  );
  const weather = trip.weather;
  const label =
    weather?.kind === 'near-term'
      ? 'Synthetic near-term snapshot'
      : 'Synthetic departure forecast';
  text(
    'weather',
    weather
      ? label +
          ' (' +
          weather.date +
          '): ' +
          weather.temperatureC +
          ' °C, ' +
          weather.description
      : 'No synthetic weather available.',
  );
  const warning = trip.warnings
    .map((code) =>
      Object.hasOwn(warningMessages, code) ? warningMessages[code] : '',
    )
    .filter(Boolean);
  text('warnings', warning.join(' '));
  document.getElementById('trip-image').src = safeImagePath(trip.image);
}

export function initializeForm(document) {
  const form = document.getElementById('trip-form');
  const submit = document.getElementById('plan-trip');
  const result = document.getElementById('trip-info');
  const error = document.getElementById('trip-error');
  const status = document.getElementById('trip-status');
  const heading = document.getElementById('destination-name');
  const fields = form.elements;
  const departure = fields.namedItem('departureDate');
  const returning = fields.namedItem('returnDate');

  function updateDateLimits() {
    const today = calendarDay(new Date());
    const latest = calendarOffset(today, 365);
    departure.min = today;
    departure.max = latest;
    returning.min = departure.value || today;
    returning.max = latest;
  }

  updateDateLimits();
  departure.addEventListener('change', updateDateLimits);
  document.getElementById('close-trip').addEventListener('click', () => {
    result.hidden = true;
    submit.focus();
  });
  document
    .getElementById('print-trip')
    .addEventListener('click', () => window.print());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    result.hidden = true;
    error.textContent = '';
    status.textContent = 'Looking up demo trip…';
    submit.disabled = true;
    try {
      const trip = await processForm({
        destination: fields.namedItem('destination').value,
        departureDate: departure.value,
        returnDate: returning.value,
      });
      if (trip.error) {
        error.textContent = Object.hasOwn(messages, trip.error)
          ? messages[trip.error]
          : 'The demo lookup is unavailable.';
        return;
      }
      renderTrip(document, trip);
      result.hidden = false;
      heading.focus();
    } catch {
      error.textContent = navigator.onLine
        ? 'The demo lookup is unavailable. Try again.'
        : 'Offline. Reconnect to look up a trip.';
    } finally {
      status.textContent = '';
      submit.disabled = false;
    }
  });
}
