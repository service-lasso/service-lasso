import type { SpawnOptions } from "node:child_process";
import type { Readable, Writable } from "node:stream";

// This is the actual surface consumed by the execution supervisor. A native
// fixture adapter must implement these semantics; it is not a ChildProcess
// impersonation and cannot obtain authority from a PID-shaped object.
export interface ManagedChildEvents {
  spawn: [];
  error: [error: Error];
  exit: [code: number | null, signal: NodeJS.Signals | null];
  close: [code: number | null, signal: NodeJS.Signals | null];
}

export interface ManagedChildHandle {
  readonly pid: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  on<Event extends keyof ManagedChildEvents>(
    event: Event,
    listener: (...args: ManagedChildEvents[Event]) => void,
  ): this;
  once<Event extends keyof ManagedChildEvents>(
    event: Event,
    listener: (...args: ManagedChildEvents[Event]) => void,
  ): this;
  prependOnceListener<Event extends keyof ManagedChildEvents>(
    event: Event,
    listener: (...args: ManagedChildEvents[Event]) => void,
  ): this;
  removeListener<Event extends keyof ManagedChildEvents>(
    event: Event,
    listener: (...args: ManagedChildEvents[Event]) => void,
  ): this;
  // probe0 must observe the held native lifetime now. Unknown/control failure
  // emits error synchronously (or throws), preserving the supervisor's probe
  // listener. A signal request returning true never proves exit or stream EOF.
  kill(signal: 0 | "SIGTERM" | "SIGKILL"): boolean;
}

export type ManagedProcessSpawner = (
  executable: string,
  args: readonly string[],
  options: SpawnOptions,
) => ManagedChildHandle;
