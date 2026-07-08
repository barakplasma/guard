/// <reference path="../pb_data/types.d.ts" />

// "swap_requests" - shift-swap workflow (DESIGN.md section 3.4). The actual
// guard replacement on accept is applied server-side by
// pb_hooks/swaps.pb.js, not by relaxing the `shifts` update rule.
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');
    const shifts = app.findCollectionByNameOrId('shifts');

    const collection = new Collection({
      type: 'base',
      name: 'swap_requests',
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: '@request.auth.id = @request.body.from_user',
      updateRule: '@request.auth.id = from_user || @request.auth.id = to_user',
      deleteRule: '@request.auth.id = from_user',
      fields: [
        {
          name: 'shift',
          type: 'relation',
          required: true,
          collectionId: shifts.id,
          maxSelect: 1,
        },
        {
          name: 'from_user',
          type: 'relation',
          required: true,
          collectionId: users.id,
          maxSelect: 1,
        },
        {
          name: 'to_user',
          type: 'relation',
          required: true,
          collectionId: users.id,
          maxSelect: 1,
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          values: ['pending', 'accepted', 'declined', 'cancelled'],
          maxSelect: 1,
        },
      ],
    });

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('swap_requests');
    return app.delete(collection);
  },
);
