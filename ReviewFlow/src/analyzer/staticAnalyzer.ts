import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

type SourceLocation = {
  file: string;
  line: number;
  column?: number;
  symbol?: string;
};

type CertaintyLevel = 'observed' | 'exact_static' | 'approximate' | 'unknown';

type Certainty = {
  reachability: CertaintyLevel;
  entityIdentity: CertaintyLevel;
  fieldPatch: CertaintyLevel;
  sourceAnchor: CertaintyLevel;
};

type EvidenceRef = {
  id: string;
  kind: 'source' | 'static_rule' | 'runtime_trace' | 'unknown';
  label: string;
  source?: SourceLocation;
  note?: string;
};

type GraphNode = {
  id: string;
  type: 'entry' | 'function' | 'table' | 'condition' | 'exception' | 'external' | 'transaction';
  label: string;
  operations?: string[];
  source?: SourceLocation;
  certainty?: Certainty;
  evidenceRefs?: EvidenceRef[];
  unknownReasons?: string[];
};

type GraphEdge = {
  id: string;
  from: string;
  to: string;
  operation: string;
  source?: SourceLocation;
  certainty?: Certainty;
  evidenceRefs?: EvidenceRef[];
  unknownReasons?: string[];
};

type GraphStep = {
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

type Graph = {
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

type SourceManifestLine = {
  number: number;
  text: string;
};

type SourceManifest = Record<
  string,
  {
    file: string;
    lines: SourceManifestLine[];
  }
>;

type FunctionRecord = {
  name: string;
  file: string;
  node: ts.FunctionDeclaration;
};

type ImportedSymbol = {
  exportedName: string;
  file: string;
};

type FileIndex = {
  sourceFile: ts.SourceFile;
  imports: Map<string, ImportedSymbol>;
  exports: Map<string, FunctionRecord>;
};

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, 'src');
const routeFile = path.join(srcRoot, 'routes', 'orderRoutes.ts');
const outputFile = path.join(projectRoot, 'graph-output', 'order-confirm.graph.json');
const sourceManifestFile = path.join(projectRoot, 'graph-output', 'order-confirm.sources.json');
const endpointPrefix = '/orders';

const prismaOperationKinds: Record<string, string> = {
  findUnique: 'read',
  findFirst: 'read',
  findMany: 'read',
  count: 'read',
  aggregate: 'read',
  create: 'create',
  createMany: 'create',
  update: 'update',
  updateMany: 'update',
  delete: 'delete',
  deleteMany: 'delete',
  upsert: 'upsert'
};

const modelLabels: Record<string, string> = {
  order: 'orders',
  orderItem: 'order_items',
  inventory: 'inventory',
  paymentLog: 'payment_logs'
};

const graphNodes = new Map<string, GraphNode>();
const graphEdges = new Map<string, GraphEdge>();
const graphSteps: GraphStep[] = [];
const visitedFunctions = new Set<string>();
const fileIndexes = new Map<string, FileIndex>();

async function main() {
  await indexFile(routeFile);
  const routeIndex = fileIndexes.get(normalizePath(routeFile));

  if (!routeIndex) {
    throw new Error(`Unable to index route file: ${routeFile}`);
  }

  const routeCall = findEndpointRoute(routeIndex.sourceFile);
  if (!routeCall) {
    throw new Error('Could not find order confirmation route');
  }

  const entrySource = sourceLocation(routeIndex.sourceFile, routeCall.callExpression, 'orderRoutes.post');
  const entry = {
    id: 'api.confirmOrder',
    label: `POST ${endpointPrefix}${routeCall.path}`,
    source: entrySource
  };

  addNode({
    id: entry.id,
    type: 'entry',
    label: entry.label,
    source: entry.source
  });

  const handler = resolveImportedFunction(routeIndex, routeCall.handlerName);
  if (!handler) {
    throw new Error(`Could not resolve route handler: ${routeCall.handlerName}`);
  }

  addCallEdge(entry.id, functionId(handler), routeIndex.sourceFile, routeCall.callExpression);
  await analyzeFunction(handler, entry.id);

  const graph: Graph = {
    schemaVersion: '0.1',
    entry,
    nodes: Array.from(graphNodes.values()),
    edges: Array.from(graphEdges.values()),
    steps: graphSteps
  };

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(graph, null, 2)}\n`, 'utf8');
  await writeFile(sourceManifestFile, `${JSON.stringify(buildSourceManifest(graph), null, 2)}\n`, 'utf8');
  console.log(`Wrote ${path.relative(projectRoot, outputFile)}`);
  console.log(`Wrote ${path.relative(projectRoot, sourceManifestFile)}`);
  console.log(`Nodes: ${graph.nodes.length}, edges: ${graph.edges.length}, steps: ${graph.steps.length}`);
}

async function indexFile(file: string): Promise<FileIndex> {
  const normalized = normalizePath(file);
  const cached = fileIndexes.get(normalized);

  if (cached) {
    return cached;
  }

  const content = await readFile(normalized, 'utf8');
  const sourceFile = ts.createSourceFile(normalized, content, ts.ScriptTarget.Latest, true);
  const imports = new Map<string, ImportedSymbol>();
  const exports = new Map<string, FunctionRecord>();
  const fileIndex: FileIndex = { sourceFile, imports, exports };
  fileIndexes.set(normalized, fileIndex);

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const moduleText = statement.moduleSpecifier.getText(sourceFile).slice(1, -1);
      const resolved = resolveImportPath(normalized, moduleText);
      const namedBindings = statement.importClause?.namedBindings;

      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          const exportedName = element.propertyName?.text ?? element.name.text;
          imports.set(element.name.text, { exportedName, file: resolved });
        }
      }
    }

    if (ts.isFunctionDeclaration(statement) && statement.name && hasExportModifier(statement)) {
      exports.set(statement.name.text, {
        name: statement.name.text,
        file: normalized,
        node: statement
      });
    }
  }

  for (const imported of imports.values()) {
    if (imported.file.startsWith(srcRoot)) {
      await indexFile(imported.file);
    }
  }

  return fileIndex;
}

function findEndpointRoute(sourceFile: ts.SourceFile) {
  let result:
    | {
        path: string;
        handlerName: string;
        callExpression: ts.CallExpression;
      }
    | undefined;

  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) {
      return;
    }

    if (!ts.isPropertyAccessExpression(node.expression)) {
      return;
    }

    if (node.expression.name.text !== 'post') {
      return;
    }

    const [pathArg, handlerArg] = node.arguments;
    if (!pathArg || !ts.isStringLiteral(pathArg) || !handlerArg) {
      return;
    }

    const handlerName = unwrapHandlerName(handlerArg);
    if (handlerName) {
      result = {
        path: pathArg.text,
        handlerName,
        callExpression: node
      };
    }
  });

  return result;
}

function unwrapHandlerName(node: ts.Expression): string | undefined {
  if (ts.isIdentifier(node)) {
    return node.text;
  }

  if (ts.isCallExpression(node) && node.arguments.length > 0) {
    return unwrapHandlerName(node.arguments[0]);
  }

  return undefined;
}

async function analyzeFunction(record: FunctionRecord, callerId: string) {
  const key = `${record.file}#${record.name}`;
  if (visitedFunctions.has(key)) {
    return;
  }
  visitedFunctions.add(key);

  const sourceFile = fileIndexes.get(record.file)?.sourceFile;
  const fileIndex = fileIndexes.get(record.file);
  if (!sourceFile || !fileIndex) {
    return;
  }

  const currentFunctionId = functionId(record);
  addNode({
    id: currentFunctionId,
    type: 'function',
    label: record.name,
    source: sourceLocation(sourceFile, record.node, record.name)
  });

  if (callerId !== currentFunctionId) {
    addCallEdge(callerId, currentFunctionId, sourceFile, record.node);
  }

  visit(record.node.body, (node) => {
    if (ts.isIfStatement(node)) {
      const conditionId = stableNodeId('condition', record.name, node.expression.getText(sourceFile));
      addNode({
        id: conditionId,
        type: 'condition',
        label: node.expression.getText(sourceFile),
        source: sourceLocation(sourceFile, node, record.name)
      });
      addEdge(currentFunctionId, conditionId, 'branch', sourceFile, node);
      addStep('branch.hit', conditionId, currentFunctionId, conditionId, 'possible', `Evaluate ${node.expression.getText(sourceFile)}`, sourceFile, node);
    }

    if (ts.isThrowStatement(node)) {
      const label = node.expression ? node.expression.getText(sourceFile) : 'throw';
      const exceptionId = stableNodeId('exception', record.name, label);
      addNode({
        id: exceptionId,
        type: 'exception',
        label,
        source: sourceLocation(sourceFile, node, record.name)
      });
      const edge = addEdge(currentFunctionId, exceptionId, 'throw', sourceFile, node);
      addStep('exception.throw', exceptionId, currentFunctionId, edge.id, 'failed', label, sourceFile, node);
    }

    if (ts.isCallExpression(node)) {
      const prismaCall = getPrismaOperation(node);
      if (prismaCall) {
        const tableId = `table.${modelLabels[prismaCall.model] ?? prismaCall.model}`;
        addNode({
          id: tableId,
          type: 'table',
          label: modelLabels[prismaCall.model] ?? prismaCall.model,
          operations: [prismaCall.operation],
          source: sourceLocation(sourceFile, node, record.name)
        });
        const edge = addEdge(currentFunctionId, tableId, prismaCall.operation, sourceFile, node);
        addStep(`db.${isWriteOperation(prismaCall.operation) ? 'write' : 'read'}`, tableId, currentFunctionId, edge.id, 'possible', `${prismaCall.operation} ${modelLabels[prismaCall.model] ?? prismaCall.model}`, sourceFile, node);
        return;
      }

      if (isTransactionCall(node)) {
        const transactionId = stableNodeId('transaction', record.name, 'prisma.$transaction');
        addNode({
          id: transactionId,
          type: 'transaction',
          label: 'Prisma transaction',
          source: sourceLocation(sourceFile, node, record.name)
        });
        addEdge(currentFunctionId, transactionId, 'transaction_enter', sourceFile, node);
      }
    }
  });

  const calledFunctions = collectResolvedCalls(record.node, fileIndex);
  for (const called of calledFunctions) {
    const isExternal = called.file.includes(`${path.sep}external${path.sep}`);

    if (isExternal) {
      const source = fileIndexes.get(called.file)?.sourceFile;
      const externalId = `external.${slug(called.name)}`;
      addNode({
        id: externalId,
        type: 'external',
        label: called.name,
        source: source ? sourceLocation(source, called.node, called.name) : undefined
      });
      const edge = addEdge(currentFunctionId, externalId, 'external_call', sourceFile, record.node);
      addStep('external.call', externalId, currentFunctionId, edge.id, 'risky', called.name, sourceFile, record.node);
    } else {
      addCallEdge(currentFunctionId, functionId(called), sourceFile, record.node);
      await analyzeFunction(called, currentFunctionId);
    }
  }
}

function collectResolvedCalls(node: ts.Node, fileIndex: FileIndex) {
  const calls = new Map<string, FunctionRecord>();

  visit(node, (child) => {
    if (!ts.isCallExpression(child) || !ts.isIdentifier(child.expression)) {
      return;
    }

    const resolved = resolveImportedFunction(fileIndex, child.expression.text);
    if (resolved) {
      calls.set(`${resolved.file}#${resolved.name}`, resolved);
    }
  });

  return Array.from(calls.values());
}

function resolveImportedFunction(fileIndex: FileIndex, localName: string): FunctionRecord | undefined {
  const imported = fileIndex.imports.get(localName);
  if (!imported) {
    return undefined;
  }

  const importedIndex = fileIndexes.get(imported.file);
  return importedIndex?.exports.get(imported.exportedName);
}

function getPrismaOperation(node: ts.CallExpression) {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return undefined;
  }

  const method = node.expression.name.text;
  const operation = prismaOperationKinds[method];
  if (!operation || !ts.isPropertyAccessExpression(node.expression.expression)) {
    return undefined;
  }

  const model = node.expression.expression.name.text;
  const clientExpression = node.expression.expression.expression;

  if (!ts.isIdentifier(clientExpression)) {
    return undefined;
  }

  if (!['prisma', 'client', 'tx'].includes(clientExpression.text)) {
    return undefined;
  }

  return { model, method, operation };
}

function isTransactionCall(node: ts.CallExpression) {
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === '$transaction' &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'prisma'
  );
}

function addNode(node: GraphNode) {
  const enrichedNode: GraphNode = {
    ...node,
    certainty: node.certainty ?? certaintyForNode(node),
    evidenceRefs: node.evidenceRefs ?? evidenceFor('node', node.type, node.source),
    unknownReasons: node.unknownReasons ?? unknownReasonsForNode(node)
  };
  const existing = graphNodes.get(node.id);
  if (!existing) {
    graphNodes.set(node.id, enrichedNode);
    return;
  }

  if (node.operations?.length) {
    const operations = new Set([...(existing.operations ?? []), ...node.operations]);
    existing.operations = Array.from(operations);
    existing.certainty = certaintyForNode(existing);
    existing.unknownReasons = unique([...(existing.unknownReasons ?? []), ...unknownReasonsForNode(existing)]);
  }
}

function addCallEdge(from: string, to: string, sourceFile: ts.SourceFile, node: ts.Node) {
  return addEdge(from, to, 'call', sourceFile, node);
}

function addEdge(from: string, to: string, operation: string, sourceFile: ts.SourceFile, node: ts.Node): GraphEdge {
  const id = `edge.${slug(from)}.${slug(operation)}.${slug(to)}`;
  const edge = {
    id,
    from,
    to,
    operation,
    source: sourceLocation(sourceFile, node),
    certainty: certaintyForOperation(operation),
    evidenceRefs: evidenceFor('edge', operation, sourceLocation(sourceFile, node)),
    unknownReasons: unknownReasonsForOperation(operation)
  };
  graphEdges.set(id, edge);
  return edge;
}

function addStep(
  kind: string,
  nodeId: string,
  functionIdForLabel: string,
  edgeId: string,
  status: GraphStep['status'],
  label: string,
  sourceFile: ts.SourceFile,
  node: ts.Node
) {
  graphSteps.push({
    id: `step.${String(graphSteps.length + 1).padStart(3, '0')}`,
    kind,
    nodeId,
    edgeId,
    status,
    label: `${label} (${functionIdForLabel})`,
    source: sourceLocation(sourceFile, node),
    certainty: certaintyForOperation(kind),
    evidenceRefs: evidenceFor('step', kind, sourceLocation(sourceFile, node)),
    unknownReasons: unknownReasonsForOperation(kind)
  });
}

function functionId(record: FunctionRecord) {
  return `function.${record.name}`;
}

function stableNodeId(type: string, scope: string, label: string) {
  return `${type}.${slug(scope)}.${slug(label).slice(0, 48)}`;
}

function sourceLocation(sourceFile: ts.SourceFile, node: ts.Node, symbol?: string): SourceLocation {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: toDisplayPath(path.relative(projectRoot, sourceFile.fileName)),
    line: position.line + 1,
    column: position.character + 1,
    symbol
  };
}

function certaintyForNode(node: GraphNode): Certainty {
  if (node.type === 'table') {
    return {
      reachability: 'exact_static',
      entityIdentity: 'exact_static',
      fieldPatch: node.operations?.some(isWriteOperation) ? 'approximate' : 'unknown',
      sourceAnchor: node.source ? 'exact_static' : 'unknown'
    };
  }

  if (node.type === 'external') {
    return {
      reachability: 'exact_static',
      entityIdentity: 'approximate',
      fieldPatch: 'unknown',
      sourceAnchor: node.source ? 'exact_static' : 'unknown'
    };
  }

  return {
    reachability: 'exact_static',
    entityIdentity: 'exact_static',
    fieldPatch: node.type === 'condition' || node.type === 'exception' ? 'unknown' : 'approximate',
    sourceAnchor: node.source ? 'exact_static' : 'unknown'
  };
}

function certaintyForOperation(operation: string): Certainty {
  if (operation.startsWith('db.write') || ['create', 'update', 'delete', 'upsert'].includes(operation)) {
    return {
      reachability: 'exact_static',
      entityIdentity: 'exact_static',
      fieldPatch: 'approximate',
      sourceAnchor: 'exact_static'
    };
  }

  if (operation === 'read' || operation.startsWith('db.read')) {
    return {
      reachability: 'exact_static',
      entityIdentity: 'exact_static',
      fieldPatch: 'unknown',
      sourceAnchor: 'exact_static'
    };
  }

  if (operation === 'external_call' || operation.startsWith('external.')) {
    return {
      reachability: 'exact_static',
      entityIdentity: 'approximate',
      fieldPatch: 'unknown',
      sourceAnchor: 'exact_static'
    };
  }

  return {
    reachability: 'exact_static',
    entityIdentity: 'approximate',
    fieldPatch: 'unknown',
    sourceAnchor: 'exact_static'
  };
}

function evidenceFor(scope: 'node' | 'edge' | 'step', rule: string, source: SourceLocation | undefined): EvidenceRef[] {
  const evidence: EvidenceRef[] = [
    {
      id: `evidence.${scope}.${slug(rule)}.static-rule`,
      kind: 'static_rule',
      label: staticRuleLabel(rule),
      note: 'Generated by bounded endpoint static slicing.'
    }
  ];

  if (source) {
    evidence.push({
      id: `evidence.${scope}.${slug(rule)}.source.${source.line}`,
      kind: 'source',
      label: `${source.file}:${source.line}`,
      source
    });
  } else {
    evidence.push({
      id: `evidence.${scope}.${slug(rule)}.unknown-source`,
      kind: 'unknown',
      label: 'No source anchor available',
      note: 'Review manually before trusting this item.'
    });
  }

  return evidence;
}

function unknownReasonsForNode(node: GraphNode) {
  const reasons: string[] = [];

  if (!node.source) {
    reasons.push('missing_source_anchor');
  }

  if (node.type === 'table' && node.operations?.some(isWriteOperation)) {
    reasons.push('field_patch_static_only');
  }

  if (node.type === 'external') {
    reasons.push('external_payload_not_traced');
  }

  return reasons;
}

function unknownReasonsForOperation(operation: string) {
  if (operation.startsWith('db.write') || ['create', 'update', 'delete', 'upsert'].includes(operation)) {
    return ['field_patch_static_only'];
  }

  if (operation === 'external_call' || operation.startsWith('external.')) {
    return ['external_payload_not_traced'];
  }

  if (operation === 'read' || operation.startsWith('db.read')) {
    return ['read_value_not_projected'];
  }

  return [];
}

function staticRuleLabel(rule: string) {
  if (rule === 'entry') {
    return 'Express route registration';
  }

  if (rule === 'table' || rule.startsWith('db.')) {
    return 'Prisma model operation';
  }

  if (rule === 'condition' || rule === 'branch' || rule.startsWith('branch.')) {
    return 'TypeScript if statement';
  }

  if (rule === 'exception' || rule === 'throw' || rule.startsWith('exception.')) {
    return 'TypeScript throw statement';
  }

  if (rule === 'external' || rule === 'external_call' || rule.startsWith('external.')) {
    return 'Imported external module call';
  }

  if (rule === 'transaction' || rule === 'transaction_enter') {
    return 'Prisma transaction call';
  }

  return `Static rule: ${rule}`;
}

function buildSourceManifest(graph: Graph): SourceManifest {
  const sources = collectSources(graph);
  const manifest: SourceManifest = {};

  for (const source of sources) {
    const absoluteFile = path.join(projectRoot, source.file);
    const index = fileIndexes.get(normalizePath(absoluteFile));
    if (!index) {
      continue;
    }

    const lines = index.sourceFile.getFullText().split(/\r?\n/);
    const start = Math.max(1, source.line - 7);
    const end = Math.min(lines.length, source.line + 7);

    manifest[`${source.file}:${source.line}`] = {
      file: source.file,
      lines: lines.slice(start - 1, end).map((text, offset) => ({
        number: start + offset,
        text
      }))
    };
  }

  return manifest;
}

function collectSources(graph: Graph) {
  const sourceMap = new Map<string, SourceLocation>();
  const addSource = (source: SourceLocation | undefined) => {
    if (!source) {
      return;
    }

    sourceMap.set(`${source.file}:${source.line}`, source);
  };

  addSource(graph.entry.source);
  graph.nodes.forEach((node) => addSource(node.source));
  graph.edges.forEach((edge) => addSource(edge.source));
  graph.steps.forEach((step) => addSource(step.source));

  return Array.from(sourceMap.values());
}

function resolveImportPath(fromFile: string, moduleText: string) {
  if (!moduleText.startsWith('.')) {
    return moduleText;
  }

  const raw = path.resolve(path.dirname(fromFile), moduleText);
  const withoutJs = raw.endsWith('.js') ? raw.slice(0, -3) : raw;
  return normalizePath(`${withoutJs}.ts`);
}

function hasExportModifier(node: ts.Node) {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function visit(node: ts.Node | undefined, visitor: (node: ts.Node) => void) {
  if (!node) {
    return;
  }

  visitor(node);
  ts.forEachChild(node, (child) => visit(child, visitor));
}

function isWriteOperation(operation: string) {
  return ['create', 'update', 'delete', 'upsert'].includes(operation);
}

function slug(value: string) {
  return value
    .replace(/\\/g, '/')
    .replace(/[^a-zA-Z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .toLowerCase();
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function normalizePath(file: string) {
  return path.normalize(file);
}

function toDisplayPath(file: string) {
  return file.replace(/\\/g, '/');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
