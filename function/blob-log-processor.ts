import { type EventGridEvent, app } from '@azure/functions';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobClient } from '@azure/storage-blob';
import { Siteline, type PageviewData, type SitelineConfig } from '@siteline/core';
import { gunzipSync } from 'node:zlib';

import {
  DEFAULT_INTEGRATION_TYPE,
  DEFAULT_SDK_NAME,
  DEFAULT_SDK_VERSION
} from './constants.js';
import { appConfig } from './env.js';

type JsonRecord = Record<string, unknown>;

const GZIP_MAGIC_BYTE_1 = 0x1f;
const GZIP_MAGIC_BYTE_2 = 0x8b;

const MAX_CONCURRENCY = 10;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const logTrackingError = (message: string, error: unknown): void => {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  console.error(
    JSON.stringify({
      service: appConfig.appName,
      message,
      errorMessage
    })
  );
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const trackWithRetry = async (client: Siteline, pageview: PageviewData): Promise<boolean> => {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await client.track(pageview);
      return true;
    } catch (error: unknown) {
      if (attempt === MAX_RETRIES) {
        logTrackingError('Failed to send pageview after retries; record dropped.', error);
        return false;
      }

      const delayMs = BASE_DELAY_MS * 2 ** attempt;
      await sleep(delayMs);
    }
  }

  return false;
};

const processWithConcurrencyLimit = async (
  client: Siteline,
  pageviews: readonly PageviewData[]
): Promise<{ sent: number; failed: number }> => {
  let sent = 0;
  let failed = 0;
  let index = 0;

  const worker = async (): Promise<void> => {
    while (index < pageviews.length) {
      const current = index;
      index++;

      const pageview = pageviews[current];
      if (!pageview) {
        continue;
      }

      const ok = await trackWithRetry(client, pageview);
      if (ok) {
        sent++;
      } else {
        failed++;
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENCY, pageviews.length) },
    () => worker()
  );

  await Promise.all(workers);
  return { sent, failed };
};

const createSitelineClient = (): Siteline | undefined => {
  const websiteKey = appConfig.siteline.websiteKey;
  if (!websiteKey) {
    return undefined;
  }

  const config: SitelineConfig = {
    websiteKey,
    debug: appConfig.siteline.debug
  };

  if (appConfig.siteline.endpoint) {
    config.endpoint = appConfig.siteline.endpoint;
  }

  try {
    return new Siteline({
      ...config,
      sdk: DEFAULT_SDK_NAME,
      sdkVersion: DEFAULT_SDK_VERSION,
      integrationType: DEFAULT_INTEGRATION_TYPE
    });
  } catch (error: unknown) {
    logTrackingError('Siteline initialization failed; tracking disabled.', error);
    return undefined;
  }
};

const siteline = createSitelineClient();

const getNestedValue = (record: JsonRecord, ...keys: readonly string[]): unknown => {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }

  const properties = record.properties;
  if (properties && typeof properties === 'object') {
    const nested = properties as JsonRecord;
    for (const key of keys) {
      if (key in nested) {
        return nested[key];
      }
    }
  }

  return undefined;
};

const toOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === '-') {
    return null;
  }

  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
};

const toOptionalNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isInteger(parsed) ? parsed : undefined;
};

const parseStatus = (record: JsonRecord): number | undefined => {
  const status = toOptionalNumber(
    getNestedValue(record, 'statusCode', 'httpStatusCode', 'responseStatusCode', 'responseCode')
  );

  if (!status || status < 100 || status > 599) {
    return undefined;
  }

  return status;
};

const getDurationValue = (
  record: JsonRecord
): { value: unknown; isMilliseconds: boolean } => {
  const millisecondKeys = ['durationMs', 'timeTakenMs'];
  for (const key of millisecondKeys) {
    const value = getNestedValue(record, key);
    if (value !== undefined) {
      return { value, isMilliseconds: true };
    }
  }

  const secondKeys = ['duration', 'timeTaken', 'requestProcessingTime'];
  for (const key of secondKeys) {
    const value = getNestedValue(record, key);
    if (value !== undefined) {
      return { value, isMilliseconds: false };
    }
  }

  return { value: undefined, isMilliseconds: false };
};

const parseDurationMs = (record: JsonRecord): number => {
  const { value, isMilliseconds } = getDurationValue(record);

  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    if (!isMilliseconds && value <= 60) {
      return Math.round(value * 1000);
    }

    return Math.round(value);
  }

  if (typeof value !== 'string') {
    return 0;
  }

  const parsed = Number.parseFloat(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  if (!isMilliseconds && parsed <= 60) {
    return Math.round(parsed * 1000);
  }

  return Math.round(parsed);
};

const normalizeUrl = (record: JsonRecord): string | null => {
  const requestUri = toOptionalString(
    getNestedValue(record, 'requestUri', 'requestUri_s', 'uri', 'requestPath')
  );

  if (!requestUri) {
    return null;
  }

  try {
    const parsed = new URL(requestUri);
    return parsed.toString();
  } catch {
    const host = toOptionalString(getNestedValue(record, 'host', 'hostName', 'requestHost'));
    const query = toOptionalString(getNestedValue(record, 'queryString', 'requestQuery'));
    const querySuffix = query ? `?${query}` : '';
    if (host) {
      return `https://${host}${requestUri}${querySuffix}`;
    }

    return `${requestUri}${querySuffix}`;
  }
};

const toPageviewData = (record: JsonRecord): PageviewData | undefined => {
  const status = parseStatus(record);
  if (status === undefined) {
    return undefined;
  }

  const url = normalizeUrl(record);
  if (!url) {
    return undefined;
  }

  const method = toOptionalString(getNestedValue(record, 'method', 'httpMethod', 'requestMethod'));

  return {
    url,
    method: method ?? 'UNKNOWN',
    status,
    duration: parseDurationMs(record),
    userAgent: toOptionalString(getNestedValue(record, 'userAgent', 'userAgent_s', 'requestUserAgent')),
    ref: toOptionalString(getNestedValue(record, 'referer', 'referrer', 'requestReferer')),
    ip: toOptionalString(getNestedValue(record, 'clientIp', 'clientIP_s', 'callerIpAddress'))
  };
};

const parseJsonLines = (rawLog: string): JsonRecord[] => {
  const records: JsonRecord[] = [];

  for (const line of rawLog.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object') {
        records.push(parsed as JsonRecord);
      }
    } catch {
      // Fail-open for malformed lines inside mixed log files.
    }
  }

  return records;
};

const parseRecords = (rawLog: string): JsonRecord[] => {
  const trimmed = rawLog.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is JsonRecord => !!item && typeof item === 'object');
    }

    if (parsed && typeof parsed === 'object') {
      const asObject = parsed as JsonRecord;
      const records = asObject.records;
      if (Array.isArray(records)) {
        return records.filter((item): item is JsonRecord => !!item && typeof item === 'object');
      }

      return [asObject];
    }

    return [];
  } catch {
    return parseJsonLines(rawLog);
  }
};

const parseBlobUrl = (blobUrl: string): URL => {
  try {
    return new URL(blobUrl);
  } catch {
    throw new Error('Event Grid payload contains an invalid blob URL.');
  }
};

const buildBlobClient = (blobUrl: URL): BlobClient => {
  return new BlobClient(blobUrl.toString(), new DefaultAzureCredential());
};

const getBlobBuffer = async (blobUrl: string): Promise<Buffer> => {
  const parsedBlobUrl = parseBlobUrl(blobUrl);
  const blobClient = buildBlobClient(parsedBlobUrl);

  const download = await blobClient.downloadToBuffer();
  return Buffer.from(download);
};

const isGzipBuffer = (payload: Buffer): boolean => {
  if (payload.length < 2) {
    return false;
  }

  return payload[0] === GZIP_MAGIC_BYTE_1 && payload[1] === GZIP_MAGIC_BYTE_2;
};

const getRawLog = async (blobUrl: string): Promise<string> => {
  let payload: Buffer;
  try {
    payload = await getBlobBuffer(blobUrl);
  } catch (error: unknown) {
    logTrackingError('Failed to download CDN log blob.', error);
    throw error;
  }

  if (isGzipBuffer(payload)) {
    try {
      return gunzipSync(payload).toString('utf8');
    } catch (error: unknown) {
      logTrackingError('Failed to decompress gzipped CDN log blob.', error);
      throw error;
    }
  }

  return payload.toString('utf8');
};

const getBlobUrl = (event: EventGridEvent): string => {
  const rawData: unknown = (event as { data?: unknown }).data;
  const blobUrl =
    rawData && typeof rawData === 'object'
      ? (rawData as { url?: unknown }).url
      : undefined;

  if (!blobUrl || typeof blobUrl !== 'string') {
    const error = new Error('Event Grid event is missing data.url for blob-created payload.');
    logTrackingError('Invalid Event Grid payload.', error);
    throw error;
  }

  return blobUrl;
};

export const handler = async (event: EventGridEvent): Promise<void> => {
  if (!siteline) {
    return;
  }

  const blobUrl = getBlobUrl(event);
  const rawLog = await getRawLog(blobUrl);
  const records = parseRecords(rawLog);

  const pageviews: PageviewData[] = [];
  let skipped = 0;

  for (const record of records) {
    try {
      const pageview = toPageviewData(record);
      if (!pageview) {
        skipped++;
        continue;
      }

      pageviews.push(pageview);
    } catch (error: unknown) {
      skipped++;
      logTrackingError('Failed to parse Azure CDN log row; row skipped.', error);
    }
  }

  const { sent, failed } = await processWithConcurrencyLimit(siteline, pageviews);

  console.log(
    JSON.stringify({
      service: appConfig.appName,
      message: 'Blob processed.',
      total: records.length,
      sent,
      skipped,
      failed
    })
  );
};

app.eventGrid('blob-log-processor', {
  handler
});

export const __internal = {
  parseRecords,
  toPageviewData
};
