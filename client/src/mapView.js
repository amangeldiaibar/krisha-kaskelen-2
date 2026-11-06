const TILE = 256;

const worldX = (lon, zoom) => ((lon + 180) / 360) * TILE * 2 ** zoom;
const worldY = (lat, zoom) => {
  const sin = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * TILE * 2 ** zoom;
};

/** Picks the largest zoom and a centre that keep all points inside the image. */
export function fitView(points, width, height, { padding = 44, maxZoom = 16, minZoom = 8 } = {}) {
  const lats = points.map((point) => point.lat);
  const lons = points.map((point) => point.lon);
  const center = {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lon: (Math.min(...lons) + Math.max(...lons)) / 2,
  };
  let zoom = maxZoom;
  while (zoom > minZoom) {
    const spanX = worldX(Math.max(...lons), zoom) - worldX(Math.min(...lons), zoom);
    const spanY = worldY(Math.min(...lats), zoom) - worldY(Math.max(...lats), zoom);
    if (spanX <= width - padding * 2 && spanY <= height - padding * 2) break;
    zoom -= 1;
  }
  return { center, zoom };
}

/** Pixel position of a point on an image with the given view. */
export function project(point, view, width, height) {
  return {
    x: width / 2 + worldX(point.lon, view.zoom) - worldX(view.center.lon, view.zoom),
    y: height / 2 + worldY(point.lat, view.zoom) - worldY(view.center.lat, view.zoom),
  };
}

/**
 * Nudges pins sideways so each one stays visible and clickable.
 * Positions are matched to the input order.
 */
export function spreadPins(positions, { width = 46, height = 30 } = {}) {
  const placed = [];
  const result = positions.map((position) => ({ ...position }));
  const order = result.map((_, index) => index).sort((a, b) => result[a].x - result[b].x);
  for (const index of order) {
    const pin = result[index];
    let moved = true;
    while (moved) {
      moved = false;
      for (const other of placed) {
        if (Math.abs(pin.x - other.x) < width && Math.abs(pin.y - other.y) < height) {
          pin.x = other.x + width;
          moved = true;
        }
      }
    }
    placed.push(pin);
  }
  return result;
}
