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

module.exports = { localPhotoPattern, pixabaySource };
