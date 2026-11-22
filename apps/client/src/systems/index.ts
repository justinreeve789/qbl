import type { SceneSystemClass } from '../core/SceneRuntime';
import { AtmosphereSystem } from './AtmosphereSystem';
import { CameraSystem } from './CameraSystem';
import { DebugSystem } from './DebugSystem';
import { HotspotSystem } from './HotspotSystem';
import { LayerSystem } from './LayerSystem';
import { LightSystem } from './LightSystem';
import { LocalPlayerSystem } from './LocalPlayerSystem';
import { PreloadSystem } from './PreloadSystem';
import { PropsSystem } from './PropsSystem';
import { RemotePlayersSystem } from './RemotePlayersSystem';
import { SkySystem } from './SkySystem';
import { SpeechSystem } from './SpeechSystem';
import { WeatherSystem } from './WeatherSystem';
import { FlowSystem } from './FlowSystem';
import { StorySystem } from './StorySystem';

/**
 * The systems that make up a playing scene, in the order they are created
 * and updated. Order matters where one system reads another's result in the
 * same frame: the local player moves before hotspots check where it stands.
 *
 * To add a scene feature, write a SceneSystem and add its class here.
 */
export const sceneSystems: SceneSystemClass[] = [
  LayerSystem,
  FlowSystem,
  SkySystem,
  LightSystem,
  AtmosphereSystem,
  WeatherSystem,
  PropsSystem,
  RemotePlayersSystem,
  LocalPlayerSystem,
  HotspotSystem,
  SpeechSystem,
  CameraSystem,
  StorySystem,
  PreloadSystem,
  DebugSystem,
];
