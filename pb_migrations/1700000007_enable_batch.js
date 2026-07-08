/// <reference path="../pb_data/types.d.ts" />

// Generate.jsx bulk-creates shift records via pb.createBatch() so a schedule
// save is atomic (frontend/src/pages/Generate.jsx) - PocketBase's batch API
// is disabled by default, which 403'd every "Generate > Save" ("Batch
// requests are not allowed.") until this migration enabled it.
migrate(
  (app) => {
    const settings = app.settings();
    settings.batch.enabled = true;
    return app.save(settings);
  },
  (app) => {
    const settings = app.settings();
    settings.batch.enabled = false;
    return app.save(settings);
  },
);
