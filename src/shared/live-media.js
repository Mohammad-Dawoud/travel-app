const localPhotoPattern = /^\/trip-photo\/[a-f0-9]{32}$/;

function pixabaySource(value) {
  if (typeof value !== 'string' || value.length > 300) return null;
  try {
    const url = new URL(value);
    if (
      url.origin !== 'https://pixabay.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return /^\/(?:[a-z]{2}\/)?(?:photos\/)?[a-z0-9-]+-\d+\/$/i.test(
      url.pathname,
    )
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function commonsSource(value) {
  if (typeof value !== 'string' || value.length > 400) return null;
  try {
    const url = new URL(value);
    if (
      url.origin !== 'https://commons.wikimedia.org' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    const file = decodeURIComponent(url.pathname);
    return /^\/wiki\/File:[^/\\:?#<>\p{Cc}\p{Cf}]+\.jpe?g$/iu.test(file)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function commonsLicense(label, value, copyrighted) {
  if (
    typeof label !== 'string' ||
    typeof value !== 'string' ||
    value.length > 160
  )
    return null;
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.hostname !== 'creativecommons.org' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    const parts = url.pathname.match(
      /^\/(licenses|publicdomain)\/(by-sa|by|zero|mark)\/(1\.0|2\.0|2\.5|3\.0|4\.0)(?:\/deed\.[a-z-]+)?\/?$/i,
    );
    if (!parts) return null;
    const [, category, type, version] = parts;
    let license;
    if (category === 'licenses' && ['by', 'by-sa'].includes(type))
      license = 'CC ' + type.toUpperCase() + ' ' + version;
    else if (
      category === 'publicdomain' &&
      type === 'zero' &&
      version === '1.0'
    )
      license = 'CC0';
    else if (
      category === 'publicdomain' &&
      type === 'mark' &&
      version === '1.0' &&
      String(copyrighted).toLowerCase() === 'false'
    )
      license = 'Public domain';
    if (!license || label.trim().toLowerCase() !== license.toLowerCase())
      return null;
    return {
      license,
      licenseUrl:
        'https://creativecommons.org/' +
        category +
        '/' +
        type +
        '/' +
        version +
        '/',
    };
  } catch {
    return null;
  }
}

function photoSource(photo) {
  return photo?.provider === 'wikimedia'
    ? commonsSource(photo.source)
    : pixabaySource(photo?.source);
}

module.exports = {
  localPhotoPattern,
  pixabaySource,
  photoSource,
  commonsSource,
  commonsLicense,
};
