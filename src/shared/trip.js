const day = 86_400_000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const destinationPattern = /^[\p{L}\p{M}\p{N} .,'’\p{Pd}]+$/u;

function calendarDay(date) {
  return date.toISOString().slice(0, 10);
}

function parseDay(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return null;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isNaN(parsed.getTime()) || calendarDay(parsed) !== value
    ? null
    : parsed.getTime() / day;
}

function calendarOffset(date, offset) {
  return calendarDay(new Date((parseDay(date) + offset) * day));
}

function validateTrip(input, today) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const { destination, departureDate, returnDate } = input;
  if (
    Object.keys(input).length !== 3 ||
    typeof destination !== 'string' ||
    typeof departureDate !== 'string' ||
    typeof returnDate !== 'string'
  )
    return null;
  const place = destination.normalize('NFC').trim().replace(/ +/g, ' ');
  const length = [...place].length;
  if (
    length < 2 ||
    length > 80 ||
    !destinationPattern.test(place) ||
    !/\p{L}/u.test(place)
  )
    return null;
  const start = parseDay(departureDate);
  const end = parseDay(returnDate);
  const now = parseDay(today);
  if (
    now === null ||
    start === null ||
    end === null ||
    start < now ||
    end < start ||
    end > now + 365
  )
    return null;

  return {
    destination: place,
    departureDate,
    returnDate,
    countdownDays: start - now,
    durationDays: end - start,
  };
}

module.exports = { calendarDay, calendarOffset, validateTrip };
