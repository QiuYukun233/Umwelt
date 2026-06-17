export type SourceLocation = {
  file: string;
  line: number;
  column?: number;
  symbol?: string;
};

export type CertaintyLevel = 'observed' | 'exact_static' | 'approximate' | 'unknown';

export type Certainty = {
  reachability: CertaintyLevel;
  entityIdentity: CertaintyLevel;
  fieldPatch: CertaintyLevel;
  sourceAnchor: CertaintyLevel;
};

export type EvidenceRef = {
  id: string;
  kind: 'source' | 'static_rule' | 'runtime_trace' | 'unknown';
  label: string;
  source?: SourceLocation;
  note?: string;
};

export type GraphNode = {
  id: string;
  type: 'entry' | 'function' | 'table' | 'condition' | 'exception' | 'external' | 'transaction';
  label: string;
  operations?: string[];
  source?: SourceLocation;
  certainty?: Certainty;
  evidenceRefs?: EvidenceRef[];
  unknownReasons?: string[];
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  operation: string;
  source?: SourceLocation;
  certainty?: Certainty;
  evidenceRefs?: EvidenceRef[];
  unknownReasons?: string[];
};

export type GraphStep = {
  id: string;
  kind: string;
  nodeId: string;
  edgeId: string;
  status: 'possible' | 'executed' | 'risky' | 'failed';
  label: string;
  source?: SourceLocation;
  certainty?: Certainty;
  evidenceRefs?: EvidenceRef[];
  unknownReasons?: string[];
};

export type Graph = {
  schemaVersion: string;
  entry: {
    id: string;
    label: string;
    source: SourceLocation;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
  steps: GraphStep[];
};

export type ReviewAssistantOutput = {
  summary: string;
  risks: string[];
  tests: string[];
  checklist: string[];
};

const writeOperations = new Set(['create', 'update', 'delete', 'upsert']);

export function generateReviewAssistantOutput(
  graph: Graph,
  node: GraphNode,
  edges: GraphEdge[],
  steps: GraphStep[]
): ReviewAssistantOutput {
  const connectedNodes = new Map(graph.nodes.map((item) => [item.id, item]));
  const reads = edges.filter((edge) => edge.operation === 'read');
  const writes = edges.filter((edge) => writeOperations.has(edge.operation));
  const throws = edges.filter((edge) => edge.operation === 'throw');
  const branches = edges.filter((edge) => edge.operation === 'branch');
  const externalCalls = edges.filter((edge) => edge.operation === 'external_call');
  const failedSteps = steps.filter((step) => step.status === 'failed');
  const riskySteps = steps.filter((step) => step.status === 'risky');

  return {
    summary: summarizeNode(node, reads, writes, branches, throws, externalCalls),
    risks: unique([
      ...riskFromCertainty(node, edges, steps),
      ...riskFromNode(node),
      ...riskFromWrites(writes, connectedNodes),
      ...riskFromBranches(branches),
      ...riskFromFailures(failedSteps),
      ...riskFromExternal(externalCalls, riskySteps)
    ]).slice(0, 5),
    tests: unique([
      ...testsFromNode(node),
      ...testsFromWrites(writes, connectedNodes),
      ...testsFromBranches(branches, connectedNodes),
      ...testsFromFailures(failedSteps),
      ...testsFromExternal(externalCalls)
    ]).slice(0, 5),
    checklist: unique([
      'Confirm every highlighted source location matches the intended business change.',
      ...checklistFromNode(node),
      ...checklistFromWrites(writes, connectedNodes),
      ...checklistFromBranches(branches),
      ...checklistFromExternal(externalCalls)
    ]).slice(0, 6)
  };
}

export function certaintySummary(certainty: Certainty | undefined): {
  label: string;
  level: CertaintyLevel;
  note: string;
} {
  if (!certainty) {
    return {
      label: 'Approximate',
      level: 'approximate',
      note: 'No explicit certainty metadata is attached; treat this as a static inference.'
    };
  }

  const levels = [
    certainty.reachability,
    certainty.entityIdentity,
    certainty.fieldPatch,
    certainty.sourceAnchor
  ];

  if (levels.includes('unknown')) {
    return {
      label: 'Unknown',
      level: 'unknown',
      note: 'At least one certainty dimension is unknown.'
    };
  }

  if (levels.includes('approximate')) {
    return {
      label: 'Approximate',
      level: 'approximate',
      note: 'The source anchor exists, but field or entity detail needs reviewer confirmation.'
    };
  }

  if (levels.includes('exact_static')) {
    return {
      label: 'Exact Static',
      level: 'exact_static',
      note: 'Static analysis produced a source-backed match; runtime execution has not verified it.'
    };
  }

  return {
    label: 'Observed',
    level: 'observed',
    note: 'Runtime evidence observed this behavior.'
  };
}

function summarizeNode(
  node: GraphNode,
  reads: GraphEdge[],
  writes: GraphEdge[],
  branches: GraphEdge[],
  throws: GraphEdge[],
  externalCalls: GraphEdge[]
) {
  const source = node.source ? ` Source: ${node.source.file}:${node.source.line}.` : '';

  if (node.type === 'table') {
    const operations = node.operations?.join(', ') || 'no direct operation';
    return `${node.label} is a data resource in this endpoint. It is connected through ${operations} behavior, with ${reads.length} read edge(s) and ${writes.length} write edge(s).${source}`;
  }

  if (node.type === 'condition') {
    return `This branch decides whether execution continues or enters an error path: ${node.label}.${source}`;
  }

  if (node.type === 'exception') {
    return `This is a failure path reviewers should inspect: ${node.label}.${source}`;
  }

  if (node.type === 'external') {
    return `This external side effect leaves the database-only boundary and should be reviewed for ordering, retry, and failure behavior.${source}`;
  }

  if (node.type === 'transaction') {
    return `This transaction groups related business writes. Review whether every write and failure path belongs inside this boundary.${source}`;
  }

  return `${node.label} participates in the endpoint flow with ${branches.length} branch edge(s), ${throws.length} throw edge(s), ${writes.length} write edge(s), and ${externalCalls.length} external call edge(s).${source}`;
}

function riskFromNode(node: GraphNode) {
  if (node.type === 'exception') {
    return ['Failure behavior may be correct but still needs review for partial writes or missing compensation.'];
  }

  if (node.type === 'condition') {
    return ['Branch conditions can silently change business behavior if validation order or comparison logic is wrong.'];
  }

  if (node.type === 'transaction') {
    return ['Transaction scope may be too broad or too narrow; verify side effects are not accidentally committed with failed paths.'];
  }

  if (node.type === 'external') {
    return ['External calls may fail independently from database writes; check retry and compensation expectations.'];
  }

  return [];
}

function riskFromCertainty(node: GraphNode, edges: GraphEdge[], steps: GraphStep[]) {
  const uncertainItems = [
    node.certainty,
    ...edges.map((edge) => edge.certainty),
    ...steps.map((step) => step.certainty)
  ].filter(Boolean);

  if (uncertainItems.some((certainty) => certaintySummary(certainty).level === 'unknown')) {
    return ['Some evidence is marked unknown; do not treat this path as complete until runtime trace or source review confirms it.'];
  }

  if (uncertainItems.some((certainty) => certaintySummary(certainty).level === 'approximate')) {
    return ['Some evidence is approximate; verify field patches and entity identity before approving behavior changes.'];
  }

  return [];
}

function riskFromWrites(writes: GraphEdge[], nodes: Map<string, GraphNode>) {
  return writes.map((edge) => {
    const target = nodes.get(edge.to)?.label ?? edge.to;
    return `Write operation ${edge.operation} touches ${target}; confirm it is required and happens after necessary guards.`;
  });
}

function riskFromBranches(branches: GraphEdge[]) {
  if (branches.length === 0) {
    return [];
  }

  return ['Multiple branch paths affect this area; check both accepted and rejected paths during review.'];
}

function riskFromFailures(failedSteps: GraphStep[]) {
  return failedSteps.map((step) => `Failure step ${step.id} reaches ${step.kind}; inspect error response and rollback expectations.`);
}

function riskFromExternal(externalCalls: GraphEdge[], riskySteps: GraphStep[]) {
  if (externalCalls.length === 0 && riskySteps.length === 0) {
    return [];
  }

  return ['External or risky steps appear in this path; verify ordering relative to database writes.'];
}

function testsFromNode(node: GraphNode) {
  if (node.type === 'condition') {
    return [`Add one test where "${node.label}" is true and one where it is false.`];
  }

  if (node.type === 'exception') {
    return [`Add a test that intentionally reaches ${node.label} and asserts the HTTP status and response body.`];
  }

  if (node.type === 'external') {
    return ['Mock the external provider success and failure paths, then assert database state after each.'];
  }

  return [];
}

function testsFromWrites(writes: GraphEdge[], nodes: Map<string, GraphNode>) {
  return writes.map((edge) => {
    const target = nodes.get(edge.to)?.label ?? edge.to;
    return `Assert ${target} changes exactly as expected after ${edge.operation}.`;
  });
}

function testsFromBranches(branches: GraphEdge[], nodes: Map<string, GraphNode>) {
  return branches.map((edge) => {
    const target = nodes.get(edge.to)?.label ?? edge.to;
    return `Cover branch path into ${target}.`;
  });
}

function testsFromFailures(failedSteps: GraphStep[]) {
  return failedSteps.map((step) => `Exercise ${step.label} and assert no unintended writes remain.`);
}

function testsFromExternal(externalCalls: GraphEdge[]) {
  if (externalCalls.length === 0) {
    return [];
  }

  return ['Simulate external failure and confirm the endpoint reports failure without hiding payment/provider errors.'];
}

function checklistFromNode(node: GraphNode) {
  if (node.type === 'table') {
    return [`Verify ${node.label} is the correct table/model for this endpoint.`];
  }

  if (node.type === 'exception') {
    return ['Verify the thrown error maps to the expected user-visible API response.'];
  }

  if (node.type === 'condition') {
    return ['Verify this condition belongs before any writes it is meant to guard.'];
  }

  return [];
}

function checklistFromWrites(writes: GraphEdge[], nodes: Map<string, GraphNode>) {
  return writes.map((edge) => {
    const target = nodes.get(edge.to)?.label ?? edge.to;
    return `Review ${edge.operation} on ${target}.`;
  });
}

function checklistFromBranches(branches: GraphEdge[]) {
  if (branches.length === 0) {
    return [];
  }

  return ['Review each branch for success, rejection, and exception behavior.'];
}

function checklistFromExternal(externalCalls: GraphEdge[]) {
  if (externalCalls.length === 0) {
    return [];
  }

  return ['Review external side effects for retries, idempotency, and ordering relative to writes.'];
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
