import { JobRegistry } from './runner';
import { monitorHealth } from './monitor-health';
import { nightlyForecast } from './nightly-forecast';
import { retention } from './retention';

/** Everything cron can ask for, in one place. */
export function buildJobRegistry(): JobRegistry {
  return new JobRegistry().register(nightlyForecast).register(monitorHealth).register(retention);
}

export { monitorHealth, nightlyForecast, retention };
