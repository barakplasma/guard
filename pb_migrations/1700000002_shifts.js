/// <reference path="../pb_data/types.d.ts" />

// "shifts" - individual guard shifts (DESIGN.md section 3.3). Deleting a
// schedule cascade-deletes its shifts via the `schedule` relation.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const schedules = app.findCollectionByNameOrId('schedules');

    const collection = new Collection({
      type: 'base',
      name: 'shifts',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: "@request.auth.role = 'commander'",
      // Plain field updates are commander-only; accepted swaps rewrite `guards`
      // server-side via pb_hooks/swaps.pb.js instead of relaxing this rule.
      updateRule: "@request.auth.role = 'commander'",
      deleteRule: "@request.auth.role = 'commander'",
      fields: [
        {
          name: 'schedule',
          type: 'relation',
          required: true,
          collectionId: schedules.id,
          cascadeDelete: true,
          maxSelect: 1,
        },
        { name: 'start', type: 'date', required: true },
        { name: 'end', type: 'date', required: true },
        {
          name: 'guards',
          type: 'relation',
          required: true,
          collectionId: users.id,
          minSelect: 1,
          maxSelect: 20,
        },
      ],
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('shifts');
    return app.delete(collection);
  },
);
