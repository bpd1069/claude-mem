import { readJsonFromStdin } from './stdin-reader.js';
import { getPlatformAdapter } from './adapters/index.js';
import { getEventHandler } from './handlers/index.js';
import { HOOK_EXIT_CODES } from '../shared/hook-constants.js';

export async function hookCommand(platform: string, event: string): Promise<void> {
  try {
    const adapter = getPlatformAdapter(platform);
    const handler = getEventHandler(event);

    const rawInput = await readJsonFromStdin();
    const input = adapter.normalizeInput(rawInput);
    input.platform = platform;  // Inject platform for handler-level decisions
    const result = await handler.execute(input);
    const output = adapter.formatOutput(result);

    console.log(JSON.stringify(output));
    process.exit(result.exitCode ?? HOOK_EXIT_CODES.SUCCESS);
  } catch (error) {
    // Log for diagnostics but exit gracefully to avoid ugly errors in Claude Code
    // Per project exit code strategy: exit 0 for graceful failures
    console.error(`Hook error: ${error}`);
    process.exit(HOOK_EXIT_CODES.SUCCESS);  // = 0
  }
}
