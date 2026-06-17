import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Box,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Database,
  FileInput,
  RadioTower,
  Workflow
} from 'lucide-react';
import legacyTraceText from '../../samples/ruby-oracle-trace/example.legacy.trace.json?raw';

export type AwsTraceEvent = {
  id: string;
  type: string;
  timestamp: string;
  label: string;
  details?: Record<string, unknown>;
};

export type AwsStateProjection = {
  id: string;
  eventId: string;
  table: string;
  record: string;
  field: string;
  before: string;
  patch: string;
  after: string;
  certainty: 'observed' | 'exact_static' | 'approximate' | 'unknown';
  source?: Record<string, unknown>;
  legacy?: {
    table: string;
    field: string;
    value: string;
  };
};

export type AwsBatchTrace = {
  schemaVersion: string;
  execution: {
    id: string;
    name: string;
    kind: string;
    status: string;
    startedAt: string;
    endedAt?: string;
    input?: Record<string, unknown>;
  };
  resources: Array<{
    id: string;
    type: string;
    label: string;
    details?: Record<string, unknown>;
  }>;
  events: AwsTraceEvent[];
  stateProjections: AwsStateProjection[];
};

export type LegacyStateProjection = {
  id: string;
  eventId: string;
  table: string;
  record: string;
  field: string;
  before: string;
  patch: string;
  after: string;
  certainty: 'observed' | 'exact_static' | 'approximate' | 'unknown';
  target?: {
    table: string;
    field: string;
    value?: string;
  };
  source?: Record<string, unknown>;
};

export type LegacyOracleTrace = {
  schemaVersion: string;
  execution: {
    id: string;
    name: string;
    kind: string;
    status: string;
    startedAt: string;
    endedAt?: string;
    input?: Record<string, unknown>;
  };
  events: AwsTraceEvent[];
  stateProjections: LegacyStateProjection[];
};

const eventIcon = {
  's3.read': FileInput,
  's3.write': FileInput,
  'db.read': Database,
  'db.write': Database,
  'eventbridge.event': RadioTower,
  'stepfunctions.start_execution': Workflow,
  'lambda.invoke': Cloud,
  'execution.start': Box,
  'execution.end': Box
};

const bundledLegacyTrace = JSON.parse(legacyTraceText) as LegacyOracleTrace;

export function AwsBatchTraceView({
  trace,
  onBackToEndpoint
}: {
  trace: AwsBatchTrace;
  onBackToEndpoint: () => void;
}) {
  const [localTrace, setLocalTrace] = useState<AwsBatchTrace | undefined>();
  const [legacyTrace, setLegacyTrace] = useState<LegacyOracleTrace>(bundledLegacyTrace);
  const [loadMessage, setLoadMessage] = useState('Using bundled sample trace');
  const [legacyLoadMessage, setLegacyLoadMessage] = useState('Using bundled Ruby/Oracle sample');
  const displayTrace = localTrace ?? trace;
  const [activeEventId, setActiveEventId] = useState(displayTrace.events[0]?.id ?? '');
  const [selectedTable, setSelectedTable] = useState(firstTable(displayTrace));
  const [detailsOpen, setDetailsOpen] = useState(true);
  const activeEvent = displayTrace.events.find((event) => event.id === activeEventId) ?? displayTrace.events[0];
  const tables = useMemo(() => groupProjectionsByTable(displayTrace.stateProjections), [displayTrace.stateProjections]);
  const selectedRows = tables.get(selectedTable) ?? [];
  const activeProjections = displayTrace.stateProjections.filter((projection) => projection.eventId === activeEvent?.id);
  const sideEffects = displayTrace.events.filter((event) => isSideEffect(event.type));
  const compareRows = useMemo(
    () => buildCompareRows(displayTrace.stateProjections, legacyTrace.stateProjections),
    [displayTrace.stateProjections, legacyTrace.stateProjections]
  );
  const mismatchCount = compareRows.filter((row) => row.status !== 'matched').length;

  async function loadLocalTrace(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as AwsBatchTrace;
      validateTrace(parsed);
      setLocalTrace(parsed);
      setActiveEventId(parsed.events[0]?.id ?? '');
      setSelectedTable(firstTable(parsed));
      setLoadMessage(`Loaded local trace: ${file.name}`);
    } catch (error) {
      setLoadMessage(error instanceof Error ? `Could not load trace: ${error.message}` : 'Could not load trace');
    }
  }

  async function loadLegacyTrace(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as LegacyOracleTrace;
      validateLegacyTrace(parsed);
      setLegacyTrace(parsed);
      setLegacyLoadMessage(`Loaded local legacy trace: ${file.name}`);
    } catch (error) {
      setLegacyLoadMessage(error instanceof Error ? `Could not load legacy trace: ${error.message}` : 'Could not load legacy trace');
    }
  }

  return (
    <main className={detailsOpen ? 'aws-trace-shell' : 'aws-trace-shell aws-details-collapsed'}>
      <section className="aws-trace-workspace">
        <header className="topbar">
          <div>
            <p className="kicker">ReviewFlow AWS Batch Trace</p>
            <h1>{displayTrace.execution.name}</h1>
          </div>
          <div className="summary-strip" aria-label="AWS trace summary">
            <Metric label="Events" value={String(displayTrace.events.length)} />
            <Metric label="Tables" value={String(tables.size)} />
            <Metric label="Diffs" value={String(mismatchCount)} />
          </div>
        </header>

        <div className="modebar">
          <button type="button" className="segment" onClick={onBackToEndpoint}>
            Endpoint Demo
          </button>
          <button type="button" className="segment active">
            AWS Trace
          </button>
        </div>

        <section className="local-observer-card">
          <div>
            <p className="section-kicker">Local Observer</p>
            <h2>No upload, local files only</h2>
            <span>{loadMessage}</span>
            <span>{legacyLoadMessage}</span>
          </div>
          <div className="local-file-actions">
            <label className="local-file-button">
              Load Python/AWS JSON
              <input
                accept="application/json,.json"
                type="file"
                onChange={(event) => void loadLocalTrace(event.currentTarget.files?.[0])}
              />
            </label>
            <label className="local-file-button legacy-file-button">
              Load Ruby/Oracle JSON
              <input
                accept="application/json,.json"
                type="file"
                onChange={(event) => void loadLegacyTrace(event.currentTarget.files?.[0])}
              />
            </label>
          </div>
        </section>

        <section className="aws-execution-card">
          <div>
            <p className="section-kicker">Execution</p>
            <h2>{displayTrace.execution.id}</h2>
          </div>
          <span className={`execution-status status-${displayTrace.execution.status}`}>{displayTrace.execution.status}</span>
          <dl>
            <div>
              <dt>Kind</dt>
              <dd>{displayTrace.execution.kind}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{displayTrace.execution.startedAt}</dd>
            </div>
            <div>
              <dt>Input</dt>
              <dd>{compactJson(displayTrace.execution.input)}</dd>
            </div>
          </dl>
        </section>

        <div className="aws-review-grid">
          <section className="aws-timeline" aria-label="AWS execution timeline">
            <div className="panel-heading">
              <p className="section-kicker">Timeline</p>
              <h2>Execution Steps</h2>
            </div>
            <div className="aws-event-list">
              {displayTrace.events.map((event, index) => {
                const Icon = eventIcon[event.type as keyof typeof eventIcon] ?? Cloud;
                const active = event.id === activeEvent?.id;

                return (
                  <button
                    type="button"
                    className={active ? 'aws-event active-aws-event' : 'aws-event'}
                    key={event.id}
                    onClick={() => {
                      setActiveEventId(event.id);
                      const projection = displayTrace.stateProjections.find((item) => item.eventId === event.id);
                      if (projection) {
                        setSelectedTable(projection.table);
                      }
                    }}
                  >
                    <span className="event-index">{String(index + 1).padStart(2, '0')}</span>
                    <Icon size={17} aria-hidden="true" />
                    <span className="event-copy">
                      <strong>{event.type}</strong>
                      <em>{event.label}</em>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="aws-state-panel" aria-label="PostgreSQL state projection">
            <div className="panel-heading">
              <p className="section-kicker">PostgreSQL Sheet</p>
              <h2>{selectedTable}</h2>
            </div>
            <div className="table-tabs">
              {Array.from(tables.keys()).map((table) => (
                <button
                  type="button"
                  className={table === selectedTable ? 'table-tab active-table-tab' : 'table-tab'}
                  key={table}
                  onClick={() => setSelectedTable(table)}
                >
                  {table}
                </button>
              ))}
            </div>
            <AwsProjectionSheet projections={selectedRows} activeEventId={activeEvent?.id} />
          </section>
        </div>

        <section className="aws-side-effects" aria-label="AWS side effects">
          <div className="panel-heading">
            <p className="section-kicker">Side Effects</p>
            <h2>AWS Resources</h2>
          </div>
          <div className="side-effect-grid">
            {sideEffects.map((event) => (
              <button
                type="button"
                className={event.id === activeEvent?.id ? 'side-effect active-side-effect' : 'side-effect'}
                key={event.id}
                onClick={() => setActiveEventId(event.id)}
              >
                <strong>{event.type}</strong>
                <span>{event.label}</span>
                <em>{compactJson(event.details)}</em>
              </button>
            ))}
          </div>
        </section>

        <section className="migration-compare-panel" aria-label="Migration comparison">
          <div className="panel-heading">
            <p className="section-kicker">Migration Compare</p>
            <h2>Ruby/Oracle vs Python/PostgreSQL</h2>
          </div>
          <div className="compare-table-wrap">
            <table className="compare-table">
              <thead>
                <tr>
                  <th>Oracle Cell</th>
                  <th>Oracle After</th>
                  <th>Mapped Target</th>
                  <th>PostgreSQL Cell</th>
                  <th>PostgreSQL After</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row) => (
                  <tr className={`compare-row compare-${row.status}`} key={row.id}>
                    <td>{row.legacyCell}</td>
                    <td>{row.legacyAfter}</td>
                    <td>{row.mappedValue}</td>
                    <td>{row.targetCell}</td>
                    <td>{row.targetAfter}</td>
                    <td>
                      <span className={`compare-status status-${row.status}`}>{row.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <aside className="aws-details-panel">
        <button type="button" className="details-collapse-button" onClick={() => setDetailsOpen((open) => !open)}>
          {detailsOpen ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}
          <span>{detailsOpen ? 'Hide' : 'Open'}</span>
        </button>
        {detailsOpen ? (
          <div className="aws-details-inner">
            <section className="detail-section">
              <h3>Active Event</h3>
              {activeEvent ? (
                <div className="aws-active-event">
                  <strong>{activeEvent.type}</strong>
                  <span>{activeEvent.label}</span>
                  <code>{compactJson(activeEvent.details)}</code>
                </div>
              ) : null}
            </section>
            <section className="detail-section">
              <h3>Cell Movement</h3>
              {activeProjections.length ? (
                activeProjections.map((projection) => (
                  <div className="aws-cell-move" key={projection.id}>
                    <div>
                      <strong>{projection.table}.{projection.field}</strong>
                      <span>{projection.record}</span>
                    </div>
                    <div className="aws-cell-flow">
                      <span>{projection.before}</span>
                      <ArrowLeftRight size={15} aria-hidden="true" />
                      <span>{projection.after}</span>
                    </div>
                    <em>{projection.patch}</em>
                  </div>
                ))
              ) : (
                <p className="empty">No table cell changed on this event.</p>
              )}
            </section>
            <section className="detail-section">
              <h3>Migration Lens</h3>
              <div className="migration-note">
                <strong>{legacyTrace.execution.name}</strong>
                <span>
                  Comparing {legacyTrace.stateProjections.length} Ruby/Oracle projection(s) against {displayTrace.stateProjections.length} Python/PostgreSQL projection(s).
                </span>
              </div>
            </section>
          </div>
        ) : null}
      </aside>
    </main>
  );
}

function AwsProjectionSheet({
  projections,
  activeEventId
}: {
  projections: AwsStateProjection[];
  activeEventId?: string;
}) {
  const records = Array.from(new Set(projections.map((projection) => projection.record)));
  const fields = Array.from(new Set(projections.map((projection) => projection.field)));

  return (
    <div className="aws-sheet-wrap">
      <div className="aws-sheet" style={{ gridTemplateColumns: `170px repeat(${fields.length}, minmax(150px, 1fr))` }}>
        <div className="sheet-corner">record</div>
        {fields.map((field) => (
          <div className="sheet-header-cell" key={field}>
            {field}
          </div>
        ))}
        {records.map((record) => (
          <AwsProjectionRow
            activeEventId={activeEventId}
            fields={fields}
            key={record}
            projections={projections}
            record={record}
          />
        ))}
      </div>
    </div>
  );
}

function AwsProjectionRow({
  activeEventId,
  fields,
  projections,
  record
}: {
  activeEventId?: string;
  fields: string[];
  projections: AwsStateProjection[];
  record: string;
}) {
  return (
    <>
      <div className="sheet-record-cell">{record}</div>
      {fields.map((field) => {
        const projection = projections.find((item) => item.record === record && item.field === field);
        const active = projection?.eventId === activeEventId;

        return (
          <div className={active ? 'aws-sheet-cell active-aws-sheet-cell' : 'aws-sheet-cell'} key={`${record}-${field}`}>
            {projection ? (
              <>
                <span className="sheet-before">{projection.before}</span>
                <strong className={active ? 'sheet-patch active-sheet-lane' : 'sheet-patch'}>{projection.patch}</strong>
                <span className={active ? 'sheet-after active-sheet-lane' : 'sheet-after'}>{projection.after}</span>
                <em>{projection.certainty}</em>
              </>
            ) : (
              <span className="empty">unknown</span>
            )}
          </div>
        );
      })}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function groupProjectionsByTable(projections: AwsStateProjection[]) {
  const groups = new Map<string, AwsStateProjection[]>();
  for (const projection of projections) {
    const group = groups.get(projection.table) ?? [];
    group.push(projection);
    groups.set(projection.table, group);
  }
  return groups;
}

function firstTable(trace: AwsBatchTrace) {
  return trace.stateProjections[0]?.table ?? 'unknown';
}

function isSideEffect(eventType: string) {
  return eventType.startsWith('s3.') || eventType.startsWith('eventbridge.') || eventType.startsWith('stepfunctions.') || eventType.startsWith('lambda.');
}

function compactJson(value: unknown) {
  if (!value) {
    return 'none';
  }
  return JSON.stringify(value);
}

function validateTrace(value: AwsBatchTrace) {
  if (!value || value.schemaVersion !== 'reviewflow.awsBatchTrace.v0.1') {
    throw new Error('schemaVersion must be reviewflow.awsBatchTrace.v0.1');
  }

  if (!value.execution?.id || !value.execution?.name) {
    throw new Error('execution.id and execution.name are required');
  }

  if (!Array.isArray(value.events)) {
    throw new Error('events must be an array');
  }

  if (!Array.isArray(value.stateProjections)) {
    throw new Error('stateProjections must be an array');
  }
}

function validateLegacyTrace(value: LegacyOracleTrace) {
  if (!value || value.schemaVersion !== 'reviewflow.rubyOracleTrace.v0.1') {
    throw new Error('schemaVersion must be reviewflow.rubyOracleTrace.v0.1');
  }

  if (!value.execution?.id || !value.execution?.name) {
    throw new Error('execution.id and execution.name are required');
  }

  if (!Array.isArray(value.events)) {
    throw new Error('events must be an array');
  }

  if (!Array.isArray(value.stateProjections)) {
    throw new Error('stateProjections must be an array');
  }
}

function buildCompareRows(targets: AwsStateProjection[], legacyItems: LegacyStateProjection[]) {
  return targets.map((target) => {
    const legacy = legacyItems.find((item) => {
      if (item.target?.table === target.table && item.target.field === target.field) {
        return true;
      }

      return target.legacy?.table === item.table && target.legacy.field === item.field;
    });
    const mappedValue = legacy?.target?.value ?? legacy?.after ?? 'missing';
    const status = compareValues(mappedValue, target.after);

    return {
      id: target.id,
      legacyCell: legacy ? `${legacy.table}.${legacy.field}` : target.legacy ? `${target.legacy.table}.${target.legacy.field}` : 'missing',
      legacyAfter: legacy?.after ?? 'missing',
      mappedValue,
      targetCell: `${target.table}.${target.field}`,
      targetAfter: target.after,
      status
    };
  });
}

function compareValues(legacyMappedValue: string, targetAfter: string) {
  if (legacyMappedValue === 'missing') {
    return 'missing_legacy';
  }

  if (legacyMappedValue === 'timestamp' && targetAfter !== 'null' && targetAfter !== 'omitted') {
    return 'matched';
  }

  return normalizeValue(legacyMappedValue) === normalizeValue(targetAfter) ? 'matched' : 'mismatch';
}

function normalizeValue(value: string) {
  return value.trim().toLowerCase().replace(/_/g, '-');
}
