import { GPX_MAX_UTF8_BYTES } from '@runcast/core';
import { describe, expect, it } from 'vitest';
import { readBoundedGpxResponse } from './strava';

describe('bounded Strava GPX export', () => {
  it('rejects an oversized declared response without reading it', async () => {
    const response = new Response('<gpx/>', {
      headers: { 'content-length': String(GPX_MAX_UTF8_BYTES + 1) },
    });
    await expect(readBoundedGpxResponse(response)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('rejects an oversized chunked response', async () => {
    const chunk = new Uint8Array(512 * 1024);
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (let index = 0; index < 5; index += 1) controller.enqueue(chunk);
          controller.close();
        },
      }),
    );
    await expect(readBoundedGpxResponse(response)).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
    });
  });

  it('accepts a valid response without Content-Length', async () => {
    const xml = '<gpx><rte><rtept lat="1" lon="2"/><rtept lat="1.1" lon="2.1"/></rte></gpx>';
    await expect(readBoundedGpxResponse(new Response(xml))).resolves.toBe(xml);
  });
});
