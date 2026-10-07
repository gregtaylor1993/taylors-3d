// Local home-control catalogue from the existing @mdi/js 7.4.47 dependency
// (Material Design Icons, Apache-2.0). Explicit imports keep the bundle small.
// HA's complete mdi: namespace remains available through the advanced text field.
import { mdiMovie, mdiWeatherNight, mdiWeatherSunny, mdiLightbulb, mdiLightbulbGroup,
  mdiCeilingLight, mdiFloorLamp, mdiLedStripVariant, mdiPower, mdiPowerPlug,
  mdiHome, mdiHomeOutline, mdiDoor, mdiDoorOpen, mdiDoorClosed, mdiGarage,
  mdiWindowClosed, mdiWindowOpen, mdiCurtains, mdiBlinds, mdiLock, mdiLockOpen,
  mdiShieldHome, mdiShieldCheck, mdiBell, mdiCamera, mdiCctv, mdiMotionSensor,
  mdiSmokeDetector, mdiWaterAlert, mdiThermometer, mdiRadiator, mdiAirConditioner,
  mdiFan, mdiFire, mdiWater, mdiLeaf, mdiTree, mdiFlower, mdiWeatherCloudy,
  mdiWeatherRainy, mdiSnowflake, mdiSunClock, mdiMusic, mdiPlay, mdiPause,
  mdiSpeaker, mdiTelevision, mdiVolumeHigh, mdiSofa, mdiBed, mdiSilverwareForkKnife,
  mdiShower, mdiDesk, mdiWashingMachine, mdiTumbleDryer, mdiRobotVacuum,
  mdiRobotMower, mdiHomeImportOutline, mdiCar, mdiCarElectric, mdiBattery,
  mdiEvStation, mdiAccount, mdiAccountGroup, mdiMapMarker, mdiMap,
  mdiViewDashboard, mdiViewGrid, mdiLayers, mdiCameraOutline, mdiArrowUp,
  mdiCog, mdiStar, mdiHeart, mdiGestureTapButton } from '../node_modules/@mdi/js/mdi.js';

const paths = { mdiMovie, mdiWeatherNight, mdiWeatherSunny, mdiLightbulb, mdiLightbulbGroup,
  mdiCeilingLight, mdiFloorLamp, mdiLedStripVariant, mdiPower, mdiPowerPlug,
  mdiHome, mdiHomeOutline, mdiDoor, mdiDoorOpen, mdiDoorClosed, mdiGarage,
  mdiWindowClosed, mdiWindowOpen, mdiCurtains, mdiBlinds, mdiLock, mdiLockOpen,
  mdiShieldHome, mdiShieldCheck, mdiBell, mdiCamera, mdiCctv, mdiMotionSensor,
  mdiSmokeDetector, mdiWaterAlert, mdiThermometer, mdiRadiator, mdiAirConditioner,
  mdiFan, mdiFire, mdiWater, mdiLeaf, mdiTree, mdiFlower, mdiWeatherCloudy,
  mdiWeatherRainy, mdiSnowflake, mdiSunClock, mdiMusic, mdiPlay, mdiPause,
  mdiSpeaker, mdiTelevision, mdiVolumeHigh, mdiSofa, mdiBed, mdiSilverwareForkKnife,
  mdiShower, mdiDesk, mdiWashingMachine, mdiTumbleDryer, mdiRobotVacuum,
  mdiRobotMower, mdiHomeImportOutline, mdiCar, mdiCarElectric, mdiBattery,
  mdiEvStation, mdiAccount, mdiAccountGroup, mdiMapMarker, mdiMap,
  mdiViewDashboard, mdiViewGrid, mdiLayers, mdiCameraOutline, mdiArrowUp,
  mdiCog, mdiStar, mdiHeart, mdiGestureTapButton };
export const CUSTOM_CONTROL_ICONS = Object.freeze(Object.entries(paths).map(([key, path]) => {
  const name = key.slice(3).replace(/[A-Z]/g, (letter, index) => `${index ? '-' : ''}${letter.toLowerCase()}`);
  return Object.freeze({ icon: `mdi:${name}`, name: name.replaceAll('-', ' '), path });
}));

export function searchCustomControlIcons(query = '') {
  const words = String(query).toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return CUSTOM_CONTROL_ICONS.filter((entry) => words.every((word) => `${entry.icon} ${entry.name}`.includes(word)));
}
