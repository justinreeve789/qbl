import type { SceneSystemClass } from '../core/SceneRuntime';
import { CameraSystem } from './CameraSystem';
import { DebugSystem } from './DebugSystem';
import { HotspotSystem } from './HotspotSystem';
import { LayerSystem } from './LayerSystem';
import { LocalPlayerSystem } from './LocalPlayerSystem';
import { PhysicsSystem } from './PhysicsSystem';
import { PreloadSystem } from './PreloadSystem';
import { PropsSystem } from './PropsSystem';
import { RemotePlayersSystem } from './RemotePlayersSystem';
import { SpeechSystem } from './SpeechSystem';

/**
 * The systems that make up a playing scene, in the order they are created
 * and updated. Order matters where one system reads another's result in the
 * same frame: the local player moves before hotspots check where it stands.
 *
 * To add a scene feature, write a SceneSystem and add its class here.
 */
export const sceneSystems: SceneSystemClass[] = [
  LayerSystem,
  PropsSystem,
  RemotePlayersSystem,
  LocalPlayerSystem,
  HotspotSystem,
  PhysicsSystem,
  SpeechSystem,
  CameraSystem,
  PreloadSystem,
  DebugSystem,
];
