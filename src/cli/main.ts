import { defaultDeps, run } from './program';
import { describeError } from '../core/errors';

/** The binary. Everything interesting is in `program.ts` so it can be tested. */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const deps = defaultDeps();
  const result = await run(argv, deps);
  return result.code;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${describeError(error)}\n`);
      process.exitCode = 1;
    });
}
