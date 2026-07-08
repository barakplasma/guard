/// <reference path="../pb_data/types.d.ts" />

// The only pb_hooks usage that touches another collection (DESIGN.md section
// 3.4): when a swap_request transitions to "accepted" - and only the
// recipient (to_user) can make that transition - replace from_user with
// to_user on the target shift. Runs with full app access (bypasses the
// `shifts` update rule, which stays commander-only for everything else).
onRecordUpdateRequest((e) => {
  const wasAccepted = e.record.original().get('status') === 'accepted';
  const isAccepted = e.record.get('status') === 'accepted';

  if (!wasAccepted && isAccepted) {
    const toUser = e.record.get('to_user');
    const fromUser = e.record.get('from_user');

    if (!e.auth || e.auth.id !== toUser) {
      throw new ForbiddenError('Only the recipient of a swap request can accept it.');
    }

    const shift = e.app.findRecordById('shifts', e.record.get('shift'));
    const guardIds = shift.get('guards');

    if (!guardIds.includes(fromUser)) {
      throw new BadRequestError('from_user is no longer assigned to this shift.');
    }
    if (guardIds.includes(toUser)) {
      throw new BadRequestError('to_user is already assigned to this shift.');
    }

    shift.set('guards-', fromUser);
    shift.set('guards+', toUser);
    e.app.save(shift);
  }

  e.next();
}, 'swap_requests');
