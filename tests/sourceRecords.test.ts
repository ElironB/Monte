import { describe, expect, test } from 'vitest';
import { deriveAggregateStatus } from '../src/ingestion/sourceRecords.js';

describe('source aggregate status derivation', () => {
  test('stays processing until upload completes and all files settle', () => {
    expect(deriveAggregateStatus({
      expectedFileCount: 3,
      uploadComplete: false,
      uploadedFileCount: 2,
      pendingFileCount: 1,
      processingFileCount: 0,
      completedFileCount: 1,
      skippedFileCount: 0,
      failedFileCount: 0,
    })).toBe('processing');
  });

  test('marks fully successful imports as completed', () => {
    expect(deriveAggregateStatus({
      expectedFileCount: 2,
      uploadComplete: true,
      uploadedFileCount: 2,
      pendingFileCount: 0,
      processingFileCount: 0,
      completedFileCount: 2,
      skippedFileCount: 0,
      failedFileCount: 0,
    })).toBe('completed');
  });

  test('marks mixed terminal outcomes as partial', () => {
    expect(deriveAggregateStatus({
      expectedFileCount: 3,
      uploadComplete: true,
      uploadedFileCount: 3,
      pendingFileCount: 0,
      processingFileCount: 0,
      completedFileCount: 1,
      skippedFileCount: 1,
      failedFileCount: 1,
    })).toBe('partial');
  });

  test('marks fully failed imports as failed', () => {
    expect(deriveAggregateStatus({
      expectedFileCount: 2,
      uploadComplete: true,
      uploadedFileCount: 2,
      pendingFileCount: 0,
      processingFileCount: 0,
      completedFileCount: 0,
      skippedFileCount: 0,
      failedFileCount: 2,
    })).toBe('failed');
  });

  test('marks fully skipped imports as completed instead of failed', () => {
    expect(deriveAggregateStatus({
      expectedFileCount: 2,
      uploadComplete: true,
      uploadedFileCount: 2,
      pendingFileCount: 0,
      processingFileCount: 0,
      completedFileCount: 0,
      skippedFileCount: 2,
      failedFileCount: 0,
    })).toBe('completed');
  });

  test('marks skipped plus failed imports as partial when not every file failed', () => {
    expect(deriveAggregateStatus({
      expectedFileCount: 2,
      uploadComplete: true,
      uploadedFileCount: 2,
      pendingFileCount: 0,
      processingFileCount: 0,
      completedFileCount: 0,
      skippedFileCount: 1,
      failedFileCount: 1,
    })).toBe('partial');
  });
});
