/// <reference path="../pb_data/types.d.ts" />

// Replaces schedules.positions (a plain headcount) with a relation to the
// named "positions" collection - the set of posts this generation batch
// covers (DESIGN.md v3 named-positions extension; see scheduler.js).
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('schedules');
    const positions = app.findCollectionByNameOrId('positions');

    collection.fields.removeByName('positions');
    collection.fields.add(
      new RelationField({
        name: 'positions',
        required: true,
        collectionId: positions.id,
        minSelect: 1,
        maxSelect: 20,
      }),
    );

    return app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId('schedules');

    collection.fields.removeByName('positions');
    collection.fields.add(
      new NumberField({
        name: 'positions',
        required: true,
        onlyInt: true,
        min: 1,
      }),
    );

    return app.save(collection);
  },
);
