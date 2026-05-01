# keepfull

Delivery forecasting and dispatch for a bulk propane dealer.

This is the system that decides which tanks get a truck tomorrow. It fits a
burn rate to every tank from its own fill history and the weather at its own
station, projects each one forward day by day, and fills the trucks urgency
first. It also does the parts either side of that: posting tickets, pricing
them, reconciling the day against the plant meter, and keeping the leak checks
and meter seals from going out of date.

## Why it works the way it does

The old rule of thumb in this trade is a single K factor, degree days per
gallon, fitted off the last two fills. That works until a house has propane hot
water, which burns a gallon and a half a day in July when there are no degree
days at all. So the model here has two terms:

    gallons = base gallons a day x days + weather gallons per degree day x degree days

Everything else follows from taking that seriously. Only fills that topped a
tank out can anchor an interval, because a fill that stopped short leaves the
next stretch starting from a level nobody wrote down. The weather is per
station, because the ridge and the lake shore differ by several hundred degree
days across a winter. And a forecast always reports how it got there, because a
bare reserve date gets trusted far more than it deserves.

## Running it

```
npm ci
cp .env.example .env        # then fill in the yard coordinates and api keys
npm run build
node dist/api/main.js
```

The process refuses to start without `YARD_LATITUDE`, `YARD_LONGITUDE` and, in
production, at least one api key. That is deliberate: a missing setting should
be a dead process at deploy time rather than a dead request in the middle of a
January afternoon.

To get a database worth looking at:

```
npm run cli -- admin seed --customers 40
npm run cli -- forecast due --window 7
npm run cli -- dispatch plan --window 5
```

## Layout

| directory | what is in it |
| --- | --- |
| `src/core` | the domain arithmetic, no io at all |
| `src/model` | the things the domain is about, and their invariants |
| `src/db` | sqlite, migrations and one repository per table |
| `src/service` | the use cases, which is where io and arithmetic meet |
| `src/api` | fastify, one error shape, api key per caller |
| `src/cli` | the same services from a terminal |
| `src/jobs` | what cron runs at half past three |
| `tests` | unit, api, cli and one end to end delivery day |

## The nightly work

```
30 3 * * *  keepfull jobs run nightly-forecast
0  5 * * *  keepfull jobs run monitor-health
0  2 * * 0  keepfull jobs run retention
```

`jobs run` exits non zero if anything inside the job failed, so the wrapper
script does not have to read the output to know something wants looking at.

## Commands

<!-- commands:start -->

### `keepfull tanks`

look at tanks and their gauges

| command | what it does |
| --- | --- |
| `tanks list [options]` | list tanks, newest gauge reading first |
| `tanks show [options] <tankId>` | everything known about one tank |

### `keepfull forecast`

burn rates and projected reserve days

| command | what it does |
| --- | --- |
| `forecast tank [options] <tankId>` | project one tank forward |
| `forecast due [options]` | tanks due inside a window, soonest first |

### `keepfull dispatch`

plan and commit a day of routes

| command | what it does |
| --- | --- |
| `dispatch plan [options]` | show what tomorrow would look like without saving it |
| `dispatch commit [options]` | turn the plan into routes somebody drives |
| `dispatch sheet [options] <routeId>` | print the sheet a driver takes with them |

### `keepfull weather`

stations, observations and degree days

| command | what it does |
| --- | --- |
| `weather stations [options]` | list the stations and how much weather each has |
| `weather import [options] <stationId> <file>` | load a csv of day,high,low into a station |
| `weather degree-days [options] <stationId>` | degree days over a range, with the gaps named |

### `keepfull admin`

database and configuration housekeeping

| command | what it does |
| --- | --- |
| `admin status [options]` | what this process is pointed at and what shape it is in |
| `admin migrations [options]` | what has been applied and what has not |
| `admin seed [options]` | fill an empty database with a yard that behaves like the real one |
| `admin compact [options]` | reclaim space and refresh the query planner statistics |
| `admin purge-readings [options] <before>` | drop gauge readings older than a day |

### `keepfull jobs`

the nightly work

| command | what it does |
| --- | --- |
| `jobs list [options]` | what cron can ask for |
| `jobs run [options] <name>` | run one job |

### `keepfull reports`

gallons, seasons and how the trucks did

| command | what it does |
| --- | --- |
| `reports gallons [options]` | gallons by month or by heating season |
| `reports seasons [options] <stationId>` | gallons against degree days, season by season |
| `reports meter-accuracy [options]` | how far the gauges and the meters disagree |
| `reports routes [options]` | planned against delivered |

### `keepfull sizing`

is the tank big enough for what is on it

| command | what it does |
| --- | --- |
| `sizing tank [options] <tankId>` | check one tank against a design day |
| `sizing quote [options] <appliances>` | what tank a comma separated appliance list needs |
| `sizing undersized [options]` | every tank on the book that cannot carry its own load |

### `keepfull loads`

plant loads and the daily reconciliation

| command | what it does |
| --- | --- |
| `loads record [options] <truckId> <gallons> <temperature> <meterStart>` | record a load off the plant meter |
| `loads close [options] <loadId> <meterEnd>` | close a shift with the truck meter reading |
| `loads reconcile [options]` | reconcile a day across every truck that loaded |
| `loads drift [options] <truckId>` | has this truck meter been off the same way for a while |

### `keepfull tickets`

delivery tickets off the handhelds

| command | what it does |
| --- | --- |
| `tickets import [options] <file>` | load a csv of tickets, one transaction per row |

### `keepfull readings`

tank monitor telemetry

| command | what it does |
| --- | --- |
| `readings import [options] <file>` | load the monitor vendor daily export |
| `readings unmatched [options]` | tanks that carry a monitor which has never reported |

### `keepfull budgets`

levelised payment plans

| command | what it does |
| --- | --- |
| `budgets open [options] <customerId>` | open a plan for an account |
| `budgets show [options] <planId>` | a plan and how it is tracking |
| `budgets pay [options] <planId> <number> <amount>` | record a payment against an instalment |
| `budgets settle [options] <planId>` | close a plan out against what was actually burned |
| `budgets at-risk [options]` | open plans heading for a settlement nobody expects |

### `keepfull exceptions`

everything that needs looking at, worst first

<!-- commands:end -->

## Development

```
npm run check       # everything ci runs, in the order ci runs it
npm test
npm run coverage
npm run commands    # regenerate the command reference above
```
