import type {
  CanonicalCustomer,
  CanonicalInventory,
  CanonicalOrder,
  CanonicalProduct,
  IntegrationConnection,
  IntegrationContext,
  IntegrationPage
} from './types';

export interface EcommerceIntegration {
  readonly provider: IntegrationConnection['provider'];

  authenticate(input: { redirectUri: string; state: string }): Promise<string>;

  refreshToken(context: IntegrationContext): Promise<void>;

  getProducts(
    context: IntegrationContext,
    cursor?: string
  ): Promise<IntegrationPage<CanonicalProduct>>;

  getOrders(context: IntegrationContext, cursor?: string): Promise<IntegrationPage<CanonicalOrder>>;

  getInventory(
    context: IntegrationContext,
    cursor?: string
  ): Promise<IntegrationPage<CanonicalInventory>>;

  getCustomers?(
    context: IntegrationContext,
    cursor?: string
  ): Promise<IntegrationPage<CanonicalCustomer>>;

  subscribeWebhooks?(context: IntegrationContext): Promise<void>;
}
