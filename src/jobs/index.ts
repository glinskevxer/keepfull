import { JobRegistry } from './runner';
import { coldSnap } from './cold-snap';
import { monitorHealth } from './monitor-health';
import { nightlyForecast } from './nightly-forecast';
import { refreshNormals } from './refresh-normals';
import { retention } from './retention';
import { weatherIngest } from './weather-ingest';

/** Everything cron can ask for, in one place. */
export function buildJobRegistry(): JobRegistry {
  return new JobRegistry()
    .register(weatherIngest)
    .register(nightlyForecast)
    .register(monitorHealth)
    .register(retention)
    .register(refreshNormals)
    .register(coldSnap);
}

export { coldSnap, monitorHealth, nightlyForecast, refreshNormals, retention, weatherIngest };
