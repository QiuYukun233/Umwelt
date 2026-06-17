import type { SourceLocation } from './reviewAssistant.js';
import sourceManifestText from '../../graph-output/order-confirm.sources.json?raw';

export type SourceManifestLine = {
  number: number;
  text: string;
};

export type SourcePreview = {
  file: string;
  targetLine: number;
  lines: SourceManifestLine[];
};

type SourceManifest = Record<
  string,
  {
    file: string;
    lines: SourceManifestLine[];
  }
>;

const sourceManifest = JSON.parse(sourceManifestText) as SourceManifest;

export function getSourcePreview(source: SourceLocation | undefined): SourcePreview | undefined {
  if (!source) {
    return undefined;
  }

  const entry = sourceManifest[`${source.file}:${source.line}`];
  if (!entry) {
    return undefined;
  }

  return {
    file: entry.file,
    targetLine: source.line,
    lines: entry.lines
  };
}
