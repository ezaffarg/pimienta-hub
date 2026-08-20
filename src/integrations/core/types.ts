export type IntegrationProvider = 'mercado-libre' | 'shopify' | 'tiendanube' | 'woocommerce';

export interface IntegrationContext {
  organizationId: string;
  storeId: string;
  connectionId: string;
}

export interface IntegrationConnection {
  id: string;
  provider: IntegrationProvider;
  organizationId: string;
  storeId: string;
  externalAccountId: string;
  status: 'connected' | 'expired' | 'reauthorization_required' | 'error' | 'disconnected';
  scopes: readonly string[];
  expiresAt: string | null;
}

export interface CanonicalProduct {
  externalId: string;
  title: string;
  sku: string | null;
  price: number | null;
  currency: string | null;
  availableQuantity: number | null;
  status: string | null;
}

export interface CanonicalOrder {
  externalId: string;
  status: string;
  currency: string | null;
  totalAmount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CanonicalInventory {
  externalProductId: string;
  quantity: number;
  updatedAt: string | null;
}

export interface CanonicalCustomer {
  externalId: string;
  displayName: string | null;
  email: string | null;
}

export interface IntegrationPage<T> {
  items: readonly T[];
  nextCursor: string | null;
}

export interface IntegrationError {
  provider: IntegrationProvider;
  code: string;
  message: string;
  retryable: boolean;
  status: number | null;
}
