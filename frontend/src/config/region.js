// Display-only constants for initial map placement, so maps render centered
// on Chandigarh immediately rather than flashing a default/world view while
// waiting on the /api/region call. The authoritative boundary polygon used
// for the actual geofence check lives on the backend (see
// backend/data/chandigarh-boundary.geojson) and is fetched via useRegion().
export const CHANDIGARH_CENTER = [30.7333, 76.7794];
export const CHANDIGARH_CITY_ZOOM = 12;
export const CHANDIGARH_REGIONAL_ZOOM = 7;
