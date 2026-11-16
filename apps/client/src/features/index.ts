import type { GameFeature } from '../core/GameFeature';
import { AttachmentsFeature } from './AttachmentsFeature';
import { ChatFeature } from './ChatFeature';
import { ConnectionFeature } from './ConnectionFeature';
import { ObjectivesFeature } from './ObjectivesFeature';
import { ProgressFeature } from './ProgressFeature';
import { RewardsFeature } from './RewardsFeature';

/**
 * Features that run for the whole play session, across scene changes.
 * To add one, write a GameFeature and add it here.
 */
export function gameFeatures(): GameFeature[] {
  return [new ConnectionFeature(), new ChatFeature(), new ObjectivesFeature(), new AttachmentsFeature(), new ProgressFeature(), new RewardsFeature()];
}
