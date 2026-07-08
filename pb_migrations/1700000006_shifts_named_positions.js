/// <reference path="../pb_data/types.d.ts" />

// Replaces shifts.guards (a multi-relation headcount) with a single `position`
// + single `guard` pair, so each row is one guard filling one named position
// for one time-slot (DESIGN.md v3 named-positions extension; see
// scheduler.js). pb_hooks/swaps.pb.js was updated to match: it now overwrites
// `guard` directly instead of doing relation +/- on `guards`.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('shifts');
    const users = app.findCollectionByNameOrId('users');
    const positions = app.findCollectionByNameOrId('positions');

    collection.fields.removeByName('guards');
    collection.fields.add(
      new RelationField({
        name: 'position',
        required: true,
        collectionId: positions.id,
        maxSelect: 1,
      }),
    );
    collection.fields.add(
      new RelationField({
        name: 'guard',
        required: true,
        collectionId: users.id,
        maxSelect: 1,
      }),
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('shifts');
    const users = app.findCollectionByNameOrId('users');

    collection.fields.removeByName('position');
    collection.fields.removeByName('guard');
    collection.fields.add(
      new RelationField({
        name: 'guards',
        required: true,
        collectionId: users.id,
        minSelect: 1,
        maxSelect: 20,
      }),
    );

    return app.save(collection);
  },
);
