/// <reference path="../pb_data/types.d.ts" />

// A position may need more than one guard per slot and can optionally be
// limited to a named group (for example, guards qualified for a patrol).
migrate(
  (app) => {
    const positions = app.findCollectionByNameOrId('positions');
    const users = app.findCollectionByNameOrId('users');

    // Add this as optional first so existing positions can be backfilled.
    const peopleCount = new NumberField({
      name: 'people_count',
      onlyInt: true,
      min: 1,
    });
    positions.fields.add(peopleCount);
    positions.fields.add(
      new RelationField({
        name: 'eligible_users',
        collectionId: users.id,
        maxSelect: 100,
      }),
    );
    app.save(positions);

    for (const position of app.findRecordsByFilter(positions, '', '', 0, 0)) {
      position.set('people_count', 1);
      app.save(position);
    }

    peopleCount.required = true;
    return app.save(positions);
  },
  (app) => {
    const positions = app.findCollectionByNameOrId('positions');
    positions.fields.removeByName('people_count');
    positions.fields.removeByName('eligible_users');
    return app.save(positions);
  },
);
