# @kushex/debug-events

A React library for viewing kushibot run traces, model context and chronological debug events. It contains no router, Redux store, network client, database or Cognition Panel dependency.

## Use in another project

Build and pack from this workspace:

```sh
pnpm --filter @kushex/debug-events build
pnpm -C packages/debug-events pack --pack-destination /tmp
```

Install the resulting tarball in your project along with the peer dependencies `react`, `react-dom` and `antd` (see package.json for supported versions).

```tsx
import { ConfigProvider } from "antd";
import { DebugEventsViewer, type RecordedDebugEventDto } from "@kushex/debug-events";
import "@kushex/debug-events/style.css";

export function RunDebug({ events }: { events: readonly RecordedDebugEventDto[] }) {
  return (
    <ConfigProvider>
      <div style={{ height: 700 }}>
        <DebugEventsViewer events={events} />
      </div>
    </ConfigProvider>
  );
}
```

Pass stored events in stream sequence order. Each item wraps a kushibot debug event with `streamId`, `sequence` and `recordedAtEpochMs`; the exported TypeScript types describe the complete shape. Supply a fresh array when events arrive. The viewer updates without fetching anything itself.

Optional props: `run` (`agentName`, `status`, `startedAt`), `loading`, `live`, `error`, `recording`, `recordingHelp`, `onRefresh`, `onBack`, and `backLabel`. Navigation and refresh controls appear only when their callbacks are provided. Use `key={runId}` when switching runs to reset view selection and filters.

The viewer follows Ant Design's `ConfigProvider` theme, including dark mode. Its CSS is bundled, uses a dedicated `kxd` utility prefix, and includes no global reset. No Tailwind setup is needed in the consuming project. Give its parent a height so the trace and event panes can scroll.

`buildTrace`, `traceStats` and `buildContextModel` are also exported for custom integrations. Cognition Panel's `DebugEventsScreen` is a small adapter that supplies events from its existing polling hook and handles its own routing.

## Validation

```sh
pnpm --filter @kushex/debug-events typecheck
pnpm --filter @kushex/debug-events test
pnpm --filter @kushex/debug-events build
```
