import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDate, integerFormatter, titleCase } from '../lib/formatters';
import { EmptyState, ErrorPanel, LoadingPanel, MetricCard, Panel, StatusPill } from '../components/Ui';

export function SourcesPage() {
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const sourcesQuery = useQuery({
    queryKey: ['sources', 'details'],
    queryFn: () => api.getSources({ limit: 24 }),
  });

  const defaultSourceId = selectedSourceId ?? sourcesQuery.data?.data[0]?.id ?? null;

  const sourceDetailQuery = useQuery({
    queryKey: ['source', defaultSourceId],
    queryFn: () => api.getSource(defaultSourceId!),
    enabled: Boolean(defaultSourceId),
  });

  if (sourcesQuery.isLoading || sourceDetailQuery.isLoading) {
    return <LoadingPanel label="Loading data sources and signal previews..." />;
  }

  if (sourcesQuery.error || sourceDetailQuery.error) {
    return <ErrorPanel message={(sourcesQuery.error as Error | undefined)?.message ?? (sourceDetailQuery.error as Error | undefined)?.message ?? 'Unknown error'} />;
  }

  if (!sourcesQuery.data?.data.length) {
    return <EmptyState title="No sources ingested yet" body="Once ingestion starts, this page becomes the observation browser." />;
  }

  const totalSignals = sourcesQuery.data.data.reduce((sum, source) => sum + source.signalCount, 0);
  const totalFiles = sourcesQuery.data.data.reduce((sum, source) => sum + source.fileCount, 0);
  const completedSources = sourcesQuery.data.data.filter((source) => source.status === 'completed').length;
  const activeSource = sourceDetailQuery.data ?? null;

  return (
    <div className="page-grid">
      <div className="metrics-grid">
        <MetricCard label="Registered sources" value={integerFormatter.format(sourcesQuery.data.pagination.total)} tone="accent" />
        <MetricCard label="Completed sources" value={integerFormatter.format(completedSources)} tone="success" />
        <MetricCard label="Queued files" value={integerFormatter.format(totalFiles)} tone="accent" />
        <MetricCard label="Observed signals" value={integerFormatter.format(totalSignals)} tone="warm" />
      </div>

      <div className="two-column-grid sources-layout">
        <Panel title="Source inventory" eyebrow="Ingestion layer">
          <div className="source-list">
            {sourcesQuery.data.data.map((source) => (
              <button
                type="button"
                key={source.id}
                className={`source-list__item source-list__item--button${defaultSourceId === source.id ? ' source-list__item--selected' : ''}`}
                onClick={() => setSelectedSourceId(source.id)}
              >
                <div>
                  <strong>{source.name}</strong>
                  <p>{titleCase(source.sourceType)}</p>
                </div>
                <div className="source-list__meta">
                  <StatusPill value={source.status} />
                  <span>{integerFormatter.format(source.fileCount)} files</span>
                  <span>{integerFormatter.format(source.signalCount)} signals</span>
                </div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel className="sources-detail-panel" title={activeSource?.name ?? 'Source detail'} eyebrow="Signal preview">
          {activeSource ? (
            <div className="stack sources-detail-body">
              <div className="pill-list source-preview__meta">
                <span className="inline-pill">{titleCase(activeSource.sourceType)}</span>
                <span className="inline-pill">{formatDate(activeSource.createdAt)}</span>
                <span className="inline-pill">{integerFormatter.format(activeSource.fileCount)} files</span>
                <span className="inline-pill">{integerFormatter.format(activeSource.signalCount)} signals</span>
              </div>
              <div className="pill-list source-preview__meta">
                <span className="inline-pill">done {integerFormatter.format(activeSource.completedFileCount)}</span>
                <span className="inline-pill">processing {integerFormatter.format(activeSource.processingFileCount)}</span>
                <span className="inline-pill">skipped {integerFormatter.format(activeSource.skippedFileCount)}</span>
                <span className="inline-pill">failed {integerFormatter.format(activeSource.failedFileCount)}</span>
              </div>
              {activeSource.files.length ? (
                <Panel title="Imported files" eyebrow="Per-file status">
                  <div className="signal-list">
                    {activeSource.files.map((file) => (
                      <article key={file.id} className="signal-card">
                        <div className="signal-card__header">
                          <strong>{file.originalPath ?? file.filename}</strong>
                          <span>{titleCase(file.status)}</span>
                        </div>
                        <p>{titleCase(file.detectedSourceType)} · {integerFormatter.format(file.signalCount)} signals</p>
                        <span>{file.skipReason ?? file.error ?? file.mimetype}</span>
                      </article>
                    ))}
                  </div>
                </Panel>
              ) : null}
              {activeSource.signals.length ? (
                <div className="signal-list">
                  {activeSource.signals.map((signal) => (
                    <article key={signal.id} className="signal-card">
                      <div className="signal-card__header">
                        <strong>{signal.type}</strong>
                        <span>{Math.round(signal.confidence * 100)}%</span>
                      </div>
                      <p>{signal.value}</p>
                      <span>{signal.evidence}</span>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState title="No signal preview available" body="Completed sources surface their first 50 signals here." />
              )}
            </div>
          ) : (
            <EmptyState title="Select a source" body="Pick a data source from the list to inspect its observed signals." />
          )}
        </Panel>
      </div>
    </div>
  );
}
