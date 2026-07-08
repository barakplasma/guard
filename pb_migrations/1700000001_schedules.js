/// <reference path="../pb_data/types.d.ts" />

// "schedules" - one shift-generation batch (DESIGN.md section 3.2). Grouping
// shifts this way makes preview -> save atomic-ish and lets a commander delete
// a whole batch (its shifts cascade-delete via shifts.schedule).
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    const collection = new Collection({
      type: 'base',
      name: 'schedules',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.role = 'commander'",
      updateRule: "@request.auth.role = 'commander'",
      deleteRule: "@request.auth.role = 'commander'",
      fields: [
        { name: 'start', type: 'date', required: true },
        { name: 'end', type: 'date', required: true },
        { name: 'shift_minutes', type: 'number', required: true, onlyInt: true, min: 1 },
        { name: 'positions', type: 'number', required: true, onlyInt: true, min: 1 },
        {
          name: 'created_by',
          type: 'relation',
          required: true,
          collectionId: users.id,
          maxSelect: 1,
        },
      ],
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('schedules');
    return app.delete(collection);
  },
);
