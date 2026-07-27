import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { Column, emit, gallons, table } from '../output';
import { Tank } from '../../model/tank';
import { gallonsAt, roomToFill } from '../../core/tank-math';

/** Reading commands for tanks. Nothing here writes. */
export function registerTankCommands(program: Command, deps: CliDeps): void {
  program
    .command('find <term>')
    .description('search accounts by name, account number, road or tank serial')
    .option('--limit <count>', 'how many to show', '25')
    .action(function (this: Command, term: string, options: { limit: string }) {
      const { context } = deps.runtime();
      const hits = context.customers.search(term, Number(options.limit));
      const columns: Column<(typeof hits)[number]>[] = [
        { header: 'account', get: (row) => row.customer.accountNumber },
        { header: 'name', get: (row) => row.customer.serviceName },
        {
          header: 'address',
          get: (row) => `${row.customer.address.line1}, ${row.customer.address.town}`,
        },
        { header: 'mode', get: (row) => row.customer.deliveryMode },
        { header: 'matched', get: (row) => row.matchedOn },
      ];
      emit(deps.writer, globalOptionsOf(this).format, hits, () => table(hits, columns));
    });

  const tanks = program.command('tanks').description('look at tanks and their gauges');

  tanks
    .command('list')
    .description('list tanks, newest gauge reading first')
    .option('--customer <id>', 'only this account')
    .option('--in-service', 'leave out tanks that have come out', false)
    .option('--monitored', 'only tanks with telemetry', false)
    .action((options: { customer?: string; inService: boolean; monitored: boolean }) => {
      const { context } = deps.runtime();
      const rows = context.tanks.list({
        ...(options.customer ? { customerId: options.customer } : {}),
        ...(options.inService ? { inServiceOnly: true } : {}),
        ...(options.monitored ? { monitoredOnly: true } : {}),
      });
      const withGauge = rows.map((tank) => {
        const reading = context.readings.latestFor(tank.id, { measuredOnly: true });
        return {
          tank,
          gauge: reading?.gauge ?? null,
          takenOn: reading?.takenOn ?? null,
        };
      });
      const columns: Column<(typeof withGauge)[number]>[] = [
        { header: 'tank', get: (row) => row.tank.id },
        { header: 'serial', get: (row) => row.tank.serialNumber },
        { header: 'size', get: (row) => String(row.tank.waterCapacity), align: 'right' },
        {
          header: 'gauge',
          get: (row) => (row.gauge === null ? '-' : `${row.gauge}`),
          align: 'right',
        },
        { header: 'read on', get: (row) => row.takenOn ?? '-' },
      ];
      emit(deps.writer, globalOptionsOf(tanks).format, withGauge, () => table(withGauge, columns));
    });

  tanks
    .command('show <tankId>')
    .description('everything known about one tank')
    .action((tankId: string) => {
      const { context } = deps.runtime();
      const tank: Tank = context.tanks.get(tankId);
      const customer = context.customers.get(tank.customerId);
      const reading = context.readings.latestFor(tank.id, { measuredOnly: true });
      const lastFill = context.deliveries.lastDeliveryFor(tank.id);
      const payload = {
        tank,
        customer: {
          id: customer.id,
          accountNumber: customer.accountNumber,
          name: customer.serviceName,
        },
        lastReading: reading ?? null,
        lastDelivery: lastFill ?? null,
        gallonsNow: reading ? gallonsAt(tank.geometry, reading.gauge) : null,
        roomToFill: reading ? roomToFill(tank.geometry, reading.gauge) : null,
      };
      emit(deps.writer, globalOptionsOf(tanks).format, payload, () => {
        const lines = [
          `tank      ${tank.id}  serial ${tank.serialNumber}`,
          `account   ${customer.accountNumber}  ${customer.serviceName}`,
          `size      ${tank.waterCapacity} gal, fill limit ${tank.geometry.fillLimit}%, reserve ${tank.geometry.reservePercent}%`,
          `set       ${tank.setting}, owned by ${tank.owner}`,
          `appliance ${tank.appliances.length > 0 ? tank.appliances.join(', ') : '(none recorded)'}`,
        ];
        if (reading) {
          lines.push(
            `gauge     ${reading.gauge}% on ${reading.takenOn} from ${reading.source}, ` +
              `${gallons(payload.gallonsNow ?? 0)} gal in, room for ${gallons(payload.roomToFill ?? 0)}`,
          );
        } else {
          lines.push('gauge     no measured reading on file');
        }
        lines.push(
          lastFill
            ? `last fill ${lastFill.deliveredOn}, ${gallons(lastFill.net)} net gal, ticket ${lastFill.ticketNumber}`
            : 'last fill never',
        );
        return lines.join('\n');
      });
    });
}
