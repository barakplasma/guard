/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const collection = new Collection({
    type: 'base', name: 'roster_notes',
    listRule: "@request.auth.id != ''", viewRule: "@request.auth.id != ''",
    createRule: "@request.auth.role = 'commander'", updateRule: "@request.auth.role = 'commander'",
    deleteRule: "@request.auth.role = 'commander'",
    fields: [
      { name: 'at', type: 'date', required: true },
      { name: 'text', type: 'text', required: true, max: 2000 },
    ],
  });
  return app.save(collection);
}, (app) => app.delete(app.findCollectionByNameOrId('roster_notes')));
