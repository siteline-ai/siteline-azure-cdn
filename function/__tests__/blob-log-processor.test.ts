import type { EventGridEvent } from '@azure/functions';
import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const azureStorageMocks = vi.hoisted(() => {
  const downloadToBuffer = vi.fn();
  const BlobClient = vi.fn().mockImplementation(function BlobClientMock() {
    return {
      downloadToBuffer
    };
  });

  return {
    BlobClient,
    downloadToBuffer
  };
});

const azureFunctionsMocks = vi.hoisted(() => {
  const eventGrid = vi.fn();
  return {
    app: {
      eventGrid
    }
  };
});

const sitelineMocks = vi.hoisted(() => {
  const track = vi.fn<(data: unknown) => Promise<void>>();
  const Siteline = vi.fn().mockImplementation(function SitelineMock() {
    return {
      track
    };
  });

  return {
    track,
    Siteline
  };
});

const azureIdentityMocks = vi.hoisted(() => {
  const DefaultAzureCredential = vi.fn().mockImplementation(function DefaultAzureCredentialMock() {
    return {};
  });

  return {
    DefaultAzureCredential
  };
});

vi.mock('@azure/storage-blob', () => {
  return {
    BlobClient: azureStorageMocks.BlobClient
  };
});

vi.mock('@azure/functions', () => {
  return {
    app: azureFunctionsMocks.app
  };
});

vi.mock('@azure/identity', () => {
  return {
    DefaultAzureCredential: azureIdentityMocks.DefaultAzureCredential
  };
});

vi.mock('@siteline/core', () => {
  return {
    Siteline: sitelineMocks.Siteline
  };
});

const createEvent = (
  blobUrl =
    'https://sitelineazurecdnlogs.blob.core.windows.net/cdn-logs/insights-logs-coreanalytics/log.json.gz'
): EventGridEvent => {
  return {
    id: 'event-id',
    topic: '/subscriptions/sub-id/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sitelineazurecdnlogs',
    subject: '/blobServices/default/containers/cdn-logs/blobs/log.json.gz',
    eventType: 'Microsoft.Storage.BlobCreated',
    eventTime: '2026-02-25T10:00:00Z',
    dataVersion: '1',
    metadataVersion: '1',
    data: {
      url: blobUrl
    }
  };
};

const setBlobBody = (rawLog: string, gzip = false): void => {
  const payload = gzip ? gzipSync(Buffer.from(rawLog, 'utf8')) : Buffer.from(rawLog, 'utf8');
  azureStorageMocks.downloadToBuffer.mockResolvedValue(payload);
};

const loadHandler = async (): Promise<(event: EventGridEvent) => Promise<void>> => {
  const module = await import('../blob-log-processor.js');
  return module.handler as (event: EventGridEvent) => Promise<void>;
};

describe('blob-log-processor handler', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    process.env.APP_NAME = 'siteline-azure-cdn-processor';
    process.env.SITELINE_WEBSITE_KEY = 'siteline_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    process.env.SITELINE_ENDPOINT = 'https://siteline.ai/v1/intake/pageview';
    process.env.SITELINE_DEBUG = 'false';

    azureStorageMocks.downloadToBuffer.mockReset();
    azureStorageMocks.BlobClient.mockReset();
    azureStorageMocks.BlobClient.mockImplementation(function BlobClientMock() {
      return {
        downloadToBuffer: azureStorageMocks.downloadToBuffer
      };
    });

    sitelineMocks.track.mockReset();
    sitelineMocks.Siteline.mockReset();
    sitelineMocks.Siteline.mockImplementation(function SitelineMock() {
      return {
        track: sitelineMocks.track
      };
    });

    azureFunctionsMocks.app.eventGrid.mockReset();
    azureIdentityMocks.DefaultAzureCredential.mockReset();
  });

  it('tracks pageviews from a valid gzipped Azure CDN log payload', async () => {
    setBlobBody(
      JSON.stringify({
        records: [
          {
            properties: {
              requestUri: 'https://cdn.example.com/health?a=1&b=2',
              httpMethod: 'GET',
              statusCode: 204,
              timeTaken: 0.123,
              userAgent: 'Mozilla/5.0 (Test)',
              referer: 'https://example.com/',
              clientIp: '203.0.113.10'
            }
          },
          {
            properties: {
              requestUri: '/api/ingest',
              host: 'cdn.example.com',
              method: 'POST',
              httpStatusCode: 201,
              durationMs: 10,
              clientIP_s: '203.0.113.11'
            }
          },
          {
            properties: {
              requestUri: 'https://cdn.example.com/not-found?debug=true',
              requestMethod: 'GET',
              responseStatusCode: 404,
              duration: 1.5,
              requestUserAgent: 'curl/8.7.1',
              referrer: 'https://ref.example/path',
              callerIpAddress: '203.0.113.12'
            }
          }
        ]
      }),
      true
    );

    const handler = await loadHandler();
    await handler(createEvent());

    expect(azureStorageMocks.BlobClient).toHaveBeenCalledTimes(1);
    expect(sitelineMocks.track).toHaveBeenCalledTimes(3);
    expect(sitelineMocks.track).toHaveBeenNthCalledWith(1, {
      url: 'https://cdn.example.com/health?a=1&b=2',
      method: 'GET',
      status: 204,
      duration: 123,
      userAgent: 'Mozilla/5.0 (Test)',
      ref: 'https://example.com/',
      ip: '203.0.113.10'
    });
    expect(sitelineMocks.track).toHaveBeenNthCalledWith(2, {
      url: 'https://cdn.example.com/api/ingest',
      method: 'POST',
      status: 201,
      duration: 10,
      userAgent: null,
      ref: null,
      ip: '203.0.113.11'
    });
    expect(sitelineMocks.track).toHaveBeenNthCalledWith(3, {
      url: 'https://cdn.example.com/not-found?debug=true',
      method: 'GET',
      status: 404,
      duration: 1500,
      userAgent: 'curl/8.7.1',
      ref: 'https://ref.example/path',
      ip: '203.0.113.12'
    });
  });

  it('skips rows with invalid status or missing uri without throwing', async () => {
    setBlobBody(
      [
        JSON.stringify({ properties: { requestUri: '/invalid-missing-status', statusCode: '-', host: 'cdn.example.com' } }),
        JSON.stringify({ properties: { requestUri: '/invalid-status', statusCode: 'abc', host: 'cdn.example.com' } }),
        JSON.stringify({ properties: { requestUri: '', statusCode: 200, host: 'cdn.example.com' } }),
        JSON.stringify({ properties: { requestUri: '/valid', statusCode: 200, host: 'cdn.example.com', method: 'GET', timeTaken: 0.4, clientIp: '203.0.113.13', userAgent: 'Mozilla/5.0' } })
      ].join('\n')
    );

    const handler = await loadHandler();

    await expect(handler(createEvent())).resolves.toBeUndefined();
    expect(sitelineMocks.track).toHaveBeenCalledTimes(1);
    expect(sitelineMocks.track).toHaveBeenCalledWith({
      url: 'https://cdn.example.com/valid',
      method: 'GET',
      status: 200,
      duration: 400,
      userAgent: 'Mozilla/5.0',
      ref: null,
      ip: '203.0.113.13'
    });
  });

  it('is fail-open on malformed lines and continues processing valid rows', async () => {
    setBlobBody(
      [
        JSON.stringify({ properties: { requestUri: '/first', host: 'cdn.example.com', statusCode: 200, timeTaken: 0.2 } }),
        '{malformed-json-line}',
        JSON.stringify({ properties: { requestUri: '/third', host: 'cdn.example.com', statusCode: 200, timeTaken: 0.3 } })
      ].join('\n')
    );

    const handler = await loadHandler();

    await expect(handler(createEvent())).resolves.toBeUndefined();
    expect(sitelineMocks.track).toHaveBeenCalledTimes(2);
    expect(sitelineMocks.track).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: 'https://cdn.example.com/first',
        status: 200,
        duration: 200
      })
    );
    expect(sitelineMocks.track).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: 'https://cdn.example.com/third',
        status: 200,
        duration: 300
      })
    );
  });

  it('skips processing when website key is missing', async () => {
    process.env.SITELINE_WEBSITE_KEY = '';

    const handler = await loadHandler();
    await expect(handler(createEvent())).resolves.toBeUndefined();

    expect(sitelineMocks.Siteline).not.toHaveBeenCalled();
    expect(sitelineMocks.track).not.toHaveBeenCalled();
    expect(azureStorageMocks.downloadToBuffer).not.toHaveBeenCalled();
  });

  it('throws when blob download fails', async () => {
    azureStorageMocks.downloadToBuffer.mockRejectedValue(new Error('blob unavailable'));

    const handler = await loadHandler();

    await expect(handler(createEvent())).rejects.toThrow('blob unavailable');
    expect(sitelineMocks.track).not.toHaveBeenCalled();
  });

  it('uses only DefaultAzureCredential for blob access', async () => {
    setBlobBody(
      JSON.stringify({
        records: [
          {
            properties: {
              requestUri: 'https://cdn.example.com/page',
              statusCode: 200,
              method: 'GET'
            }
          }
        ]
      })
    );

    const handler = await loadHandler();
    await handler(createEvent());

    expect(azureIdentityMocks.DefaultAzureCredential).toHaveBeenCalledTimes(1);
    expect(azureStorageMocks.BlobClient).toHaveBeenCalledWith(
      'https://sitelineazurecdnlogs.blob.core.windows.net/cdn-logs/insights-logs-coreanalytics/log.json.gz',
      expect.any(Object)
    );
  });

  it('retries transient Siteline API failures and continues processing', async () => {
    sitelineMocks.track
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce(undefined);

    setBlobBody(
      JSON.stringify({
        records: [
          {
            properties: {
              requestUri: 'https://cdn.example.com/page',
              statusCode: 200,
              method: 'GET'
            }
          }
        ]
      })
    );

    const handler = await loadHandler();
    await handler(createEvent());

    expect(sitelineMocks.track).toHaveBeenCalledTimes(3);
  });

  it('caps concurrent Siteline API calls', async () => {
    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;

    sitelineMocks.track.mockImplementation(() => {
      concurrentCalls++;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          concurrentCalls--;
          resolve();
        }, 10);
      });
    });

    const records = Array.from({ length: 30 }, (_, i) => ({
      properties: {
        requestUri: `https://cdn.example.com/page-${String(i)}`,
        statusCode: 200,
        method: 'GET'
      }
    }));

    setBlobBody(JSON.stringify({ records }));

    const handler = await loadHandler();
    await handler(createEvent());

    expect(sitelineMocks.track).toHaveBeenCalledTimes(30);
    expect(maxConcurrentCalls).toBeLessThanOrEqual(10);
    expect(maxConcurrentCalls).toBeGreaterThan(1);
  });
});
