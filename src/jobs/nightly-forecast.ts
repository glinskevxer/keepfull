import { ForecastingService } from '../service/forecasting';
import { Job, JobContext, JobReport } from './runner';
import { isForecast } from '../model/customer';

/**
 * Refits every tank and writes its projection back as estimated readings.
 *
 * This runs at half past three, after the weather pull and before anybody is
 * in. Nothing in the system needs it to have run: the api recomputes on demand.
 * What it buys is that the office screen opens instantly at seven instead of
 * refitting nine hundred burn models while somebody watches a spinner.
 */
export const nightlyForecast: Job = {
  name: 'nightly-forecast',
  description: 'refit every burn model and store the projections',

  run(context: JobContext, report: JobReport): void {
    const forecasting = new ForecastingService(context.app);
    const tanks = context.app.tanks.list({ inServiceOnly: true });
    report.note('tanksConsidered', tanks.length);

    let withReserveDay = 0;
    let unforecastable = 0;

    for (const tank of tanks) {
      report.attempt(tank.id, () => {
        const customer = context.app.customers.get(tank.customerId);
        if (!isForecast(customer)) {
          return false;
        }
        if (customer.closedOn !== undefined && customer.closedOn < context.today) {
          return false;
        }
        const result = forecasting.tryForTank(tank.id, { asOf: context.today });
        if (!result) {
          unforecastable += 1;
          return false;
        }
        if (result.forecast.reserveDay !== undefined) {
          withReserveDay += 1;
        }
        if (context.dryRun) {
          return true;
        }
        forecasting.writeEstimates(tank.id, { asOf: context.today });
        return true;
      });
    }

    report.note('withReserveDay', withReserveDay);
    report.note('unforecastable', unforecastable);
  },
};
