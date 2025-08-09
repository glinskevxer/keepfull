import { AppContext, currentDay } from './context';
import { BurnModel, fitBurnModel } from '../core/burn-model';
import { DayKey, addDays, daysBetween } from '../util/dates';
import { Forecast, projectTank } from '../core/forecast';
import { InsufficientHistoryError, NoStartingPointError } from '../core/errors';
import { IntervalResult, buildFillIntervals } from '../core/fill-intervals';
import { Percent, percent } from '../core/units';
import { Tank } from '../model/tank';
import { gaugeFor, gallonsAt } from '../core/tank-math';
import { isMeasured } from '../model/reading';

/**
 * Puts the burn model and the projection together for a real tank.
 *
 * The interesting part is not the arithmetic, it is deciding what the tank is
 * holding right now. There are three possible answers and they are tried in
 * order: a measured gauge reading, the last fill if it topped the tank out, or
 * nothing, in which case there is no forecast and dispatch is told why rather
 * than being handed a confident guess.
 */

export type StartingPointSource = 'reading' | 'last_fill';

export interface StartingPoint {
  readonly day: DayKey;
  readonly gauge: Percent;
  readonly source: StartingPointSource;
  readonly ageInDays: number;
}

export interface TankForecast {
  readonly tank: Tank;
  readonly model: BurnModel;
  readonly intervals: IntervalResult;
  readonly startingPoint: StartingPoint;
  readonly forecast: Forecast;
}

export interface ForecastRequest {
  readonly asOf?: DayKey;
  readonly horizonDays?: number;
  /** How far back to read weather when fitting the model. */
  readonly historyDays?: number;
}

export class ForecastingService {
  constructor(private readonly context: AppContext) {}

  /**
   * Finds where the tank stands. A measured reading wins if there is one; a fill
   * that topped the tank out is the fallback because at least the level then is
   * known exactly.
   */
  startingPoint(tankId: string, asOf: DayKey): StartingPoint {
    const tank = this.context.tanks.get(tankId);
    const reading = this.context.readings.latestFor(tankId, { measuredOnly: true, asOf });
    const lastFill = this.context.deliveries.lastDeliveryFor(tankId);

    const fillIsUsable =
      lastFill !== undefined && lastFill.deliveredOn <= asOf && lastFill.gaugeAfter !== undefined;

    if (reading && isMeasured(reading)) {
      if (!fillIsUsable || reading.takenOn >= (lastFill?.deliveredOn as DayKey)) {
        return {
          day: reading.takenOn,
          gauge: reading.gauge,
          source: 'reading',
          ageInDays: daysBetween(reading.takenOn, asOf),
        };
      }
    }
    if (fillIsUsable && lastFill) {
      return {
        day: lastFill.deliveredOn,
        gauge: lastFill.gaugeAfter as Percent,
        source: 'last_fill',
        ageInDays: daysBetween(lastFill.deliveredOn, asOf),
      };
    }
    throw new NoStartingPointError(tank.id);
  }

  /** Fits the burn model for one tank from its ticket history and its station weather. */
  burnModel(
    tankId: string,
    request: ForecastRequest = {},
  ): { model: BurnModel; intervals: IntervalResult } {
    const tank = this.context.tanks.get(tankId);
    const customer = this.context.customers.get(tank.customerId);
    const asOf = request.asOf ?? currentDay(this.context);
    const historyDays = request.historyDays ?? 900;
    const ledger = this.context.weather.loadLedger(
      customer.stationId,
      addDays(asOf, -historyDays),
      asOf,
    );
    const deliveries = this.context.deliveries.historyForTank(tankId);
    const intervals = buildFillIntervals(deliveries, ledger, tank.geometry.fillLimit);
    const model = fitBurnModel(intervals.intervals, tankId);
    return { model, intervals };
  }

  /** The whole picture for one tank: model, where it stands, and where it is going. */
  forTank(tankId: string, request: ForecastRequest = {}): TankForecast {
    const tank = this.context.tanks.get(tankId);
    const customer = this.context.customers.get(tank.customerId);
    const asOf = request.asOf ?? currentDay(this.context);
    const { model, intervals } = this.burnModel(tankId, request);
    const startingPoint = this.startingPoint(tankId, asOf);

    const ledger = this.context.weather.loadLedger(
      customer.stationId,
      startingPoint.day,
      addDays(asOf, 1),
    );
    const normals = this.context.weather.loadNormals(customer.stationId);
    const forecast = projectTank(
      tankId,
      tank.geometry,
      model,
      startingPoint.day,
      startingPoint.gauge,
      ledger,
      normals,
      { horizonDays: request.horizonDays ?? 120 },
    );
    return { tank, model, intervals, startingPoint, forecast };
  }

  /** What the tank is thought to hold today, in gallons. */
  estimatedGallons(tankId: string, request: ForecastRequest = {}): number {
    const asOf = request.asOf ?? currentDay(this.context);
    const result = this.forTank(tankId, request);
    const onDay = result.forecast.days.find((day) => day.day === asOf);
    if (onDay) {
      return onDay.gallonsRemaining;
    }
    return gallonsAt(result.tank.geometry, result.startingPoint.gauge);
  }

  estimatedGauge(tankId: string, request: ForecastRequest = {}): Percent {
    const result = this.forTank(tankId, request);
    return gaugeFor(result.tank.geometry, this.estimatedGallons(tankId, request) as never);
  }

  /** Runs a forecast and swallows the two failures that just mean "not enough data". */
  tryForTank(tankId: string, request: ForecastRequest = {}): TankForecast | undefined {
    try {
      return this.forTank(tankId, request);
    } catch (error) {
      if (error instanceof InsufficientHistoryError || error instanceof NoStartingPointError) {
        this.context.logger.debug('no forecast for tank', { tankId, reason: String(error) });
        return undefined;
      }
      throw error;
    }
  }

  /** Writes the projection back as estimated readings, so the office screen has numbers. */
  writeEstimates(tankId: string, request: ForecastRequest = {}): number {
    const result = this.tryForTank(tankId, request);
    if (!result) {
      return 0;
    }
    this.context.readings.clearEstimates(tankId);
    const rows = result.forecast.days.map((day) => ({
      id: this.context.ids.next('est'),
      tankId,
      takenOn: day.day,
      gauge: percent(Math.round(day.gauge * 10) / 10),
      source: 'estimated' as const,
    }));
    return this.context.readings.recordMany(rows);
  }
}
