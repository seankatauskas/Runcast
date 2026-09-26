import type { Route } from '@runcast/core';

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[character]!,
  );
}

export function routeToGpx(route: Route): string {
  const points = route.points
    .map((point) => `<trkpt lat="${point.lat}" lon="${point.lon}"><ele>${point.ele}</ele></trkpt>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="Runcast"><trk><name>${escapeXml(route.name)}</name><trkseg>${points}</trkseg></trk></gpx>`;
}
