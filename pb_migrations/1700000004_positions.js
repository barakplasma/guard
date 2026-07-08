/// <reference path="../pb_data/types.d.ts" />

// "positions" - named guard posts a commander defines once and reuses across
// schedule generations (e.g. "דרומי", "ש''ג"). A position can be
// time-restricted (window_start/window_end, "HH:MM" 24h, e.g. a patrol only
// staffed 22:00-06:00) - see scheduler/scheduler.js for how the window is
// applied per generated slot. `active` lets a retired position stay attached
// to historical shifts without showing up as selectable in new generations.
migrate(
  (app) => {
    const collection = new Collection({
      type: 'base',
      name: 'positions',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.role = 'commander'",
      updateRule: "@request.auth.role = 'commander'",
      deleteRule: "@request.auth.role = 'commander'",
      fields: [
        { name: 'name', type: 'text', required: true, min: 1, max: 100 },
        { name: 'time_restricted', type: 'bool' },
        { name: 'window_start', type: 'text', max: 5 },
        { name: 'window_end', type: 'text', max: 5 },
        { name: 'active', type: 'bool' },
      ],
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('positions');
    return app.delete(collection);
  },
);
