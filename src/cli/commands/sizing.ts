import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { Column, emit, table } from '../output';
import { Appliance } from '../../model/tank';
import { SizingService } from '../../service/sizing';
import { fahrenheit, percent } from '../../core/units';

/** Sizing from the terminal, which is where the service desk actually works. */
export function registerSizingCommands(program: Command, deps: CliDeps): void {
  const sizing = program.command('sizing').description('is the tank big enough for what is on it');

  const optionsFrom = (options: { ambient?: string; downTo?: string }) => ({
    ...(options.ambient ? { ambient: fahrenheit(Number(options.ambient)) } : {}),
    ...(options.downTo ? { downToGauge: percent(Number(options.downTo)) } : {}),
  });

  sizing
    .command('tank <tankId>')
    .description('check one tank against a design day')
    .option('--ambient <degrees>', 'design air temperature')
    .option('--down-to <percent>', 'gauge it has to hold up to')
    .action((tankId: string, options: { ambient?: string; downTo?: string }) => {
      const service = new SizingService(deps.runtime().context);
      const verdict = service.forTank(tankId, optionsFrom(options));
      emit(deps.writer, globalOptionsOf(sizing).format, verdict, () =>
        [
          `tank        ${verdict.tankId}, ${verdict.waterCapacity} gallons`,
          `appliances  ${verdict.load.appliances}, largest ${verdict.load.largest ?? 'none'}`,
          `design load ${verdict.load.designBtuPerHour.toLocaleString('en-US')} btu/hr ` +
            `(${verdict.gallonsPerHour} gal/hr)`,
          `capacity    ${verdict.check.capacityBtuPerHour.toLocaleString('en-US')} btu/hr`,
          `verdict     ${verdict.undersized ? 'UNDERSIZED' : 'ok'}, headroom ` +
            `${(verdict.check.headroom * 100).toFixed(0)}%`,
          verdict.recommendedCapacity === undefined
            ? 'recommend   nothing on the yard covers this load'
            : `recommend   ${verdict.recommendedCapacity} gallons`,
        ].join('\n'),
      );
    });

  sizing
    .command('quote <appliances>')
    .description('what tank a comma separated appliance list needs')
    .option('--ambient <degrees>', 'design air temperature')
    .option('--down-to <percent>', 'gauge it has to hold up to')
    .action((appliances: string, options: { ambient?: string; downTo?: string }) => {
      const service = new SizingService(deps.runtime().context);
      const list = appliances
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0) as Appliance[];
      const result = service.forAppliances(list, optionsFrom(options));
      emit(deps.writer, globalOptionsOf(sizing).format, result, () =>
        [
          `connected   ${result.load.connectedBtuPerHour.toLocaleString('en-US')} btu/hr`,
          `design      ${result.load.designBtuPerHour.toLocaleString('en-US')} btu/hr`,
          result.recommendedCapacity === undefined
            ? 'recommend   nothing on the yard covers this load'
            : `recommend   ${result.recommendedCapacity} gallons`,
        ].join('\n'),
      );
    });

  sizing
    .command('undersized')
    .description('every tank on the book that cannot carry its own load')
    .option('--ambient <degrees>', 'design air temperature')
    .option('--down-to <percent>', 'gauge it has to hold up to')
    .action((options: { ambient?: string; downTo?: string }) => {
      const service = new SizingService(deps.runtime().context);
      const rows = service.undersizedTanks(optionsFrom(options));
      const columns: Column<(typeof rows)[number]>[] = [
        { header: 'tank', get: (row) => row.tankId },
        { header: 'size', get: (row) => String(row.waterCapacity), align: 'right' },
        { header: 'largest', get: (row) => row.load.largest ?? '-' },
        {
          header: 'design btu',
          get: (row) => row.load.designBtuPerHour.toLocaleString('en-US'),
          align: 'right',
        },
        {
          header: 'headroom',
          get: (row) => `${(row.check.headroom * 100).toFixed(0)}%`,
          align: 'right',
        },
        {
          header: 'needs',
          get: (row) =>
            row.recommendedCapacity === undefined ? 'n/a' : String(row.recommendedCapacity),
          align: 'right',
        },
      ];
      emit(deps.writer, globalOptionsOf(sizing).format, rows, () => table(rows, columns));
    });
}
