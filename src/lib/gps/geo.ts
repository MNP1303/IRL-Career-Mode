import type { LatLon } from "@/lib/gps/types";

const EARTH_RADIUS = 6_371_008.8;
const RAD = Math.PI / 180;

/** Great-circle distance in metres on a spherical Earth; for long distances only. */
export function haversine(a: LatLon, b: LatLon) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** WGS84 metres per degree of latitude and longitude at a latitude. */
function metresPerDegree(latitude: number) {
  const phi = latitude * RAD;
  return {
    lat: 111_132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi) - 0.0023 * Math.cos(6 * phi),
    lon: 111_412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi),
  };
}

/**
 * Ground distance in metres between two nearby points, on the WGS84
 * ellipsoid. For the short steps between GPS samples it is far more accurate
 * than the spherical `haversine` (which is off by up to ~0.5%), and it agrees
 * exactly with `localProjection`, so metrics and pitch positions match.
 */
export function groundDistance(a: LatLon, b: LatLon) {
  const scale = metresPerDegree((a.lat + b.lat) / 2);
  let dLon = b.lon - a.lon;
  if (dLon > 180) dLon -= 360;
  else if (dLon < -180) dLon += 360;
  return Math.hypot((b.lat - a.lat) * scale.lat, dLon * scale.lon);
}

export interface LocalProjection {
  origin: LatLon;
  /** Degrees → local metres east (x) and north (y) of the origin. */
  forward(point: LatLon): { e: number; n: number };
  inverse(e: number, n: number): LatLon;
}

/**
 * A local east/north tangent-plane projection around `origin`, using the
 * WGS84 radii of curvature at that latitude. Over a few kilometres it is
 * accurate to centimetres, far below GPS error, and it preserves distances
 * and angles, which the pitch alignment relies on.
 */
export function localProjection(origin: LatLon): LocalProjection {
  const { lat: metresPerLat, lon: metresPerLon } = metresPerDegree(origin.lat);
  return {
    origin,
    forward: (point) => ({ e: (point.lon - origin.lon) * metresPerLon, n: (point.lat - origin.lat) * metresPerLat }),
    inverse: (e, n) => ({ lat: origin.lat + n / metresPerLat, lon: origin.lon + e / metresPerLon }),
  };
}

export function isValidCoordinate(lat: number, lon: number) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  // (0, 0) is what many devices write before they have a fix.
  return !(lat === 0 && lon === 0);
}

export function median(values: number[]) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function quantile(values: number[], q: number) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}
