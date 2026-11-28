const { commonsSource, commonsLicense } = require('../shared/live-media');

const wikipedia = 'en.wikipedia.org';
const commons = 'commons.wikimedia.org';
const wikidata = 'www.wikidata.org';
const imageHosts = ['upload.wikimedia.org', 'thumb.wikimedia.org'];
const maxSide = 960;
const meta =
  'Artist|LicenseShortName|LicenseUrl|Attribution|AttributionRequired|Copyrighted|Restrictions|ImageDescription';

function fold(text) {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Metadata can contain formatting links. Extract text and allow no active markup.
function plain(value, max = 240) {
  if (typeof value !== 'string' || value.length > 5000) return '';
  const entities = {
    amp: '&',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    lt: '<',
    gt: '>',
  };
  const stripped = value
    .replace(/<\/?(?:a|span|div|p|i|b|strong|em|small|br)\b[^<>]*>/gi, ' ')
    .replace(
      /&(#x[0-9a-f]{1,6}|#\d{1,7}|amp|quot|apos|nbsp|lt|gt);/gi,
      (_, key) => {
        if (!key.startsWith('#')) return entities[key.toLowerCase()] ?? '';
        const number =
          key[1].toLowerCase() === 'x'
            ? Number.parseInt(key.slice(2), 16)
            : Number(key.slice(1));
        return number > 31 &&
          number <= 0x10ffff &&
          !(number >= 0xd800 && number <= 0xdfff)
          ? String.fromCodePoint(number)
          : '';
      },
    )
    .replace(/\s+/gu, ' ')
    .trim();
  return /[<>\p{Cc}\p{Cf}]/u.test(stripped) || [...stripped].length > max
    ? ''
    : stripped;
}

function assetUrl(value) {
  if (typeof value !== 'string' || value.length > 550) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !imageHosts.includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    )
      return null;
    if (
      [...url.searchParams.keys()].some(
        (key) => !['utm_source', 'utm_campaign', 'utm_content'].includes(key),
      )
    )
      return null;
    const match = url.pathname.match(
      /^\/wikipedia\/commons\/thumb\/([a-f0-9])\/([a-f0-9]{2})\/([^/]+)\/([1-9]\d{0,2})px-([^/]+)$/i,
    );
    if (!match || !match[2].startsWith(match[1]) || Number(match[4]) > maxSide)
      return null;
    const original = decodeURIComponent(match[3]);
    const rendition = decodeURIComponent(match[5]);
    if (
      original !== rendition ||
      !/\.jpe?g$/i.test(original) ||
      /[\\/:?#<>\p{Cc}\p{Cf}]/u.test(original)
    )
      return null;
    url.search = '';
    return url;
  } catch {
    return null;
  }
}

function geoMatches(point, location) {
  const { lat, lon, globe } = point ?? {};
  if (
    (globe && globe !== 'earth') ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 90 ||
    Math.abs(lon) > 180
  )
    return false;
  const radians = Math.PI / 180;
  const a =
    Math.sin(((lat - location.latitude) * radians) / 2) ** 2 +
    Math.cos(lat * radians) *
      Math.cos(location.latitude * radians) *
      Math.sin(((lon - location.longitude) * radians) / 2) ** 2;
  return a <= Math.sin(35 / (2 * 6371)) ** 2;
}

function articleCandidates(payload, location) {
  const pages = payload?.query?.pages;
  if (!Array.isArray(pages) || pages.length > 3) return [];
  const name = fold(location.name);
  const qualified = fold(location.name + ' ' + location.country);
  return pages.filter((page) => {
    const title = plain(page?.title);
    return (
      page?.ns === 0 &&
      !page.missing &&
      title &&
      !Object.hasOwn(page.pageprops ?? {}, 'disambiguation') &&
      [name, qualified].includes(fold(title))
    );
  });
}

function fileParams() {
  return {
    prop: 'imageinfo',
    iiprop: 'url|size|mime|mediatype|extmetadata',
    iiurlwidth: 640,
    iiextmetadatafilter: meta,
  };
}

const unsuitable =
  /\b(portrait|selfie|flag|coat of arms|logo|map|diagram|parquet|renovation|woman|spinner|shop owners|peasant family|collage|reconstruction)\b/iu;

function selectPhoto(page, location) {
  const title = plain(
    typeof page?.title === 'string' && page.title.startsWith('File:')
      ? page.title.slice(5)
      : '',
  );
  const info = page?.imageinfo?.[0];
  if (
    !title ||
    !/\.jpe?g$/i.test(title) ||
    page.ns !== 6 ||
    info?.mime !== 'image/jpeg' ||
    info.mediatype !== 'BITMAP' ||
    !Number.isInteger(info.thumbwidth) ||
    !Number.isInteger(info.thumbheight) ||
    info.thumbwidth < 240 ||
    info.thumbwidth > maxSide ||
    info.thumbheight < 120 ||
    info.thumbheight > info.thumbwidth
  )
    return null;
  const data = info.extmetadata;
  const raw = (key) => data?.[key]?.value;
  const description = plain(raw('ImageDescription'), 1200);
  if (unsuitable.test(title + ' ' + description)) return null;
  const place = fold(location.name);
  if (
    !place ||
    !(' ' + fold(title + ' ' + description) + ' ').includes(' ' + place + ' ')
  )
    return null;
  const restrictions = raw('Restrictions');
  if (restrictions && (typeof restrictions !== 'string' || restrictions.trim()))
    return null;
  const creator = plain(raw('Artist'), 160);
  const credit = plain(raw('Attribution'), 200);
  if (
    raw('Attribution') &&
    (!credit || /<a\b|https?:/i.test(raw('Attribution')))
  )
    return null;
  const license = commonsLicense(
    raw('LicenseShortName'),
    raw('LicenseUrl'),
    raw('Copyrighted'),
  );
  const source = commonsSource(info.descriptionurl);
  const asset = assetUrl(info.thumburl);
  if (!creator || !license || !source || !asset) return null;
  // Credits and thumbnail bytes must describe the same Commons file.
  const fileKey = (name) =>
    decodeURIComponent(name).normalize('NFC').replaceAll('_', ' ');
  try {
    if (
      fileKey(new URL(source).pathname).slice('/wiki/File:'.length) !==
        title.normalize('NFC') ||
      fileKey(asset.pathname.split('/').at(-2)) !== title.normalize('NFC')
    )
      return null;
  } catch {
    return null;
  }
  return {
    source,
    creator,
    title,
    credit,
    ...license,
    asset: asset.href,
    provider: 'wikimedia',
  };
}

function createWikimediaImageProvider(request) {
  const query = (host, parameters, signal) =>
    request(
      host,
      { format: 'json', formatversion: 2, maxlag: 5, ...parameters },
      signal,
    );
  return {
    name: 'wikimedia',
    imageHosts,
    assetUrl,
    maxSide,
    async select(location, signal) {
      if (
        ![location.name, location.country].every(
          (value) => plain(value, 80) && !/[|(){}":]/u.test(value),
        )
      )
        return null;
      const { name, country } = location;
      const article = await query(
        wikipedia,
        {
          action: 'query',
          redirects: 1,
          titles: [
            name,
            name + ', ' + country,
            name + ' (' + country + ')',
          ].join('|'),
          prop: 'pageimages|coordinates|pageprops',
          piprop: 'name',
          pilicense: 'free',
          ppprop: 'disambiguation|wikibase_item',
        },
        signal,
      );
      const candidates = articleCandidates(article, location);
      let valid = candidates.filter(
        (page) =>
          Array.isArray(page.coordinates) &&
          page.coordinates.length <= 10 &&
          page.coordinates.some((point) => geoMatches(point, location)),
      );
      if (
        !valid.length &&
        candidates.length === 1 &&
        !candidates[0].coordinates?.length
      ) {
        const item = candidates[0].pageprops?.wikibase_item;
        if (/^Q[1-9]\d{0,11}$/.test(item ?? '')) {
          const claims = await query(
            wikidata,
            { action: 'wbgetclaims', entity: item, property: 'P625' },
            signal,
          );
          const locations = claims?.claims?.P625;
          if (
            Array.isArray(locations) &&
            locations.length <= 5 &&
            locations.some((statement) => {
              const coordinates = statement?.mainsnak?.datavalue?.value;
              return (
                statement.rank !== 'deprecated' &&
                /\/Q2$/.test(coordinates?.globe ?? '') &&
                geoMatches(
                  { lat: coordinates.latitude, lon: coordinates.longitude },
                  location,
                )
              );
            })
          )
            valid = candidates;
        }
      }
      if (valid.length !== 1) return null;
      const image = valid[0].pageimage;
      if (
        plain(image, 220) &&
        /\.jpe?g$/i.test(image) &&
        !/[|:#]/.test(image)
      ) {
        const lead = await query(
          commons,
          {
            action: 'query',
            redirects: 1,
            titles: 'File:' + image,
            ...fileParams(),
          },
          signal,
        );
        const pages = lead?.query?.pages;
        const candidate =
          Array.isArray(pages) && pages.length === 1
            ? selectPhoto(pages[0], location)
            : null;
        if (candidate) return candidate;
      }
      const result = await query(
        commons,
        {
          action: 'query',
          generator: 'search',
          gsrnamespace: 6,
          gsrlimit: 8,
          gsrsearch: 'intitle:"' + name + '" filetype:bitmap',
          ...fileParams(),
        },
        signal,
      );
      const entries = result?.query?.pages;
      if (!Array.isArray(entries) || entries.length > 8) return null;
      return (
        entries
          .sort((a, b) => (a?.index ?? 9) - (b?.index ?? 9))
          .map((entry) => selectPhoto(entry, location))
          .find(Boolean) ?? null
      );
    },
    attribution: ({ source, creator, title, credit, license, licenseUrl }) => ({
      provider: 'wikimedia',
      source,
      creator,
      title,
      credit,
      license,
      licenseUrl,
    }),
  };
}

module.exports = {
  createWikimediaImageProvider,
  assetUrl,
  plain,
  geoMatches,
  selectPhoto,
};
