import 'server-only';

import { z } from 'zod';
import type { ExternalListingSummary, IntegrationPage } from '@/integrations/core';

const MAX_MULTI_GET_IDS = 20;
const MAX_OFFSET_RESULTS = 1000;
const DEFAULT_DISCOVERY_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;

const itemIdSchema = z.string().trim().min(1).max(64);

const searchResponseSchema = z
  .object({
    results: z.array(itemIdSchema).max(1000),
    paging: z
      .object({
        total: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().optional()
      })
      .optional(),
    scroll_id: z.string().trim().min(1).max(4096).nullable().optional()
  })
  .passthrough();

const itemSchema = z
  .object({
    id: itemIdSchema,
    title: z.string().trim().min(1).max(500),
    status: z.string().trim().min(1).max(100),
    price: z.number().finite().nonnegative().nullable().optional(),
    currency_id: z.string().trim().min(1).max(16).nullable().optional(),
    available_quantity: z.number().int().nonnegative().nullable().optional(),
    sold_quantity: z.number().int().nonnegative().nullable().optional(),
    listing_type_id: z.string().trim().min(1).max(100).nullable().optional(),
    permalink: z.url().max(2048).nullable().optional(),
    thumbnail: z.url().max(2048).nullable().optional(),
    catalog_product_id: z.string().trim().min(1).max(255).nullable().optional(),
    seller_custom_field: z.string().trim().min(1).max(255).nullable().optional(),
    condition: z.string().trim().min(1).max(100).nullable().optional(),
    date_created: z.iso.datetime().nullable().optional(),
    last_updated: z.iso.datetime().nullable().optional(),
    attributes: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(100),
            value_name: z.string().trim().min(1).max(255).nullable().optional()
          })
          .passthrough()
      )
      .optional()
  })
  .passthrough();

const multiGetResponseSchema = z.array(
  z
    .object({
      code: z.number().int(),
      body: z.unknown()
    })
    .passthrough()
);

export type MercadoLibreListingsErrorKind =
  | 'provider_timeout'
  | 'provider_rate_limited'
  | 'provider_server_error'
  | 'provider_client_error'
  | 'provider_network_error'
  | 'invalid_provider_response';

export type MercadoLibreListingsStage = 'discovery' | 'details';

export class MercadoLibreListingsError extends Error {
  constructor(
    public readonly kind: MercadoLibreListingsErrorKind,
    public readonly stage: MercadoLibreListingsStage,
    public readonly retryable: boolean,
    public readonly status: number | null = null
  ) {
    super(kind);
    this.name = 'MercadoLibreListingsError';
  }
}

export interface MercadoLibreListingFailure {
  externalListingId: string;
  kind: MercadoLibreListingsErrorKind;
  retryable: boolean;
  status: number | null;
}

export type MercadoLibreListingDiscoveryCursor =
  | { mode: 'offset'; offset: number }
  | { mode: 'scan'; scrollId: string };

export interface MercadoLibreListingDiscoveryPage {
  itemIds: readonly string[];
  total: number | null;
  mode: 'offset' | 'scan';
  exhausted: boolean;
  nextCursor: MercadoLibreListingDiscoveryCursor | null;
}

export interface MercadoLibreListingDetailsResult {
  items: readonly ExternalListingSummary[];
  failures: readonly MercadoLibreListingFailure[];
}

export interface MercadoLibreListingsClientConfig {
  apiBaseUrl?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

export interface MercadoLibreListingPage extends IntegrationPage<ExternalListingSummary> {
  total: number | null;
  failures: readonly MercadoLibreListingFailure[];
}

export class MercadoLibreListingsClient {
  private readonly apiBaseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(
    config: MercadoLibreListingsClientConfig = {},
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.apiBaseUrl = config.apiBaseUrl ?? 'https://api.mercadolibre.com';
    this.timeoutMs = Math.max(1, Math.floor(config.timeoutMs ?? DEFAULT_TIMEOUT_MS));
    this.maxAttempts = Math.max(1, Math.floor(config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
    this.baseDelayMs = Math.max(0, Math.floor(config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS));
    this.sleep =
      config.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = config.random ?? Math.random;
    this.now = config.now ?? Date.now;
  }

  async discoverSellerListingIds(input: {
    accessToken: string;
    sellerId: string;
    cursor?: MercadoLibreListingDiscoveryCursor | null;
    limit?: number;
  }): Promise<MercadoLibreListingDiscoveryPage> {
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_DISCOVERY_LIMIT, 1), 100);

    if (input.cursor?.mode === 'scan') {
      return this.requestScanPage(input.accessToken, input.sellerId, limit, input.cursor.scrollId);
    }

    const offset = input.cursor?.mode === 'offset' ? input.cursor.offset : 0;
    const page = await this.requestOffsetPage(input.accessToken, input.sellerId, limit, offset);

    if (offset === 0 && page.total !== null && page.total > MAX_OFFSET_RESULTS) {
      return this.requestScanPage(input.accessToken, input.sellerId, limit);
    }

    return page;
  }

  async getListingDetails(input: {
    accessToken: string;
    itemIds: readonly string[];
  }): Promise<MercadoLibreListingDetailsResult> {
    const itemIds = z.array(itemIdSchema).max(MAX_MULTI_GET_IDS).parse(input.itemIds);
    if (itemIds.length === 0) return { items: [], failures: [] };

    const itemsUrl = new URL('/items', this.apiBaseUrl);
    itemsUrl.searchParams.set('ids', itemIds.join(','));
    itemsUrl.searchParams.set(
      'attributes',
      'id,title,status,price,currency_id,available_quantity,sold_quantity,listing_type_id,permalink,thumbnail,catalog_product_id,seller_custom_field,condition,date_created,last_updated,attributes'
    );

    const response = await this.requestJson(itemsUrl, input.accessToken, 'details');
    const parsedResponse = multiGetResponseSchema.safeParse(response);
    if (!parsedResponse.success) {
      throw new MercadoLibreListingsError('invalid_provider_response', 'details', false);
    }

    const itemsById = new Map<string, ExternalListingSummary>();
    const failuresById = new Map<string, MercadoLibreListingFailure>();
    for (const [index, entry] of parsedResponse.data.entries()) {
      const requestedId = itemIds[index];
      if (!requestedId) continue;
      if (entry.code !== 200) {
        failuresById.set(requestedId, failureForStatus(requestedId, entry.code));
        continue;
      }

      const item = itemSchema.safeParse(entry.body);
      if (!item.success || !itemIds.includes(item.data.id)) {
        failuresById.set(requestedId, {
          externalListingId: requestedId,
          kind: 'invalid_provider_response',
          retryable: false,
          status: 200
        });
        continue;
      }
      itemsById.set(item.data.id, normalizeListing(item.data));
    }

    for (const itemId of itemIds) {
      if (!itemsById.has(itemId) && !failuresById.has(itemId)) {
        failuresById.set(itemId, {
          externalListingId: itemId,
          kind: 'invalid_provider_response',
          retryable: false,
          status: 200
        });
      }
    }

    return {
      items: itemIds.flatMap((itemId) => {
        const item = itemsById.get(itemId);
        return item ? [item] : [];
      }),
      failures: itemIds.flatMap((itemId) => {
        const failure = failuresById.get(itemId);
        return failure ? [failure] : [];
      })
    };
  }

  async listSellerListings(input: {
    accessToken: string;
    sellerId: string;
    limit?: number;
    offset?: number;
  }): Promise<MercadoLibreListingPage> {
    const limit = Math.min(Math.max(input.limit ?? MAX_MULTI_GET_IDS, 1), MAX_MULTI_GET_IDS);
    const offset = Math.max(input.offset ?? 0, 0);
    const discovery = await this.requestOffsetPage(
      input.accessToken,
      input.sellerId,
      limit,
      offset
    );
    const details = await this.getListingDetails({
      accessToken: input.accessToken,
      itemIds: discovery.itemIds
    });

    return {
      items: details.items,
      failures: details.failures,
      total: discovery.total,
      nextCursor:
        discovery.nextCursor?.mode === 'offset' ? String(discovery.nextCursor.offset) : null
    };
  }

  private async requestOffsetPage(
    accessToken: string,
    sellerId: string,
    limit: number,
    offset: number
  ): Promise<MercadoLibreListingDiscoveryPage> {
    const searchUrl = this.sellerSearchUrl(sellerId);
    searchUrl.searchParams.set('limit', String(limit));
    searchUrl.searchParams.set('offset', String(offset));
    const parsed = await this.requestSearch(searchUrl, accessToken);
    const nextOffset = offset + parsed.results.length;

    return {
      itemIds: parsed.results,
      total: parsed.paging?.total ?? null,
      mode: 'offset',
      exhausted: parsed.paging !== undefined && nextOffset >= parsed.paging.total,
      nextCursor:
        parsed.results.length > 0 &&
        parsed.paging &&
        nextOffset < parsed.paging.total &&
        nextOffset < MAX_OFFSET_RESULTS
          ? { mode: 'offset', offset: nextOffset }
          : null
    };
  }

  private async requestScanPage(
    accessToken: string,
    sellerId: string,
    limit: number,
    scrollId?: string
  ): Promise<MercadoLibreListingDiscoveryPage> {
    const searchUrl = this.sellerSearchUrl(sellerId);
    searchUrl.searchParams.set('search_type', 'scan');
    searchUrl.searchParams.set('limit', String(limit));
    if (scrollId) searchUrl.searchParams.set('scroll_id', scrollId);
    const parsed = await this.requestSearch(searchUrl, accessToken);

    return {
      itemIds: parsed.results,
      total: parsed.paging?.total ?? null,
      mode: 'scan',
      exhausted: parsed.scroll_id === null,
      nextCursor: parsed.scroll_id ? { mode: 'scan', scrollId: parsed.scroll_id } : null
    };
  }

  private sellerSearchUrl(sellerId: string): URL {
    return new URL(
      `/users/${encodeURIComponent(itemIdSchema.parse(sellerId))}/items/search`,
      this.apiBaseUrl
    );
  }

  private async requestSearch(url: URL, accessToken: string) {
    const response = await this.requestJson(url, accessToken, 'discovery');
    const parsed = searchResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new MercadoLibreListingsError('invalid_provider_response', 'discovery', false);
    }
    return parsed.data;
  }

  private async requestJson(
    url: URL,
    accessToken: string,
    stage: MercadoLibreListingsStage
  ): Promise<unknown> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetcher(url, {
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: 'application/json'
          },
          signal: controller.signal,
          cache: 'no-store'
        });
      } catch (error) {
        clearTimeout(timeout);
        const timedOut =
          controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
        const providerError = new MercadoLibreListingsError(
          timedOut ? 'provider_timeout' : 'provider_network_error',
          stage,
          true
        );
        if (attempt === this.maxAttempts) throw providerError;
        await this.waitBeforeRetry(attempt);
        continue;
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const providerError = errorForStatus(response.status, stage);
        if (!providerError.retryable || attempt === this.maxAttempts) throw providerError;
        await this.waitBeforeRetry(attempt, response.headers.get('retry-after'));
        continue;
      }

      try {
        return await response.json();
      } catch {
        throw new MercadoLibreListingsError(
          'invalid_provider_response',
          stage,
          false,
          response.status
        );
      }
    }

    throw new MercadoLibreListingsError('provider_network_error', stage, true);
  }

  private async waitBeforeRetry(attempt: number, retryAfter: string | null = null): Promise<void> {
    const exponential = this.baseDelayMs * 2 ** (attempt - 1);
    const jitter = this.random() * this.baseDelayMs;
    const retryAfterMs = parseRetryAfter(retryAfter, this.now());
    await this.sleep(Math.max(exponential + jitter, retryAfterMs ?? 0));
  }
}

function errorForStatus(
  status: number,
  stage: MercadoLibreListingsStage
): MercadoLibreListingsError {
  if (status === 429) {
    return new MercadoLibreListingsError('provider_rate_limited', stage, true, status);
  }
  if (status >= 500) {
    return new MercadoLibreListingsError('provider_server_error', stage, true, status);
  }
  return new MercadoLibreListingsError('provider_client_error', stage, false, status);
}

function failureForStatus(externalListingId: string, status: number): MercadoLibreListingFailure {
  const error = errorForStatus(status, 'details');
  return {
    externalListingId,
    kind: error.kind,
    retryable: error.retryable,
    status: error.status
  };
}

function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) && date > now ? date - now : null;
}

function normalizeListing(item: z.infer<typeof itemSchema>): ExternalListingSummary {
  const sellerSku = item.attributes?.find((attribute) => attribute.id === 'SELLER_SKU')?.value_name;

  return {
    externalId: item.id,
    title: item.title,
    status: item.status,
    price: item.price ?? null,
    currency: item.currency_id ?? null,
    availableQuantity: item.available_quantity ?? null,
    soldQuantity: item.sold_quantity ?? null,
    listingType: item.listing_type_id ?? null,
    permalink: item.permalink ?? null,
    thumbnail: item.thumbnail ?? null,
    catalogProductId: item.catalog_product_id ?? null,
    sellerSku: sellerSku ?? null,
    condition: item.condition ?? null,
    providerCreatedAt: item.date_created ?? null,
    providerUpdatedAt: item.last_updated ?? null
  };
}
