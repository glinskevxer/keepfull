import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { Column, emit, gallons, table } from '../output';
import { ReconciliationService } from '../../service/reconciliation';
import { addDays, dayKey } from '../../util/dates';
import { currentDay } from '../../service/context';
import { makeTruckLoad } from '../../model/truck-load';

/** The plant end of the day, and the reconciliation that closes it out. */
export function registerLoadCommands(program: Command, deps: CliDeps): void {
  const loads = program.command('loads').description('plant loads and the daily reconciliation');

  loads
    .command('record <truckId> <gallons> <temperature> <meterStart>')
    .description('record a load off the plant meter')
    .option('--on <day>', 'the day it loaded')
    .option('--driver <id>', 'who took it')
    .action(
      (
        truckId: string,
        gallonsText: string,
        temperature: string,
        meterStart: string,
        options: { on?: string; driver?: string },
      ) => {
        const { context } = deps.runtime();
        context.fleet.getTruck(truckId);
        const loadedOn = options.on ? dayKey(options.on) : currentDay(context);
        const load = makeTruckLoad({
          id: context.ids.next('ld'),
          truckId,
          ...(options.driver ? { driverId: options.driver } : {}),
          loadedOn,
          sequence: context.loads.nextSequence(truckId, loadedOn),
          plantGross: Number(gallonsText),
          plantTemperature: Number(temperature),
          meterStart: Number(meterStart),
        });
        context.loads.insert(load);
        emit(
          deps.writer,
          globalOptionsOf(loads).format,
          load,
          () =>
            `${load.id}  ${load.truckId}  ${load.loadedOn}  load ${load.sequence}  ` +
            `${gallons(load.plantGross)} gross, ${gallons(load.plantNet)} net`,
        );
      },
    );

  loads
    .command('close <loadId> <meterEnd>')
    .description('close a shift with the truck meter reading')
    .action((loadId: string, meterEnd: string) => {
      const { context } = deps.runtime();
      const load = context.loads.closeShift(loadId, Number(meterEnd));
      emit(
        deps.writer,
        globalOptionsOf(loads).format,
        load,
        () =>
          `${load.id} closed, ${gallons((load.meterEnd as number) - load.meterStart)} gallons metered out`,
      );
    });

  loads
    .command('reconcile')
    .description('reconcile a day across every truck that loaded')
    .option('--day <day>', 'the day to close out')
    .action((options: { day?: string }) => {
      const { context } = deps.runtime();
      const service = new ReconciliationService(context);
      const day = options.day ? dayKey(options.day) : currentDay(context);
      const rows = service.forDay(day);
      const columns: Column<(typeof rows)[number]>[] = [
        { header: 'truck', get: (row) => row.truckId },
        { header: 'loads', get: (row) => String(row.loads), align: 'right' },
        { header: 'plant', get: (row) => gallons(row.plantGallons), align: 'right' },
        {
          header: 'metered',
          get: (row) => (row.meteredGallons === null ? '-' : gallons(row.meteredGallons)),
          align: 'right',
        },
        { header: 'ticketed', get: (row) => gallons(row.ticketedGallons), align: 'right' },
        {
          header: 'meter gap',
          get: (row) => (row.plantVsMetered === null ? '-' : gallons(row.plantVsMetered)),
          align: 'right',
        },
        {
          header: 'paper gap',
          get: (row) => (row.meteredVsTicketed === null ? '-' : gallons(row.meteredVsTicketed)),
          align: 'right',
        },
        { header: 'verdict', get: (row) => row.verdict },
      ];
      emit(deps.writer, globalOptionsOf(loads).format, { day, rows }, () =>
        [`${day}`, table(rows, columns)].join('\n'),
      );
    });

  loads
    .command('drift <truckId>')
    .description('has this truck meter been off the same way for a while')
    .option('--from <day>', 'first day')
    .option('--to <day>', 'last day')
    .action((truckId: string, options: { from?: string; to?: string }) => {
      const { context } = deps.runtime();
      const service = new ReconciliationService(context);
      const to = options.to ? dayKey(options.to) : currentDay(context);
      const from = options.from ? dayKey(options.from) : addDays(to, -30);
      const report = service.drift(truckId, from, to);
      emit(deps.writer, globalOptionsOf(loads).format, report, () =>
        [
          `${truckId} over ${report.days} days`,
          `mean gap ${gallons(report.meanGap)} gallons, run of ${report.run}`,
          report.suspect
            ? `SUSPECT: the meter has read ${report.direction} for ${report.run} days running`
            : 'nothing worth pulling the meter for',
        ].join('\n'),
      );
    });
}
