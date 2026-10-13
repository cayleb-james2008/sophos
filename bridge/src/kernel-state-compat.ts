export interface DaemonKernelNamespace {
  names: string[];
  imports: string[];
}

export interface DaemonKernelMetadata {
  running: boolean;
  namespace: DaemonKernelNamespace | null;
  executionCount?: number;
  diagnostic?: unknown;
}

/**
 * Read kernel metadata only when the connected daemon actually implements the
 * optional API. Older public Prime Agent releases have no such endpoint; in
 * that case return no metadata rather than inferring or fabricating a live
 * kernel state from transcript/tool availability.
 */
export async function readDaemonKernelState(connection: object): Promise<DaemonKernelMetadata | undefined> {
  const reader = (connection as { getKernelState?: unknown }).getKernelState;
  if (typeof reader !== "function") return undefined;
  return await reader.call(connection) as DaemonKernelMetadata;
}
