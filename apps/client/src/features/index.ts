import type { GameFeature } from '../core/GameFeature';
import { AttachmentsFeature } from './AttachmentsFeature';
import { ChatFeature } from './ChatFeature';
import { ConnectionFeature } from './ConnectionFeature';
import { GlossaryFeature } from './GlossaryFeature';
import { PlayersFeature } from './PlayersFeature';
import { ObjectivesFeature } from './ObjectivesFeature';
import { ProgressFeature } from './ProgressFeature';
import { MovesFeature } from './MovesFeature';
import { RewardsFeature } from './RewardsFeature';
import { TeamsFeature } from './TeamsFeature';

/**
 * Features that run for the whole play session, across scene changes.
 * To add one, write a GameFeature and add it here.
 */
export function gameFeatures(): GameFeature[] {
  return [new ConnectionFeature(), new ChatFeature(), new ObjectivesFeature(), new AttachmentsFeature(), new ProgressFeature(), new RewardsFeature(), new MovesFeature(), new PlayersFeature(), new TeamsFeature(), new GlossaryFeature()];
}
