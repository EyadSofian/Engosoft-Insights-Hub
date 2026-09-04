import { WebchatProvider } from "@botpress/webchat";
import { NEXUS_CLIENT_ID, nexusStorageKey } from "./lib/nexus-config";
import { NexusPanel } from "./NexusPanel";

/**
 * The Botpress half of ENGO Nexus: the provider and the panel it feeds.
 *
 * This module is loaded lazily and — once loaded — stays mounted for the rest
 * of the session, even while the panel is closed. That is deliberate on both
 * counts:
 *
 *  - LAZY, because the Botpress SDK is ~950 kB uncompressed. Importing it from
 *    the eagerly-mounted root pushed this dashboard's initial bundle from
 *    687 kB to 1,639 kB (214 → 487 kB gzip) — a 2.3× regression paid by every
 *    manager opening a report, most of whom never open the assistant. Measured,
 *    not estimated.
 *  - PERSISTENT, because the provider owns the socket and the message history.
 *    Unmounting it on close would drop the connection and force a reconnect and
 *    a history refetch every single time the panel is reopened.
 *
 * The panel itself renders nothing while closed, so keeping this mounted costs
 * an open websocket and nothing else.
 */
export function NexusSession() {
  return (
    <WebchatProvider
      clientId={NEXUS_CLIENT_ID}
      storageKey={nexusStorageKey()}
      storageLocation="localStorage"
    >
      <NexusPanel />
    </WebchatProvider>
  );
}
