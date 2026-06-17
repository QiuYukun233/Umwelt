import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Code2,
  Database,
  ExternalLink,
  Filter,
  GitBranch,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  SkipBack,
  SkipForward
} from 'lucide-react';
import graphText from '../../graph-output/order-confirm.graph.json?raw';
import awsTraceText from '../../samples/aws-batch-trace/example.trace.json?raw';
import { AwsBatchTraceView, type AwsBatchTrace } from './AwsBatchTraceView.js';
import {
  certaintySummary,
  generateReviewAssistantOutput,
  type Certainty,
  type EvidenceRef,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type GraphStep,
  type SourceLocation
} from './reviewAssistant.js';
import { getDemoSnapshot, type DemoSnapshot, type DemoTrace } from './demoDataFlow.js';
import { getSourcePreview, type SourcePreview } from './sourcePreview.js';

type FilterMode = 'all' | 'writes' | 'errors' | 'external';
type AppMode = 'endpoint' | 'aws-trace';

type PositionedNode = GraphNode & {
  x: number;
  y: number;
  width: number;
  height: number;
};

const graph = JSON.parse(graphText) as Graph;
const awsTrace = JSON.parse(awsTraceText) as AwsBatchTrace;

const columnOrder: GraphNode['type'][] = [
  'entry',
  'function',
  'transaction',
  'table',
  'external',
  'condition',
  'exception'
];

const typeLabel: Record<GraphNode['type'], string> = {
  entry: 'Entry',
  function: 'Function',
  transaction: 'Transaction',
  table: 'Table',
  condition: 'Branch',
  exception: 'Error',
  external: 'External'
};

const typeIcon = {
  entry: Play,
  function: Code2,
  transaction: Boxes,
  table: Database,
  condition: GitBranch,
  exception: AlertTriangle,
  external: ExternalLink
};

const writeOperations = new Set(['create', 'update', 'delete', 'upsert']);

export function App() {
  const [appMode, setAppMode] = useState<AppMode>('endpoint');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [selectedId, setSelectedId] = useState(graph.entry.id);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);

  const filtered = useMemo(() => filterGraph(graph, filterMode), [filterMode]);
  const layout = useMemo(() => layoutGraph(filtered.nodes), [filtered.nodes]);
  const activeStep = graph.steps[activeStepIndex];
  const demoSnapshot = useMemo(
    () => getDemoSnapshot(activeStepIndex, activeStep),
    [activeStepIndex, activeStep]
  );
  const selectedNode =
    filtered.nodes.find((node) => node.id === selectedId) ??
    graph.nodes.find((node) => node.id === selectedId) ??
    graph.nodes[0];
  const selectedEdges = graph.edges.filter(
    (edge) => edge.from === selectedNode?.id || edge.to === selectedNode?.id
  );
  const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id));
  if (activeStep) {
    selectedEdgeIds.add(activeStep.edgeId);
  }
  const relatedNodeIds = new Set<string>([selectedNode?.id ?? graph.entry.id]);
  for (const edge of selectedEdges) {
    relatedNodeIds.add(edge.from);
    relatedNodeIds.add(edge.to);
  }
  if (activeStep) {
    relatedNodeIds.add(activeStep.nodeId);
    const activeEdge = graph.edges.find((edge) => edge.id === activeStep.edgeId);
    if (activeEdge) {
      relatedNodeIds.add(activeEdge.from);
      relatedNodeIds.add(activeEdge.to);
    }
  }
  const selectedSteps = graph.steps.filter(
    (step) => step.nodeId === selectedNode?.id || selectedEdges.some((edge) => edge.id === step.edgeId)
  );
  const activeTableIds = useMemo(() => currentTableNodeIds(demoSnapshot), [demoSnapshot]);
  const focusedTable = selectedNode?.type === 'table' ? selectedNode.label : firstTraceTable(demoSnapshot);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const timer = window.setInterval(() => {
      setActiveStepIndex((current) => {
        if (current >= graph.steps.length - 1) {
          setIsPlaying(false);
          return current;
        }

        const next = current + 1;
        setSelectedId(graph.steps[next]?.nodeId ?? graph.entry.id);
        return next;
      });
    }, 950);

    return () => window.clearInterval(timer);
  }, [isPlaying]);

  function moveStep(nextIndex: number) {
    const bounded = Math.max(0, Math.min(graph.steps.length - 1, nextIndex));
    setActiveStepIndex(bounded);
    setSelectedId(graph.steps[bounded]?.nodeId ?? graph.entry.id);
  }

  if (appMode === 'aws-trace') {
    return <AwsBatchTraceView trace={awsTrace} onBackToEndpoint={() => setAppMode('endpoint')} />;
  }

  return (
    <main className={detailsCollapsed ? 'app-shell details-collapsed' : 'app-shell'}>
      <section className="graph-workspace" aria-label="ReviewFlow graph">
        <header className="topbar">
          <div>
            <p className="kicker">ReviewFlow</p>
            <h1>{graph.entry.label}</h1>
          </div>
          <div className="summary-strip" aria-label="Graph summary">
            <Metric label="Nodes" value={String(graph.nodes.length)} />
            <Metric label="Edges" value={String(graph.edges.length)} />
            <Metric label="Steps" value={String(graph.steps.length)} />
          </div>
        </header>

        <div className="filterbar" aria-label="Graph filters">
          <Filter size={18} aria-hidden="true" />
          <SegmentedButton active={appMode === 'endpoint'} onClick={() => setAppMode('endpoint')}>
            Endpoint
          </SegmentedButton>
          <SegmentedButton active={false} onClick={() => setAppMode('aws-trace')}>
            AWS Trace
          </SegmentedButton>
          <SegmentedButton active={filterMode === 'all'} onClick={() => setFilterMode('all')}>
            All
          </SegmentedButton>
          <SegmentedButton active={filterMode === 'writes'} onClick={() => setFilterMode('writes')}>
            Writes
          </SegmentedButton>
          <SegmentedButton active={filterMode === 'errors'} onClick={() => setFilterMode('errors')}>
            Errors
          </SegmentedButton>
          <SegmentedButton active={filterMode === 'external'} onClick={() => setFilterMode('external')}>
            External
          </SegmentedButton>
        </div>

        <ReplayControls
          activeStep={activeStep}
          activeStepIndex={activeStepIndex}
          isPlaying={isPlaying}
          totalSteps={graph.steps.length}
          onPlayToggle={() => setIsPlaying((current) => !current)}
          onPrevious={() => moveStep(activeStepIndex - 1)}
          onNext={() => moveStep(activeStepIndex + 1)}
          onReset={() => {
            setIsPlaying(false);
            moveStep(0);
          }}
          onScrub={(index) => {
            setIsPlaying(false);
            moveStep(index);
          }}
        />

        <OperationLedger
          graph={graph}
          activeStepIndex={activeStepIndex}
          selectedNodeId={selectedNode?.id}
          onSelectStep={moveStep}
        />

        {focusedTable ? (
          <SelectedTableSheet table={focusedTable} snapshot={demoSnapshot} />
        ) : null}

        <DataFlowDemo snapshot={demoSnapshot} />

        <div className="canvas-wrap">
          <GraphCanvas
            nodes={layout.nodes}
            edges={filtered.edges}
            selectedId={selectedNode?.id}
            selectedEdgeIds={selectedEdgeIds}
            relatedNodeIds={relatedNodeIds}
            activeStep={activeStep}
            activeTableIds={activeTableIds}
            onSelect={setSelectedId}
          />
        </div>
      </section>

      <aside className="details-panel" aria-label="Selected graph item">
        <button
          type="button"
          className="details-collapse-button"
          onClick={() => setDetailsCollapsed((current) => !current)}
          title={detailsCollapsed ? 'Open details panel' : 'Collapse details panel'}
        >
          {detailsCollapsed ? <PanelRightOpen size={18} aria-hidden="true" /> : <PanelRightClose size={18} aria-hidden="true" />}
          <span>{detailsCollapsed ? 'Open' : 'Hide'}</span>
        </button>
        {!detailsCollapsed && selectedNode ? (
          <NodeDetails
            graph={graph}
            node={selectedNode}
            edges={selectedEdges}
            steps={selectedSteps}
            activeStepId={activeStep?.id}
            demoSnapshot={demoSnapshot}
          />
        ) : null}
      </aside>
    </main>
  );
}

function DataFlowDemo({ snapshot }: { snapshot: DemoSnapshot }) {
  const groups = groupDemoRows(snapshot.rows);

  return (
    <section className="data-demo" aria-label="Data movement demo">
      <div className="data-demo-header">
        <div>
          <p className="section-kicker">Table Change Lens</p>
          <h2>{snapshot.phase}</h2>
        </div>
        <div className="packet-chip">{snapshot.packet}</div>
      </div>
      <p className="data-demo-note">{snapshot.note}</p>

      <div className="change-lens-grid">
        {groups.map((group) => (
          <section
            className={[
              'change-card',
              group.current ? 'current-change-card' : '',
              `change-card-${dominantState(group.rows)}`
            ]
              .filter(Boolean)
              .join(' ')}
            key={group.table}
          >
            <div className="change-card-header">
              <div>
                <strong>{group.table}</strong>
                <span>{group.records.join(', ')}</span>
              </div>
              <span className={`row-state state-${dominantState(group.rows)}`}>{dominantState(group.rows)}</span>
            </div>
            <div className="change-fields">
              {group.rows.map((row) => (
                <div
                  className={[
                    'change-field',
                    `row-${row.state}`,
                    row.current ? 'current-change-field' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={`${row.table}-${row.record}-${row.field}`}
                >
                  <div className="change-field-label">
                    <span>{row.record}</span>
                    <strong>{row.field}</strong>
                  </div>
                  <div className="change-flow">
                    <ValueBox label="Before" value={row.before} />
                    <ArrowRight size={15} aria-hidden="true" />
                    <ValueBox label="Patch" value={row.patch} emphasis={row.state !== 'unchanged'} />
                    <ArrowRight size={15} aria-hidden="true" />
                    <ValueBox label="After" value={row.after} emphasis={row.state === 'changed' || row.state === 'inserted'} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="demo-table-wrap">
        <table className="demo-table">
          <thead>
            <tr>
              <th>Resource</th>
              <th>Record</th>
              <th>Field</th>
              <th>Before</th>
              <th>Patch</th>
              <th>After</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.rows.map((row) => (
              <tr
                className={[
                  'demo-row',
                  `row-${row.state}`,
                  row.current ? 'current-demo-row' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={`${row.table}-${row.record}-${row.field}`}
              >
                <td>{row.table}</td>
                <td>{row.record}</td>
                <td>{row.field}</td>
                <td>{row.before}</td>
                <td>{row.patch}</td>
                <td>{row.after}</td>
                <td>
                  <span className={`row-state state-${row.state}`}>{row.state}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SelectedTableSheet({ table, snapshot }: { table: string; snapshot: DemoSnapshot }) {
  const sheet = buildTableSheet(table, snapshot);
  const tableTraces = snapshot.traces.filter((trace) => trace.from.table === table || trace.to.table === table);

  return (
    <section className="selected-table-sheet" aria-label={`${table} table execution sheet`}>
      <div className="selected-table-header">
        <div>
          <p className="section-kicker">Selected Table</p>
          <h2>{table}</h2>
        </div>
        <span className={`row-state state-${dominantState(sheet.fields)}`}>{dominantState(sheet.fields)}</span>
      </div>
      <TraceBridge traces={tableTraces.length ? tableTraces : snapshot.traces} table={table} />
      <div className="sheet-grid-wrap">
        <div
          className="sheet-grid"
          style={{ gridTemplateColumns: `148px repeat(${sheet.columns.length}, minmax(128px, 1fr))` }}
        >
          <div className="sheet-corner">record</div>
          {sheet.columns.map((column) => (
            <div className="sheet-header-cell" key={column}>
              {column}
            </div>
          ))}
          {sheet.records.map((record) => (
            <TableSheetRow columns={sheet.columns} fields={sheet.fields} key={record} record={record} />
          ))}
        </div>
      </div>
    </section>
  );
}

function TraceBridge({ table, traces }: { table: string; traces: DemoTrace[] }) {
  if (!traces.length) {
    return (
      <div className="trace-bridge empty-trace-bridge">
        <span>No cell-level movement for this step yet</span>
      </div>
    );
  }

  return (
    <div className="trace-bridge" aria-label={`${table} cell processing trace`}>
      {traces.map((trace) => (
        <div className="trace-row" key={`${trace.from.table}-${trace.from.record}-${trace.from.field}-${trace.to.table}-${trace.to.record}-${trace.to.field}`}>
          <TraceCell refCell={trace.from} tone={trace.from.table === table ? 'local' : 'source'} />
          <div className="trace-process">
            <span>{trace.process}</span>
            <ArrowRight size={16} aria-hidden="true" />
          </div>
          <TraceCell refCell={trace.to} tone={trace.to.table === table ? 'local' : 'target'} />
          <p>{trace.note}</p>
        </div>
      ))}
    </div>
  );
}

function TraceCell({ refCell, tone }: { refCell: DemoTrace['from']; tone: 'local' | 'source' | 'target' }) {
  return (
    <div className={`trace-cell trace-${tone}`}>
      <span>{refCell.table}</span>
      <strong>{refCell.record}.{refCell.field}</strong>
      <em>{refCell.lane}: {refCell.label}</em>
    </div>
  );
}

function TableSheetRow({
  columns,
  fields,
  record
}: {
  columns: string[];
  fields: DemoSnapshot['rows'];
  record: string;
}) {
  return (
    <>
      <div className="sheet-record-cell">{record}</div>
      {columns.map((column) => {
        const field = fields.find((row) => row.record === record && row.field === column);
        const state = field?.state ?? 'unknown';

        return (
          <div
            className={[
              'sheet-value-cell',
                `row-${state}`,
                field?.current ? 'current-sheet-cell' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            key={`${record}-${column}`}
          >
            {field ? (
              <>
                <span className={field.activeLanes?.includes('before') ? 'sheet-before active-sheet-lane' : 'sheet-before'}>
                  {field.before}
                </span>
                <strong
                  className={[
                    'sheet-patch',
                    field.state !== 'unchanged' && field.state !== 'omitted' ? 'active-patch' : '',
                    field.activeLanes?.includes('patch') ? 'active-sheet-lane' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {field.patch}
                </strong>
                <span className={field.activeLanes?.includes('after') ? 'sheet-after active-sheet-lane' : 'sheet-after'}>
                  {field.after}
                </span>
              </>
            ) : (
              <>
                <span className="sheet-before">unknown</span>
                <strong className="sheet-patch">unknown</strong>
                <span className="sheet-after">unknown</span>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

function buildTableSheet(table: string, snapshot: DemoSnapshot) {
  const fields = snapshot.rows.filter((row) => row.table === table);
  const records = Array.from(new Set(fields.map((field) => field.record)));
  const columns = Array.from(new Set(fields.map((field) => field.field)));

  return { columns, fields, records };
}

function ValueBox({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={emphasis ? 'value-box emphasized-value' : 'value-box'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function groupDemoRows(rows: DemoSnapshot['rows']) {
  const groups = new Map<string, DemoSnapshot['rows']>();

  for (const row of rows) {
    const group = groups.get(row.table) ?? [];
    group.push(row);
    groups.set(row.table, group);
  }

  return Array.from(groups.entries()).map(([table, groupRows]) => ({
    table,
    rows: groupRows,
    current: groupRows.some((row) => row.current),
    records: Array.from(new Set(groupRows.map((row) => row.record)))
  }));
}

function dominantState(rows: DemoSnapshot['rows']) {
  const priority = ['failed', 'changed', 'inserted', 'checked', 'read', 'unknown', 'omitted', 'unchanged'] as const;
  return priority.find((state) => rows.some((row) => row.state === state)) ?? 'unchanged';
}

function OperationLedger({
  graph,
  activeStepIndex,
  selectedNodeId,
  onSelectStep
}: {
  graph: Graph;
  activeStepIndex: number;
  selectedNodeId?: string;
  onSelectStep: (index: number) => void;
}) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const activeStep = graph.steps[activeStepIndex];

  return (
    <section className="operation-ledger" aria-label="Operation ledger">
      <div className="ledger-header">
        <div>
          <p className="section-kicker">Operation Ledger</p>
          <h2>{activeStep ? activeStep.label : 'Static storyboard'}</h2>
        </div>
        <CertaintyChip certainty={activeStep?.certainty} />
      </div>
      <div className="ledger-list" role="list">
        {graph.steps.map((step, index) => {
          const node = nodes.get(step.nodeId);
          const certainty = certaintySummary(step.certainty);

          return (
            <button
              type="button"
              className={[
                'ledger-item',
                `step-${step.status}`,
                `certainty-${certainty.level}`,
                index === activeStepIndex ? 'active-ledger-item' : '',
                step.nodeId === selectedNodeId ? 'related-ledger-item' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              key={step.id}
              onClick={() => onSelectStep(index)}
            >
              <span className="ledger-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="ledger-main">
                <strong>{step.kind}</strong>
                <em>{node?.label ?? step.nodeId}</em>
              </span>
              <span className={`certainty-pill certainty-${certainty.level}`}>{certainty.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ReplayControls({
  activeStep,
  activeStepIndex,
  isPlaying,
  totalSteps,
  onPlayToggle,
  onPrevious,
  onNext,
  onReset,
  onScrub
}: {
  activeStep: GraphStep | undefined;
  activeStepIndex: number;
  isPlaying: boolean;
  totalSteps: number;
  onPlayToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onReset: () => void;
  onScrub: (index: number) => void;
}) {
  return (
    <div className="replaybar" aria-label="Replay controls">
      <div className={`replay-status step-${activeStep?.status ?? 'possible'}`}>
        <span>{activeStep ? activeStep.id : 'step.000'}</span>
        <strong>{activeStep ? activeStep.kind : 'No step'}</strong>
        <p>{activeStep ? activeStep.label : 'No replay step selected'}</p>
      </div>
      <div className="replay-controls">
        <button type="button" className="icon-button" onClick={onReset} title="Reset replay">
          <RotateCcw size={18} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" onClick={onPrevious} title="Previous step">
          <SkipBack size={18} aria-hidden="true" />
        </button>
        <button type="button" className="play-button" onClick={onPlayToggle}>
          {isPlaying ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
          <span>{isPlaying ? 'Pause' : 'Play'}</span>
        </button>
        <button type="button" className="icon-button" onClick={onNext} title="Next step">
          <SkipForward size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="replay-slider">
        <input
          type="range"
          min="0"
          max={Math.max(0, totalSteps - 1)}
          value={activeStepIndex}
          onChange={(event) => onScrub(Number(event.target.value))}
          aria-label="Replay step"
        />
        <span>
          {activeStepIndex + 1}/{totalSteps}
        </span>
      </div>
    </div>
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

function SegmentedButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? 'segment active' : 'segment'} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function GraphCanvas({
  nodes,
  edges,
  selectedId,
  selectedEdgeIds,
  relatedNodeIds,
  activeStep,
  activeTableIds,
  onSelect
}: {
  nodes: PositionedNode[];
  edges: GraphEdge[];
  selectedId?: string;
  selectedEdgeIds: Set<string>;
  relatedNodeIds: Set<string>;
  activeStep?: GraphStep;
  activeTableIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const visibleEdges = edges.filter((edge) => nodeMap.has(edge.from) && nodeMap.has(edge.to));
  const width = Math.max(1400, ...nodes.map((node) => node.x + node.width + 120));
  const height = Math.max(720, ...nodes.map((node) => node.y + node.height + 120));

  return (
    <svg className="graph-canvas" viewBox={`0 0 ${width} ${height}`} role="img">
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
          <path d="M0,0 L0,6 L9,3 z" fill="#64748b" />
        </marker>
      </defs>
      <g className="edges">
        {visibleEdges.map((edge, edgeIndex) => {
          const from = nodeMap.get(edge.from);
          const to = nodeMap.get(edge.to);

          if (!from || !to) {
            return null;
          }

          const x1 = from.x + from.width;
          const y1 = from.y + from.height / 2;
          const x2 = to.x;
          const y2 = to.y + to.height / 2;
          const laneOffset = ((edgeIndex % 7) - 3) * 9;
          const curve = Math.max(72, Math.abs(x2 - x1) / 2.4);
          const pathData = `M ${x1} ${y1 + laneOffset} C ${x1 + curve} ${y1 + laneOffset}, ${x2 - curve} ${y2 - laneOffset}, ${x2} ${y2 - laneOffset}`;
          const active = selectedEdgeIds.has(edge.id);
          const muted = selectedEdgeIds.size > 0 && !active;
          const replayActive = activeStep?.edgeId === edge.id;

          return (
            <g
              key={edge.id}
              className={[
                'edge-group',
                active ? 'active' : '',
                muted ? 'muted' : '',
                replayActive ? 'replay-active' : '',
                replayActive && activeStep ? `step-${activeStep.status}` : ''
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <path className={`edge edge-${edge.operation}`} d={pathData} markerEnd="url(#arrow)" />
              <text className="edge-label" x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6}>
                {edge.operation}
              </text>
            </g>
          );
        })}
      </g>
      <g className="nodes">
        {nodes.map((node) => {
          const Icon = typeIcon[node.type];
          const selected = node.id === selectedId;
          const replayActive = node.id === activeStep?.nodeId;
          const tableDataActive = activeTableIds.has(node.id);
          const dimmed = relatedNodeIds.size > 1 && !relatedNodeIds.has(node.id);

          return (
            <g
              key={node.id}
              className={[
                'node',
                `node-${node.type}`,
                selected ? 'selected' : '',
                replayActive ? 'replay-active' : '',
                tableDataActive ? 'table-data-active' : '',
                replayActive && activeStep ? `step-${activeStep.status}` : '',
                dimmed ? 'dimmed' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              transform={`translate(${node.x}, ${node.y})`}
              onClick={() => onSelect(node.id)}
              tabIndex={0}
              role="button"
              aria-label={node.label}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  onSelect(node.id);
                }
              }}
            >
              <rect width={node.width} height={node.height} rx="8" />
              <foreignObject x="12" y="10" width={node.width - 24} height={node.height - 20}>
                <div className="node-content">
                  <div className="node-type">
                    <Icon size={16} aria-hidden="true" />
                    <span>{typeLabel[node.type]}</span>
                  </div>
                  <div className="node-label" title={node.label}>
                    {shortNodeLabel(node)}
                  </div>
                  {node.operations?.length ? (
                    <div className="node-ops">{node.operations.join(', ')}</div>
                  ) : null}
                </div>
              </foreignObject>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function NodeDetails({
  graph,
  node,
  edges,
  steps,
  activeStepId,
  demoSnapshot
}: {
  graph: Graph;
  node: GraphNode;
  edges: GraphEdge[];
  steps: GraphStep[];
  activeStepId?: string;
  demoSnapshot: DemoSnapshot;
}) {
  const Icon = typeIcon[node.type];
  const groupedEdges = groupEdges(edges);
  const review = generateReviewAssistantOutput(graph, node, edges, steps);
  const sourcePreview = getSourcePreview(node.source);

  return (
    <div className="details-inner">
      <div className={`details-badge badge-${node.type}`}>
        <Icon size={18} aria-hidden="true" />
        <span>{typeLabel[node.type]}</span>
      </div>
      <h2>{node.label}</h2>
      <dl className="source-list">
        <div>
          <dt>ID</dt>
          <dd>{node.id}</dd>
        </div>
        {node.operations?.length ? (
          <div>
            <dt>Operations</dt>
            <dd>{node.operations.join(', ')}</dd>
          </div>
        ) : null}
        {node.source ? (
          <div>
            <dt>Source</dt>
            <dd>
              {node.source.file}:{node.source.line}
              {node.source.column ? `:${node.source.column}` : ''}
            </dd>
          </div>
        ) : null}
      </dl>

      <EvidencePanel
        certainty={node.certainty}
        evidenceRefs={node.evidenceRefs}
        unknownReasons={node.unknownReasons}
      />

      {node.type === 'table' ? <TableExecutionPanel table={node.label} snapshot={demoSnapshot} /> : null}

      <SourcePreviewPanel preview={sourcePreview} />

      <section className="assistant-card">
        <div className="assistant-header">
          <Code2 size={17} aria-hidden="true" />
          <h3>Review Assistant</h3>
        </div>
        <p className="assistant-summary">{review.summary}</p>
        <ReviewList title="Risks" items={review.risks} tone="risk" />
        <ReviewList title="Tests" items={review.tests} tone="test" />
        <ReviewList title="Checklist" items={review.checklist} tone="check" />
      </section>

      <section className="detail-section">
        <h3>Connected Edges</h3>
        <div className="edge-list">
          {groupedEdges.length ? (
            groupedEdges.map(([operation, operationEdges]) => (
              <div className="edge-group-card" key={operation}>
                <div className="edge-group-title">
                  <strong>{operation}</strong>
                  <span>{operationEdges.length}</span>
                </div>
                {operationEdges.map((edge) => (
                  <div className="edge-item compact" key={edge.id}>
                    <span>{edge.from === node.id ? edge.to : edge.from}</span>
                  </div>
                ))}
              </div>
            ))
          ) : (
            <p className="empty">No connected edges</p>
          )}
        </div>
      </section>

      <section className="detail-section">
        <h3>Replay Steps</h3>
        <div className="step-list">
          {steps.length ? (
            steps.map((step) => (
              <div
                className={[
                  'step-item',
                  `step-${step.status}`,
                  step.id === activeStepId ? 'active-step-item' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                key={step.id}
              >
                <span>{step.id}</span>
                <strong>{step.kind}</strong>
                <p>{step.label}</p>
              </div>
            ))
          ) : (
            <p className="empty">No replay steps</p>
          )}
        </div>
      </section>
    </div>
  );
}

function TableExecutionPanel({ table, snapshot }: { table: string; snapshot: DemoSnapshot }) {
  const rows = snapshot.rows.filter((row) => row.table === table);
  const changedRows = rows.filter((row) => row.state !== 'unchanged' && row.state !== 'omitted');

  return (
    <section className="table-execution-card">
      <div className="table-execution-header">
        <div>
          <p className="section-kicker">Table Execution</p>
          <h3>{table}</h3>
        </div>
        <span className={`row-state state-${dominantState(rows)}`}>{dominantState(rows)}</span>
      </div>
      <p>
        {changedRows.length
          ? `${changedRows.length} touched field(s) in this replay position.`
          : 'No concrete field change is visible for this table at the current replay position.'}
      </p>
      <div className="table-execution-rows">
        {rows.map((row) => (
          <div
            className={[
              'table-execution-row',
              `row-${row.state}`,
              row.current ? 'current-table-execution-row' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            key={`${row.table}-${row.record}-${row.field}`}
          >
            <div className="table-execution-field">
              <span>{row.record}</span>
              <strong>{row.field}</strong>
            </div>
            <div className="table-execution-flow">
              <ValueBox label="Before" value={row.before} />
              <ArrowRight size={14} aria-hidden="true" />
              <ValueBox label="Patch" value={row.patch} emphasis={row.state !== 'unchanged' && row.state !== 'omitted'} />
              <ArrowRight size={14} aria-hidden="true" />
              <ValueBox label="After" value={row.after} emphasis={row.state === 'changed' || row.state === 'inserted'} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function EvidencePanel({
  certainty,
  evidenceRefs,
  unknownReasons
}: {
  certainty?: Certainty;
  evidenceRefs?: EvidenceRef[];
  unknownReasons?: string[];
}) {
  const summary = certaintySummary(certainty);

  return (
    <section className="evidence-card">
      <div className="evidence-header">
        <ShieldCheck size={17} aria-hidden="true" />
        <h3>Evidence</h3>
        <span className={`certainty-pill certainty-${summary.level}`}>{summary.label}</span>
      </div>
      <p>{summary.note}</p>
      {certainty ? (
        <div className="certainty-grid">
          <CertaintyMetric label="Reachability" value={certainty.reachability} />
          <CertaintyMetric label="Entity" value={certainty.entityIdentity} />
          <CertaintyMetric label="Field Patch" value={certainty.fieldPatch} />
          <CertaintyMetric label="Source" value={certainty.sourceAnchor} />
        </div>
      ) : null}
      <EvidenceList items={evidenceRefs ?? []} />
      {unknownReasons?.length ? (
        <div className="unknown-reasons">
          <strong>Degrade Reasons</strong>
          <span>{unknownReasons.join(', ')}</span>
        </div>
      ) : null}
    </section>
  );
}

function CertaintyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="certainty-metric">
      <span>{label}</span>
      <strong>{value.replace('_', ' ')}</strong>
    </div>
  );
}

function CertaintyChip({ certainty }: { certainty?: Certainty }) {
  const summary = certaintySummary(certainty);

  return <span className={`certainty-chip certainty-${summary.level}`}>{summary.label}</span>;
}

function EvidenceList({ items }: { items: EvidenceRef[] }) {
  if (!items.length) {
    return <p className="empty">No evidence refs attached</p>;
  }

  return (
    <div className="evidence-list">
      {items.map((item) => (
        <div className="evidence-item" key={item.id}>
          <strong>{item.kind.replace('_', ' ')}</strong>
          <span>{item.label}</span>
          {item.note ? <p>{item.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

function SourcePreviewPanel({ preview }: { preview: SourcePreview | undefined }) {
  return (
    <section className="source-preview">
      <div className="source-preview-header">
        <h3>Source Preview</h3>
        {preview ? <span>{preview.file}</span> : null}
      </div>
      {preview ? (
        <pre>
          {preview.lines.map((line) => (
            <code
              className={line.number === preview.targetLine ? 'source-line active-source-line' : 'source-line'}
              key={line.number}
            >
              <span>{line.number}</span>
              <em>{line.text || ' '}</em>
            </code>
          ))}
        </pre>
      ) : (
        <p className="empty">No source preview available for this selection</p>
      )}
    </section>
  );
}

function ReviewList({
  title,
  items,
  tone
}: {
  title: string;
  items: string[];
  tone: 'risk' | 'test' | 'check';
}) {
  return (
    <div className="review-list">
      <h4>{title}</h4>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li className={`review-item review-${tone}`} key={item}>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty">No specific {title.toLowerCase()} for this selection</p>
      )}
    </div>
  );
}

function filterGraph(sourceGraph: Graph, mode: FilterMode) {
  if (mode === 'all') {
    return sourceGraph;
  }

  const importantNodeIds = new Set<string>([sourceGraph.entry.id]);

  for (const edge of sourceGraph.edges) {
    if (mode === 'writes' && writeOperations.has(edge.operation)) {
      importantNodeIds.add(edge.from);
      importantNodeIds.add(edge.to);
    }

    if (mode === 'external' && edge.operation === 'external_call') {
      importantNodeIds.add(edge.from);
      importantNodeIds.add(edge.to);
    }
  }

  for (const node of sourceGraph.nodes) {
    if (mode === 'errors' && (node.type === 'exception' || node.type === 'condition')) {
      importantNodeIds.add(node.id);
    }
  }

  const nodes = sourceGraph.nodes.filter((node) => importantNodeIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = sourceGraph.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  return {
    ...sourceGraph,
    nodes,
    edges
  };
}

function layoutGraph(nodes: GraphNode[]) {
  const grouped = new Map<GraphNode['type'], GraphNode[]>();
  for (const type of columnOrder) {
    grouped.set(type, []);
  }

  for (const node of nodes) {
    grouped.get(node.type)?.push(node);
  }

  const positioned: PositionedNode[] = [];
  const columnWidth = 228;
  const rowHeight = 118;
  const startX = 36;
  const startY = 44;

  for (const [columnIndex, type] of columnOrder.entries()) {
    const group = grouped.get(type) ?? [];
    group.forEach((node, rowIndex) => {
      positioned.push({
        ...node,
        x: startX + columnIndex * columnWidth,
        y: startY + rowIndex * rowHeight,
        width: 180,
        height: 86
      });
    });
  }

  return { nodes: positioned };
}

function shortNodeLabel(node: GraphNode) {
  if (node.type === 'exception') {
    return node.label
      .replace(/^new\s+/, '')
      .replace(/\((.*)\)$/, '')
      .replace(/Error$/, 'Error');
  }

  if (node.type === 'condition') {
    return node.label.replace(/Number\.isInteger/g, 'isInteger');
  }

  return node.label;
}

function groupEdges(edges: GraphEdge[]) {
  const groups = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const group = groups.get(edge.operation) ?? [];
    group.push(edge);
    groups.set(edge.operation, group);
  }

  return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right));
}

function currentTableNodeIds(snapshot: DemoSnapshot) {
  return new Set(snapshot.rows.filter((row) => row.current).map((row) => `table.${row.table}`));
}

function firstTraceTable(snapshot: DemoSnapshot) {
  const trace = snapshot.traces.find((item) => item.to.table !== 'request' && item.to.table !== 'system');
  return trace?.to.table;
}
