import 'server-only';

import { z } from 'zod';
import type { ExternalListingSummary, IntegrationPage } from '@/integrations/core';

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
      .optional()
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

export class MercadoLibreListingsError extends Error {
  constructor(
    public readonly kind:
      | 'listing_search_failed'
      | 'listing_detail_failed'
      | 'invalid_provider_response'
  ) {
    super(kind);
    this.name = 'MercadoLibreListingsError';
  }
}

export interface MercadoLibreListingsClientConfig {
  apiBaseUrl?: string;
}

export interface MercadoLibreListingPage extends IntegrationPage<ExternalListingSummary> {
  total: number | null;
}

export class MercadoLibreListingsClient {
  private readonly apiBaseUrl: string;

  constructor(
    config: MercadoLibreListingsClientConfig = {},
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.apiBaseUrl = config.apiBaseUrl ?? 'https://api.mercadolibre.com';
  }

  async listSellerListings(input: {
    accessToken: string;
    sellerId: string;
    limit?: number;
    offset?: number;
  }): Promise<MercadoLibreListingPage> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 20);
    const offset = Math.max(input.offset ?? 0, 0);
    const searchUrl = new URL(
      `/users/${encodeURIComponent(input.sellerId)}/items/search`,
      this.apiBaseUrl
    );
    searchUrl.searchParams.set('limit', String(limit));
    searchUrl.searchParams.set('offset', String(offset));

    const search = await this.requestJson(searchUrl, input.accessToken, 'listing_search_failed');
    const parsedSearch = searchResponseSchema.safeParse(search);
    if (!parsedSearch.success) throw new MercadoLibreListingsError('invalid_provider_response');

    const itemIds = parsedSearch.data.results.slice(0, limit);
    const items = await this.getItems(input.accessToken, itemIds);

    return {
      items,
      total: parsedSearch.data.paging?.total ?? null,
      nextCursor:
        parsedSearch.data.paging && offset + itemIds.length < parsedSearch.data.paging.total
          ? String(offset + itemIds.length)
          : null
    };
  }

  private async getItems(
    accessToken: string,
    itemIds: readonly string[]
  ): Promise<ExternalListingSummary[]> {
    if (itemIds.length === 0) return [];

    const itemsUrl = new URL('/items', this.apiBaseUrl);
    itemsUrl.searchParams.set('ids', itemIds.join(','));
    itemsUrl.searchParams.set(
      'attributes',
      'id,title,status,price,currency_id,available_quantity,sold_quantity,listing_type_id,permalink,thumbnail,catalog_product_id,seller_custom_field,condition,attributes'
    );

    const response = await this.requestJson(itemsUrl, accessToken, 'listing_detail_failed');
    const parsedResponse = multiGetResponseSchema.safeParse(response);
    if (!parsedResponse.success) throw new MercadoLibreListingsError('invalid_provider_response');

    const byId = new Map<string, ExternalListingSummary>();
    for (const entry of parsedResponse.data) {
      if (entry.code !== 200) continue;
      const item = itemSchema.safeParse(entry.body);
      if (!item.success) throw new MercadoLibreListingsError('invalid_provider_response');
      byId.set(item.data.id, normalizeListing(item.data));
    }

    return itemIds.flatMap((itemId) => {
      const item = byId.get(itemId);
      return item ? [item] : [];
    });
  }

  private async requestJson(
    url: URL,
    accessToken: string,
    failure: 'listing_search_failed' | 'listing_detail_failed'
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
        cache: 'no-store'
      });
    } catch {
      throw new MercadoLibreListingsError(failure);
    }

    if (!response.ok) throw new MercadoLibreListingsError(failure);

    try {
      return await response.json();
    } catch {
      throw new MercadoLibreListingsError('invalid_provider_response');
    }
  }
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
    sellerCustomField: item.seller_custom_field ?? null,
    condition: item.condition ?? null
  };
}
