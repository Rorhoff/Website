/** @typedef {{ lon: number, lat: number }} LonLat */
/** @typedef {{ x: number, y: number, lon: number, lat: number, easting: number, northing: number }} ProjectedPoint */

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const M_PER_FT = 0.3048;

export function deg2rad(d) {
  return (d * Math.PI) / 180;
}

export function rad2deg(r) {
  return (r * 180) / Math.PI;
}

export function fmtNum(value, decimals = 4) {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(decimals);
}

export function detectUtmZone(lon) {
  return Math.floor((lon + 180) / 6) + 1;
}

export function wgs84ToUtm(lon, lat, zone = detectUtmZone(lon)) {
  const latRad = deg2rad(lat);
  const lonRad = deg2rad(lon);
  const lon0 = deg2rad(zone * 6 - 183);

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const tanLat = Math.tan(latRad);

  const n = A / Math.sqrt(1 - E2 * sinLat * sinLat);
  const t = tanLat * tanLat;
  const c = EP2 * cosLat * cosLat;
  const aVal = cosLat * (lonRad - lon0);

  const e2 = E2;
  const e4 = e2 * e2;
  const e6 = e4 * e2;

  const m =
    A *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latRad -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * latRad) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * latRad) -
      ((35 * e6) / 3072) * Math.sin(6 * latRad));

  const easting =
    K0 *
      n *
      (aVal +
        ((1 - t + c) * aVal ** 3) / 6 +
        ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * aVal ** 5) / 120) +
    500000;

  let northing =
    K0 *
    (m +
      n *
        tanLat *
        ((aVal * aVal) / 2 +
          ((5 - t + 9 * c + 4 * c * c) * aVal ** 4) / 24 +
          ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * aVal ** 6) / 720));

  if (lat < 0) northing += 10000000;

  return { easting, northing, zone };
}

export function metersToFeet(m) {
  return m / M_PER_FT;
}

export function feetToMeters(ft) {
  return ft * M_PER_FT;
}

export function sqMetersToSqFeet(sqM) {
  return sqM / (M_PER_FT * M_PER_FT);
}

export function sqFeetToAcres(sqFt) {
  return sqFt / 43560;
}

export function sqMetersToHectares(sqM) {
  return sqM / 10000;
}

export function parseGeoJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON. Expected a GeoJSON FeatureCollection.");
  }
  if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error("Expected a GeoJSON FeatureCollection with a features array.");
  }
  if (data.features.length === 0) {
    throw new Error("FeatureCollection is empty.");
  }
  return data;
}

export function featureLabel(feature, index) {
  const props = feature.properties || {};
  const id = props.PARCEL_ID ?? props.parcel_id ?? props.id;
  const addr = props.PARCEL_ADD ?? props.parcel_add ?? props.address;
  if (id != null && addr != null) return `${id} — ${addr}`;
  if (id != null) return String(id);
  if (addr != null) return String(addr);
  return `Feature ${index + 1}`;
}

export function getRingsFromGeometry(geometry) {
  if (!geometry) throw new Error("Feature has no geometry.");
  if (geometry.type === "Polygon") {
    return geometry.coordinates.map((ring, idx) => ({
      ring: ring.map(([lon, lat]) => ({ lon, lat })),
      isHole: idx > 0,
    }));
  }
  if (geometry.type === "MultiPolygon") {
    const out = [];
    for (const poly of geometry.coordinates) {
      poly.forEach((ring, idx) => {
        out.push({
          ring: ring.map(([lon, lat]) => ({ lon, lat })),
          isHole: idx > 0,
        });
      });
    }
    return out;
  }
  throw new Error(`Unsupported geometry type: ${geometry.type}. Use Polygon or MultiPolygon.`);
}

export function validateWgs84Coords(coords) {
  for (const { lon, lat } of coords) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error("Coordinates must be numeric lon/lat pairs.");
    }
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      throw new Error(
        "Coordinates look projected, not WGS84 lon/lat. Expected EPSG:4326 values within ±180/±90."
      );
    }
  }
}

export function openRing(ring) {
  if (ring.length < 2) return ring.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first.lon === last.lon && first.lat === last.lat) {
    return ring.slice(0, -1);
  }
  return ring.slice();
}

export function closeRing(open) {
  if (open.length === 0) return open.slice();
  const closed = open.slice();
  const first = closed[0];
  const last = closed[closed.length - 1];
  if (first.lon !== last.lon || first.lat !== last.lat) {
    closed.push({ ...first });
  }
  return closed;
}

export function projectRing(ring4326, zone) {
  const z = zone ?? detectUtmZone(ring4326[0].lon);
  return ring4326.map(({ lon, lat }) => {
    const { easting, northing } = wgs84ToUtm(lon, lat, z);
    return { lon, lat, easting, northing, x: easting, y: northing };
  });
}

export function translateToOrigin(points) {
  let minX = Infinity;
  let minY = Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  return {
    originX: minX,
    originY: minY,
    points: points.map((p) => ({
      ...p,
      x: p.x - minX,
      y: p.y - minY,
    })),
  };
}

export function dist2d(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

export function shoelaceArea(openRing) {
  if (openRing.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < openRing.length; i++) {
    const j = (i + 1) % openRing.length;
    sum += openRing[i].x * openRing[j].y - openRing[j].x * openRing[i].y;
  }
  return Math.abs(sum) / 2;
}

export function ringPerimeter(openRing) {
  if (openRing.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < openRing.length; i++) {
    const j = (i + 1) % openRing.length;
    total += dist2d(openRing[i], openRing[j]);
  }
  return total;
}

export function bearingFromNorth(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const deg = rad2deg(Math.atan2(dx, dy));
  return (deg + 360) % 360;
}

export function buildSegments(openRing, unitScale = 1) {
  const segments = [];
  for (let i = 0; i < openRing.length; i++) {
    const j = (i + 1) % openRing.length;
    const a = openRing[i];
    const b = openRing[j];
    const lengthM = dist2d(a, b);
    segments.push({
      fromIndex: i,
      toIndex: j,
      from: a,
      to: b,
      lengthM,
      length: lengthM / unitScale,
      bearing: bearingFromNorth(a, b),
    });
  }
  return segments;
}

export function dropShortSegments(openRing, thresholdDisplay, unitScale) {
  const minLenM = thresholdDisplay * unitScale;
  if (minLenM <= 0 || openRing.length < 3) {
    return { ring: openRing.slice(), removed: [] };
  }

  let pts = openRing.slice();
  const removed = [];
  let changed = true;

  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      if (dist2d(pts[i], pts[j]) < minLenM) {
        removed.push(pts[j]);
        pts.splice(j, 1);
        changed = true;
        break;
      }
    }
  }

  return { ring: pts, removed };
}

function perpDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return dist2d(point, start);
  const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const projX = start.x + t * dx;
  const projY = start.y + t * dy;
  return Math.hypot(point.x - projX, point.y - projY);
}

function douglasPeuckerOpen(points, epsilonM) {
  if (points.length <= 2) return points.slice();

  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpDistance(points[i], points[0], points[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist > epsilonM) {
    const left = douglasPeuckerOpen(points.slice(0, index + 1), epsilonM);
    const right = douglasPeuckerOpen(points.slice(index), epsilonM);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[end]];
}

export function simplifyNearCollinear(openRing, toleranceDisplay, unitScale) {
  const tolM = toleranceDisplay * unitScale;
  if (tolM <= 0 || openRing.length < 3) {
    return { ring: openRing.slice(), removed: [] };
  }

  const original = openRing.slice();
  const simplified = douglasPeuckerOpen(original, tolM);
  const kept = new Set(simplified);
  const removed = original.filter((p) => !kept.has(p));
  return { ring: simplified, removed };
}

export function convertLength(meters, units) {
  return units === "feet" ? metersToFeet(meters) : meters;
}

export function convertArea(sqMeters, units) {
  if (units === "feet") {
    return {
      primary: sqMetersToSqFeet(sqMeters),
      secondary: sqFeetToAcres(sqMetersToSqFeet(sqMeters)),
      primaryLabel: "sq ft",
      secondaryLabel: "acres",
    };
  }
  return {
    primary: sqMeters,
    secondary: sqMetersToHectares(sqMeters),
    primaryLabel: "sq m",
    secondaryLabel: "hectares",
  };
}

export function pickCalibrationSegments(segments) {
  if (segments.length < 3) return segments.slice(0, Math.min(2, segments.length));
  const sorted = segments
    .map((seg, idx) => ({ ...seg, idx }))
    .sort((a, b) => b.length - a.length);

  const first = sorted[0];
  let second = null;
  for (let i = 1; i < sorted.length; i++) {
    const cand = sorted[i];
    const adjacent =
      cand.idx === first.idx ||
      cand.idx === (first.idx + 1) % segments.length ||
      cand.idx === (first.idx - 1 + segments.length) % segments.length ||
      first.idx === (cand.idx + 1) % segments.length;
    if (!adjacent) {
      second = cand;
      break;
    }
  }
  if (!second) second = sorted[1];
  return [first, second];
}

/**
 * Process a feature into rings with local origin, cleanup, and measurements.
 */
export function processFeature(feature, options) {
  const {
    units = "feet",
    dropShortFt = 0,
    simplifyFt = 0,
  } = options;

  const unitScale = units === "feet" ? M_PER_FT : 1;
  const ringMeta = getRingsFromGeometry(feature.geometry);
  const rings4326 = ringMeta.map((m) => m.ring);
  for (const ring of rings4326) validateWgs84Coords(ring);

  const zone = detectUtmZone(rings4326[0][0].lon);
  const projectedRings = ringMeta.map(({ ring }) => projectRing(openRing(ring), zone));

  let allPoints = projectedRings.flat();
  const { originX, originY, points: shiftedAll } = translateToOrigin(allPoints);
  allPoints = shiftedAll;

  let pointIdx = 0;
  const localRingsRaw = projectedRings.map((ring) => {
    const count = ring.length;
    const slice = allPoints.slice(pointIdx, pointIdx + count).map((p) => ({ ...p }));
    pointIdx += count;
    return slice;
  });

  const cleanedRings = localRingsRaw.map((ringOpen) => {
    let current = ringOpen.slice();
    const removed = [];

    if (dropShortFt > 0) {
      const dropped = dropShortSegments(current, dropShortFt, unitScale);
      current = dropped.ring;
      removed.push(...dropped.removed);
    }
    if (simplifyFt > 0) {
      const simplified = simplifyNearCollinear(current, simplifyFt, unitScale);
      current = simplified.ring;
      removed.push(...simplified.removed);
    }

    return { open: current, removed, closed: closeRing(current) };
  });

  let areaSqM = 0;
  for (let i = 0; i < cleanedRings.length; i++) {
    const a = shoelaceArea(cleanedRings[i].open);
    areaSqM += ringMeta[i].isHole ? -a : a;
  }
  areaSqM = Math.max(0, areaSqM);

  const outerSegments = buildSegments(cleanedRings[0].open, unitScale);
  const perimeterM = cleanedRings.reduce((sum, ring, idx) => {
    const p = ringPerimeter(ring.open);
    return sum + (idx === 0 ? p : 0);
  }, 0);

  const area = convertArea(areaSqM, units);
  const rawVertexCount = localRingsRaw.reduce((n, r) => n + r.length, 0);
  const cleanVertexCount = cleanedRings.reduce((n, r) => n + r.open.length, 0);
  const removedVertices = cleanedRings.flatMap((r) => r.removed);

  const displayRings = cleanedRings.map((ring) =>
    ring.open.map((p) => ({
      ...p,
      x: convertLength(p.x, units),
      y: convertLength(p.y, units),
    }))
  );

  const calibration = pickCalibrationSegments(outerSegments);

  return {
    zone,
    originX,
    originY,
    unitScale,
    units,
    rings4326,
    ringMeta,
    localRingsRaw,
    cleanedRings,
    displayRings,
    removedVertices,
    areaSqM,
    area,
    perimeter: convertLength(perimeterM, units),
    segments: outerSegments,
    calibration,
    rawVertexCount,
    cleanVertexCount,
  };
}
