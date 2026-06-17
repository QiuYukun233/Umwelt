import type { GraphStep } from './reviewAssistant.js';

export type DemoRow = {
  table: string;
  record: string;
  field: string;
  before: string;
  patch: string;
  after: string;
  state: 'unchanged' | 'read' | 'checked' | 'changed' | 'inserted' | 'failed' | 'omitted' | 'unknown';
  current?: boolean;
  activeLanes?: Array<'before' | 'patch' | 'after'>;
};

export type DemoCellRef = {
  table: string;
  record: string;
  field: string;
  lane: 'before' | 'patch' | 'after' | 'external';
  label: string;
};

export type DemoTrace = {
  from: DemoCellRef;
  process: string;
  to: DemoCellRef;
  note: string;
};

export type DemoSnapshot = {
  phase: string;
  packet: string;
  note: string;
  rows: DemoRow[];
  traces: DemoTrace[];
};

const baseRows: DemoRow[] = [
  {
    table: 'orders',
    record: 'order #1',
    field: 'status',
    before: 'PENDING',
    patch: 'unchanged',
    after: 'PENDING',
    state: 'unchanged'
  },
  {
    table: 'orders',
    record: 'order #1',
    field: 'confirmedAt',
    before: 'null',
    patch: 'unchanged',
    after: 'null',
    state: 'unchanged'
  },
  {
    table: 'inventory',
    record: 'sku-widget',
    field: 'quantity',
    before: '12',
    patch: 'unchanged',
    after: '12',
    state: 'unchanged'
  },
  {
    table: 'inventory',
    record: 'sku-cable',
    field: 'quantity',
    before: '2',
    patch: 'unchanged',
    after: '2',
    state: 'unchanged'
  },
  {
    table: 'payment_logs',
    record: 'new row',
    field: 'status',
    before: 'omitted',
    patch: 'omitted',
    after: 'omitted',
    state: 'omitted'
  }
];

export function getDemoSnapshot(activeStepIndex: number, activeStep: GraphStep | undefined): DemoSnapshot {
  const rows = baseRows.map((row) => ({ ...row }));
  const stepNumber = activeStepIndex + 1;

  if (!activeStep) {
    return {
      phase: 'Waiting',
      packet: 'POST /orders/1/confirm',
      note: 'No replay step is selected.',
      rows,
      traces: []
    };
  }

  if (stepNumber <= 15) {
    return {
      phase: activeStep.status === 'failed' ? 'Rejected path' : 'Guard check',
      packet: 'request body -> confirmOrder(input)',
      note:
        activeStep.status === 'failed'
          ? 'This theoretical path rejects the request before the successful write path continues.'
          : 'The service is checking whether this request is allowed to continue.',
      rows: rows.map((row) => ({
        ...row,
        state: activeStep.status === 'failed' && row.table === 'orders' ? 'failed' : row.state
      })),
      traces: tracesForStep(stepNumber)
    };
  }

  if (stepNumber >= 16) {
    markRows(rows, ['orders'], 'read');
  }

  if (stepNumber >= 17) {
    markRows(rows, ['inventory'], 'read');
  }

  if (stepNumber >= 18) {
    rows.push({
      table: 'external',
      record: 'mock-pay',
      field: 'authorization',
      before: 'not requested',
      patch: '+ request authorization',
      after: 'AUTHORIZED',
      state: 'checked'
    });
  }

  if (stepNumber === 19) {
    updateRow(rows, 'payment_logs', 'status', 'omitted', '+ FAILED', 'FAILED', 'failed');
  }

  if (stepNumber >= 20) {
    updateRow(rows, 'inventory', 'quantity', '12', '-2', '10', 'changed', 'sku-widget');
    updateRow(rows, 'inventory', 'quantity', '2', '-1', '1', 'changed', 'sku-cable');
  }

  if (stepNumber >= 21) {
    updateRow(rows, 'payment_logs', 'status', 'omitted', '+ AUTHORIZED', 'AUTHORIZED', 'inserted');
  }

  if (stepNumber >= 22) {
    updateRow(rows, 'orders', 'status', 'PENDING', '-> CONFIRMED', 'CONFIRMED', 'changed', 'order #1');
    updateRow(rows, 'orders', 'confirmedAt', 'null', '+ now()', 'now()', 'changed', 'order #1');
  }

  return {
    phase: phaseForStep(stepNumber, activeStep),
    packet: packetForStep(stepNumber),
    note: noteForStep(stepNumber, activeStep),
    rows: markCurrentRows(rows, stepNumber),
    traces: tracesForStep(stepNumber)
  };
}

function phaseForStep(stepNumber: number, step: GraphStep) {
  if (stepNumber === 16) {
    return 'Read order';
  }

  if (stepNumber === 17) {
    return 'Read inventory';
  }

  if (stepNumber === 18) {
    return 'External authorization';
  }

  if (stepNumber === 19) {
    return 'Failure write path';
  }

  if (stepNumber === 20) {
    return 'Update inventory';
  }

  if (stepNumber === 21) {
    return 'Insert payment log';
  }

  if (stepNumber >= 22) {
    return 'Confirm order';
  }

  return step.kind;
}

function packetForStep(stepNumber: number) {
  if (stepNumber <= 15) {
    return 'request -> validation guards';
  }

  if (stepNumber === 16) {
    return 'orderId -> orders row';
  }

  if (stepNumber === 17) {
    return 'order.items.sku[] -> inventory rows';
  }

  if (stepNumber === 18) {
    return 'order.totalCents -> mock payment API';
  }

  if (stepNumber === 19) {
    return 'payment failure -> payment_logs row';
  }

  if (stepNumber === 20) {
    return 'order.items.quantity -> inventory decrement';
  }

  if (stepNumber === 21) {
    return 'authorization -> payment_logs row';
  }

  return 'confirmed result -> orders row';
}

function noteForStep(stepNumber: number, step: GraphStep) {
  if (stepNumber === 19) {
    return 'This is the payment-failure branch detected statically; successful replay continues through the authorized log.';
  }

  if (step.status === 'risky') {
    return 'The packet leaves local database logic and depends on an external provider.';
  }

  if (stepNumber >= 20) {
    return 'The table below now shows concrete before/after edits caused by this endpoint.';
  }

  return step.label;
}

function markRows(rows: DemoRow[], tables: string[], state: DemoRow['state']) {
  for (const row of rows) {
    if (tables.includes(row.table)) {
      row.state = state;
    }
  }
}

function updateRow(
  rows: DemoRow[],
  table: string,
  field: string,
  before: string,
  patch: string,
  after: string,
  state: DemoRow['state'],
  record?: string
) {
  const row = rows.find(
    (candidate) => candidate.table === table && candidate.field === field && (!record || candidate.record === record)
  );

  if (row) {
    row.before = before;
    row.patch = patch;
    row.after = after;
    row.state = state;
  }
}

function markCurrentRows(rows: DemoRow[], stepNumber: number) {
  const currentCells = currentCellsForStep(stepNumber);

  return rows.map((row) => ({
    ...row,
    current: currentCells.some(
      (current) =>
        row.table === current.table &&
        (!current.record || row.record === current.record) &&
        (!current.field || row.field === current.field)
    ),
    activeLanes: currentCells
      .filter(
        (current) =>
          row.table === current.table &&
          (!current.record || row.record === current.record) &&
          (!current.field || row.field === current.field)
      )
      .map((current) => current.lane)
  }));
}

function currentCellsForStep(stepNumber: number): Array<{
  table: string;
  record?: string;
  field?: string;
  lane: 'before' | 'patch' | 'after';
}> {
  if (stepNumber === 16) {
    return [{ table: 'orders', record: 'order #1', field: 'status', lane: 'before' }];
  }

  if (stepNumber === 17) {
    return [
      { table: 'inventory', record: 'sku-widget', field: 'quantity', lane: 'before' },
      { table: 'inventory', record: 'sku-cable', field: 'quantity', lane: 'before' }
    ];
  }

  if (stepNumber === 18) {
    return [{ table: 'external', record: 'mock-pay', field: 'authorization', lane: 'after' }];
  }

  if (stepNumber === 19) {
    return [{ table: 'payment_logs', record: 'new row', field: 'status', lane: 'after' }];
  }

  if (stepNumber === 20) {
    return [
      { table: 'inventory', record: 'sku-widget', field: 'quantity', lane: 'patch' },
      { table: 'inventory', record: 'sku-widget', field: 'quantity', lane: 'after' },
      { table: 'inventory', record: 'sku-cable', field: 'quantity', lane: 'patch' },
      { table: 'inventory', record: 'sku-cable', field: 'quantity', lane: 'after' }
    ];
  }

  if (stepNumber === 21) {
    return [
      { table: 'external', record: 'mock-pay', field: 'authorization', lane: 'after' },
      { table: 'payment_logs', record: 'new row', field: 'status', lane: 'after' }
    ];
  }

  if (stepNumber >= 22) {
    return [
      { table: 'orders', record: 'order #1', field: 'status', lane: 'patch' },
      { table: 'orders', record: 'order #1', field: 'status', lane: 'after' },
      { table: 'orders', record: 'order #1', field: 'confirmedAt', lane: 'patch' },
      { table: 'orders', record: 'order #1', field: 'confirmedAt', lane: 'after' }
    ];
  }

  return [];
}

function tracesForStep(stepNumber: number): DemoTrace[] {
  if (stepNumber === 16) {
    return [
      trace(
        cell('request', 'params', 'orderId', 'external', '1'),
        'lookup order by id',
        cell('orders', 'order #1', 'status', 'before', 'PENDING'),
        'The request selects the order row that later receives the confirmation update.'
      )
    ];
  }

  if (stepNumber === 17) {
    return [
      trace(
        cell('orders', 'order #1', 'items', 'external', 'sku-widget x2'),
        'match sku and read stock',
        cell('inventory', 'sku-widget', 'quantity', 'before', '12'),
        'Order items drive which inventory rows are checked.'
      ),
      trace(
        cell('orders', 'order #1', 'items', 'external', 'sku-cable x1'),
        'match sku and read stock',
        cell('inventory', 'sku-cable', 'quantity', 'before', '2'),
        'Each order item maps to an inventory row.'
      )
    ];
  }

  if (stepNumber === 18) {
    return [
      trace(
        cell('orders', 'order #1', 'totalCents', 'external', 'calculated total'),
        'authorize payment',
        cell('external', 'mock-pay', 'authorization', 'after', 'AUTHORIZED'),
        'Payment authorization becomes the signal for later payment log insertion.'
      )
    ];
  }

  if (stepNumber === 19) {
    return [
      trace(
        cell('external', 'mock-pay', 'authorization', 'external', 'FAILED'),
        'record failure branch',
        cell('payment_logs', 'new row', 'status', 'after', 'FAILED'),
        'The static failure path writes a failed payment log instead of confirming the order.'
      )
    ];
  }

  if (stepNumber === 20) {
    return [
      trace(
        cell('inventory', 'sku-widget', 'quantity', 'before', '12'),
        'subtract ordered quantity 2',
        cell('inventory', 'sku-widget', 'quantity', 'after', '10'),
        'The same inventory cell is transformed by the decrement patch.'
      ),
      trace(
        cell('inventory', 'sku-cable', 'quantity', 'before', '2'),
        'subtract ordered quantity 1',
        cell('inventory', 'sku-cable', 'quantity', 'after', '1'),
        'The second item is decremented in the same write step.'
      )
    ];
  }

  if (stepNumber === 21) {
    return [
      trace(
        cell('external', 'mock-pay', 'authorization', 'after', 'AUTHORIZED'),
        'insert payment audit row',
        cell('payment_logs', 'new row', 'status', 'after', 'AUTHORIZED'),
        'External authorization is copied into the payment log table.'
      )
    ];
  }

  if (stepNumber >= 22) {
    return [
      trace(
        cell('orders', 'order #1', 'status', 'before', 'PENDING'),
        'mark confirmed',
        cell('orders', 'order #1', 'status', 'after', 'CONFIRMED'),
        'The order status cell is rewritten after inventory and payment succeed.'
      ),
      trace(
        cell('system', 'clock', 'now()', 'external', 'current time'),
        'stamp confirmation time',
        cell('orders', 'order #1', 'confirmedAt', 'after', 'now()'),
        'The endpoint writes a confirmation timestamp.'
      )
    ];
  }

  return [];
}

function trace(from: DemoCellRef, process: string, to: DemoCellRef, note: string): DemoTrace {
  return { from, process, to, note };
}

function cell(
  table: string,
  record: string,
  field: string,
  lane: DemoCellRef['lane'],
  label: string
): DemoCellRef {
  return { table, record, field, lane, label };
}
