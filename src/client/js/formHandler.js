import { calendarDay, calendarOffset, validateTrip } from '../../shared/trip';
import {
  commonsLicense,
  localPhotoPattern,
  photoSource,
} from '../../shared/live-media';
import { fallbackImage, safeImagePath } from '../../shared/images';

const messages = {
  invalid_trip:
    'Enter a destination and dates in order within the next 365 days.',
  destination_not_found:
    'That destination is outside the demo catalog. Try Paris, Tokyo or Cairo.',
  destination_ambiguous:
    'Several places match. Enter City, Country or City, Region, Country.',
  location_authorization:
    'GeoNames rejected the account. Check that free web services are enabled.',
  location_rate_limited:
    'GeoNames quota reached. Try again when credits reset.',
  location_timeout: 'The location lookup timed out. Try again.',
  location_unavailable: 'The location lookup is unavailable. Try again.',
  trip_capacity: 'The demo is busy. Try again shortly.',
};
const warningMessages = {
  weather_unavailable: 'Demo weather is unavailable for this date.',
  weather_outside_window:
    'The departure date is outside the available Weatherbit forecast window.',
  weather_not_entitled:
    'Weatherbit did not authorize this request. Check the key and plan.',
  weather_rate_limited: 'Weatherbit is rate limited. Try again later.',
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
  const labels = {
    'near-term': 'Synthetic near-term snapshot',
    forecast: 'Synthetic departure forecast',
    current: 'Current conditions',
    'live-forecast': 'Departure forecast',
  };
  const label = Object.hasOwn(labels, weather?.kind)
    ? labels[weather.kind]
    : 'Weather';
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
      : trip.synthetic
        ? 'No synthetic weather available.'
        : 'No Weatherbit data available for this trip.',
  );
  const warning = trip.warnings
    .map((code) => {
      if (code === 'weather_unavailable' && !trip.synthetic)
        return 'Weatherbit weather is unavailable.';
      return Object.hasOwn(warningMessages, code) ? warningMessages[code] : '';
    })
    .filter(Boolean);
  text('warnings', warning.join(' '));
  const image = document.getElementById('trip-image');
  const credit = document.getElementById('photo-credit');
  const link = document.getElementById('photo-source');
  const source =
    !trip.synthetic && localPhotoPattern.test(trip.image)
      ? photoSource(trip.photo)
      : null;
  document.getElementById('provider-credit').hidden = trip.synthetic;
  credit.hidden = !source;
  const wikimedia = trip.photo?.provider === 'wikimedia';
  const license = wikimedia
    ? commonsLicense(
        trip.photo.license,
        trip.photo.licenseUrl,
        trip.photo.license === 'Public domain' ? 'false' : undefined,
      )
    : null;
  const licenseLink = document.getElementById('photo-license');
  const statement = document.getElementById('photo-disclosure');
  credit.hidden = !source || (wikimedia && !license);
  licenseLink.hidden = !license;
  statement.textContent = '';
  if (source && (!wikimedia || license)) {
    link.href = source;
    link.textContent = wikimedia
      ? trip.photo.title + ' — ' + trip.photo.creator
      : 'Photo by ' + trip.photo.creator + ' on Pixabay';
    if (license) {
      licenseLink.href = license.licenseUrl;
      licenseLink.textContent = license.license;
      statement.textContent = [
        trip.photo.credit,
        'Wikimedia thumbnail. The app made no further edits.',
      ]
        .filter(Boolean)
        .join(' ');
    }
    image.alt = wikimedia
      ? 'Destination photo from Wikimedia Commons'
      : 'Destination photo from Pixabay';
    image.src = trip.image;
  } else {
    link.removeAttribute('href');
    image.alt = trip.synthetic
      ? 'Synthetic travel illustration'
      : 'Local fallback illustration';
    image.src = trip.synthetic ? safeImagePath(trip.image) : fallbackImage;
  }
}

export function initializeForm(document) {
  const form = document.getElementById('trip-form');
  const submit = document.getElementById('plan-trip');
  const result = document.getElementById('trip-info');
  const error = document.getElementById('trip-error');
  const status = document.getElementById('trip-status');
  const heading = document.getElementById('destination-name');
  const fields = form.elements;
  let mode;
  const modeNote = document.getElementById('mode-note');
  void fetch('/trip-mode', { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return;
      const config = await response.json();
      if (config.mode === 'live') {
        mode = 'live';
        modeNote.textContent =
          'Live lookup via GeoNames, Weatherbit and ' +
          (config.imageProvider === 'pixabay'
            ? 'Pixabay'
            : 'Wikimedia Commons') +
          '. For ambiguous places, include a country or region.';
      } else if (config.mode === 'mock') {
        mode = 'mock';
        modeNote.textContent =
          'Local demo with synthetic weather and images. Try Paris, Tokyo or Cairo.';
      }
    })
    .catch(() => {});
  const image = document.getElementById('trip-image');
  image.addEventListener('error', () => {
    if (localPhotoPattern.test(image.getAttribute('src'))) {
      document.getElementById('photo-credit').hidden = true;
      document
        .getElementById('warnings')
        .append(' Showing a local fallback illustration.');
      image.alt = 'Local fallback illustration';
      image.src = fallbackImage;
    }
  });
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
    status.textContent = 'Looking up trip…';
    submit.disabled = true;
    try {
      const trip = await processForm({
        destination: fields.namedItem('destination').value,
        departureDate: departure.value,
        returnDate: returning.value,
      });
      if (trip.error) {
        error.textContent =
          mode === 'live' && trip.error === 'destination_not_found'
            ? 'No matching city was found. Check the spelling or add the country.'
            : Object.hasOwn(messages, trip.error)
              ? messages[trip.error]
              : 'The trip lookup is unavailable.';
        return;
      }
      renderTrip(document, trip);
      result.hidden = false;
      heading.focus();
    } catch {
      error.textContent = navigator.onLine
        ? 'The trip lookup is unavailable. Try again.'
        : 'Offline. Reconnect to look up a trip.';
    } finally {
      status.textContent = '';
      submit.disabled = false;
    }
  });
}
