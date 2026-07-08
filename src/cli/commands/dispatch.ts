import { Command } from 'commander';
import { CliDeps, globalOptionsOf } from '../program';
import { Column, emit, gallons, table } from '../output';
import { DispatchService } from '../../service/dispatch';
import { RoutingService } from '../../service/routing';
import { dayKey } from '../../util/dates';
import { describeContact, siteContact } from '../../model/contact';

/**
 * Dispatch from the terminal. `plan` is what the cron runs at four in the
 * morning so there is a sheet waiting when the dispatcher gets in.
 */
export function registerDispatchCommands(program: Command, deps: CliDeps): void {
  const dispatch = program.command('dispatch').description('plan and commit a day of routes');

  dispatch
    .command('plan')
    .description('show what tomorrow would look like without saving it')
    .option('--as-of <day>', 'pretend today is this day')
    .option('--window <days>', 'how far ahead counts as due', '5')
    .action((options: { asOf?: string; window: string }) => {
      const { context } = deps.runtime();
      const service = new DispatchService(context, deps.settings().yard);
      const plan = service.plan({
        ...(options.asOf ? { asOf: dayKey(options.asOf) } : {}),
        windowDays: Number(options.window),
      });
      emit(deps.writer, globalOptionsOf(dispatch).format, plan, () => {
        const blocks = plan.plan.routes.map((route) => {
          const columns: Column<(typeof route.stops)[number]>[] = [
            { header: 'tank', get: (stop) => stop.tankId },
            { header: 'gallons', get: (stop) => gallons(stop.gallons), align: 'right' },
            { header: 'days left', get: (stop) => String(stop.urgency), align: 'right' },
            { header: 'overdue', get: (stop) => (stop.overdue ? 'yes' : '') },
          ];
          return [
            `truck ${route.truckId}: ${route.stops.length} stops, ${gallons(route.plannedGallons)} gal, ` +
              `${route.miles.toFixed(1)} miles, ${(route.utilisation * 100).toFixed(0)}% loaded`,
            table(route.stops, columns),
          ].join('\n');
        });
        if (plan.plan.deferred.length > 0) {
          blocks.push(
            `deferred: ${plan.plan.deferred
              .map((entry) => `${entry.stop.tankId} (${entry.reason})`)
              .join(', ')}`,
          );
        }
        return blocks.length > 0 ? blocks.join('\n\n') : 'nothing due';
      });
    });

  dispatch
    .command('commit')
    .description('turn the plan into routes somebody drives')
    .option('--as-of <day>', 'pretend today is this day')
    .option('--window <days>', 'how far ahead counts as due', '5')
    .option('--run-on <day>', 'the day the routes run')
    .option('--driver <pair...>', 'truckId=driverId, repeatable')
    .option('--replace', 'throw away any planned route already on that day', false)
    .action(
      (options: {
        asOf?: string;
        window: string;
        runOn?: string;
        driver?: string[];
        replace: boolean;
      }) => {
        const { context } = deps.runtime();
        const service = new DispatchService(context, deps.settings().yard);
        const routing = new RoutingService(context);
        const plan = service.plan({
          ...(options.asOf ? { asOf: dayKey(options.asOf) } : {}),
          windowDays: Number(options.window),
        });
        const drivers: Record<string, string> = {};
        for (const pair of options.driver ?? []) {
          const [truckId, driverId] = pair.split('=');
          if (!truckId || !driverId) {
            throw new Error(`--driver wants truckId=driverId, got "${pair}"`);
          }
          drivers[truckId] = driverId;
        }
        const routes = routing.commit(plan, {
          ...(options.runOn ? { runOn: dayKey(options.runOn) } : {}),
          ...(Object.keys(drivers).length > 0 ? { drivers } : {}),
          replaceExisting: options.replace,
        });
        emit(deps.writer, globalOptionsOf(dispatch).format, routes, () =>
          routes.length === 0
            ? 'nothing to commit'
            : routes
                .map(
                  (route) =>
                    `${route.id}  truck ${route.truckId}  ${route.runOn}  ` +
                    `${route.stops.length} stops  ${gallons(route.plannedGallons)} gal`,
                )
                .join('\n'),
        );
      },
    );

  dispatch
    .command('sheet <routeId>')
    .description('print the sheet a driver takes with them')
    .action((routeId: string) => {
      const { context } = deps.runtime();
      const route = context.routes.get(routeId);
      const rows = route.stops.map((stop) => {
        const customer = context.customers.get(stop.customerId);
        const tank = context.tanks.get(stop.tankId);
        // The site contact, not the billing one. A driver at a locked gate
        // ringing the person who pays the bill four hundred miles away is the
        // failure this column exists to stop.
        const contact = siteContact(context.contacts.forCustomer(customer.id));
        return {
          position: stop.position,
          name: customer.serviceName,
          address: `${customer.address.line1}, ${customer.address.town}`,
          tank: tank.serialNumber,
          gallons: stop.plannedGallons,
          outcome: stop.outcome,
          contact: contact ? describeContact(contact) : '',
          notes: [tank.notes, stop.note].filter((entry) => entry).join('; '),
        };
      });
      const columns: Column<(typeof rows)[number]>[] = [
        { header: '#', get: (row) => String(row.position), align: 'right' },
        { header: 'account', get: (row) => row.name },
        { header: 'address', get: (row) => row.address },
        { header: 'tank', get: (row) => row.tank },
        { header: 'gallons', get: (row) => gallons(row.gallons), align: 'right' },
        { header: 'outcome', get: (row) => row.outcome },
        { header: 'ring', get: (row) => row.contact },
        { header: 'notes', get: (row) => row.notes },
      ];
      emit(deps.writer, globalOptionsOf(dispatch).format, { route, rows }, () =>
        [
          `route ${route.id}  truck ${route.truckId}  ${route.runOn}  ${route.status}`,
          `planned ${gallons(route.plannedGallons)} gal over ${route.plannedMiles.toFixed(1)} miles`,
          '',
          table(rows, columns),
        ].join('\n'),
      );
    });
}
