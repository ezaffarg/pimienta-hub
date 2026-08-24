import 'server-only';

import {
  type BootstrapFirstOwnerOutcome,
  HubMembershipRepository
} from '@/infrastructure/database/repositories';
import { requireServerBootstrapContext } from './server-context';

export async function bootstrapFirstOwner(): Promise<{
  outcome: BootstrapFirstOwnerOutcome;
  membershipId: string;
}> {
  const context = await requireServerBootstrapContext();
  return new HubMembershipRepository().bootstrapFirstOwner(context.organizationId, context.userId);
}
