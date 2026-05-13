type JobProcessor = (dbJobId: string) => Promise<unknown>;

export function runJobInBackground(label: string, dbJobId: string, processor: JobProcessor) {
  setImmediate(() => {
    processor(dbJobId).catch((error) => {
      console.error(`[${label}] job ${dbJobId} failed:`, error);
    });
  });
}

export function runJobsInBackground(label: string, dbJobIds: string[], processor: JobProcessor) {
  for (const dbJobId of dbJobIds) {
    runJobInBackground(label, dbJobId, processor);
  }
}
