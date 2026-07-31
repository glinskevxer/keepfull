import { JobRegistry } from './runner';
import { auditRetention } from './audit-retention';
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
    .register(coldSnap)
    .register(auditRetention);
}

export {
  auditRetention,
  coldSnap,
  monitorHealth,
  nightlyForecast,
  refreshNormals,
  retention,
  weatherIngest,
};
