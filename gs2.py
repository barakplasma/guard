from datetime import datetime, timedelta
from typing import List, Dict
from argparse import ArgumentParser
from pydantic import BaseModel, validator
from pathlib import Path
import csv
import heapq
import random
import pprint
import statistics

class Shift(BaseModel):
    start: datetime
    end: datetime
    guards: List[str]

    def __str__(self):
        dfo = '%d/%m %H:%M'
        return f"{self.start.strftime(dfo)} - {self.end.strftime(dfo)} | {', '.join(self.guards)}"

    @validator('end')
    def end_must_be_after_start(cls, v, values):
        assert 'start' in values, 'start time must be provided before end time'
        assert v > values['start'], 'end time must be after start time'
        return v

def compute_stats(shifts: List[Shift]):
    """
    Computes and prints statistics about guard shifts.

    Args:
        shifts: List of Shift objects.

    Returns:
        None

    Doctest:
    >>> shifts = [
    ...     Shift(start=datetime(2023, 10, 1, 9), end=datetime(2023, 10, 1, 17), guards=['Alice']),
    ...     Shift(start=datetime(2023, 10, 1, 17), end=datetime(2023, 10, 1, 21), guards=['Bob'])
    ... ]
    >>> compute_stats(shifts)
    Hours for each guard:
    [(4.0, 'Bob'), (8.0, 'Alice')]
    Population variance for guard shifts:
    8.0
    """
    total_hours: Dict[str, float] = {}
    for shift in shifts:
        duration_hours = (shift.end - shift.start).total_seconds() / 3600
        for guard in shift.guards:
            total_hours[guard] = total_hours.get(guard, 0) + duration_hours
    sorted_stats = sorted([(hours, guard) for guard, hours in total_hours.items()])
    print("Hours for each guard:")
    pprint.pprint(sorted_stats)
    if len(sorted_stats) > 1:
        vari = statistics.pvariance([s[0] for s in sorted_stats])
        print("Population variance for guard shifts:")
        print(round(vari, 3))
    else:
        print("Not enough data to compute variance.")

def validate_guard_list(guards: List[str]):
    """
    Validates the list of guards.

    Args:
        guards: List of guard names.

    Returns:
        The validated list of guards.

    Raises:
        AssertionError: If the guard list is invalid.

    Doctest:
    >>> validate_guard_list(['Alice', 'Bob', 'Carol'])
    ['Alice', 'Bob', 'Carol']
    >>> validate_guard_list([])
    Traceback (most recent call last):
    ...
    AssertionError: At least one guard must be specified.
    >>> validate_guard_list(['Alice', 'Bob', 'Alice'])
    Traceback (most recent call last):
    ...
    AssertionError: Guard names must be unique.
    """
    assert len(guards) > 0, "At least one guard must be specified."
    unique_guards = set(guards)
    assert len(unique_guards) == len(guards), "Guard names must be unique."
    return guards

def main():
    parser = ArgumentParser(description='Generates guard shift schedules')
    parser.add_argument('start', nargs='?', type=lambda s: datetime.fromisoformat(s), help='Start time for schedule')
    parser.add_argument('end', nargs='?', type=lambda s: datetime.fromisoformat(s), help='End time for schedule')
    parser.add_argument('length', nargs='?', type=int, help='Length of each shift in minutes')
    parser.add_argument('positions', nargs='?', type=int, help='Number of guard positions per shift')
    parser.add_argument('guards', nargs='*', help='List of guards')

    parser.add_argument('--dry_run', action='store_true', help='Dry run without saving to disk')
    parser.add_argument('--seed', type=int, default=None, help='Seed for shuffling guards')
    parser.add_argument('--demo', action='store_true', help='Run the program with demo arguments')

    args = parser.parse_args()

    if args.demo:
        # Demo arguments
        args.start = datetime.now()
        args.end = args.start + timedelta(days=1)
        args.length = 60  # 1 hour shifts
        args.positions = 2
        args.guards = ['Alice', 'Bob', 'Carol']
        args.dry_run = True
        print("Running in demo mode with the following arguments:")
        print(f"Start: {args.start}")
        print(f"End: {args.end}")
        print(f"Length: {args.length} minutes")
        print(f"Positions: {args.positions}")
        print(f"Guards: {args.guards}")
    else:
        # Ensure required arguments are provided
        assert args.start is not None, "Start time is required unless --demo is specified."
        assert args.end is not None, "End time is required unless --demo is specified."
        assert args.length is not None, "Shift length is required unless --demo is specified."
        assert args.positions is not None, "Number of positions is required unless --demo is specified."
        validate_guard_list(args.guards)

    assert args.start < args.end, "Start time must be before end time."
    assert args.length > 0, "Shift length must be positive."
    assert args.positions > 0, "Number of positions must be positive."
    validate_guard_list(args.guards)

    if args.seed is not None:
        random.seed(args.seed)
        print(f"Seed: {args.seed}")

    # Read existing schedule if it exists
    shifts: List[Shift] = []
    schedule_file = Path('schedule.csv')
    if schedule_file.is_file():
        with schedule_file.open('r', newline='') as csvfile:
            reader = csv.DictReader(csvfile)
            for row in reader:
                shift = Shift(
                    start=datetime.fromisoformat(row['start']),
                    end=datetime.fromisoformat(row['end']),
                    guards=row['guards'].split(',')
                )
                shifts.append(shift)
    shifts.sort(key=lambda s: s.start)

    compute_stats(shifts)

    # Initialize guard availability
    guard_availability: Dict[str, datetime] = {guard: datetime.min for guard in args.guards}
    for shift in shifts:
        for guard in shift.guards:
            if guard in guard_availability:
                guard_availability[guard] = max(guard_availability[guard], shift.end)

    # Initialize priority queue with guard availability
    # Each item in the queue is (next_available_time, guard_name)
    guard_queue = [(guard_availability[guard], guard) for guard in args.guards]
    heapq.heapify(guard_queue)

    # Generate shifts
    current_time = args.start
    shift_length = timedelta(minutes=args.length)
    new_shifts = []

    while current_time < args.end:
        assigned_guards = []
        temp_queue = []
        for _ in range(args.positions):
            if not guard_queue:
                raise Exception("Not enough guards to fill positions")
            next_available_time, guard = heapq.heappop(guard_queue)
            assert next_available_time <= current_time, f"Guard {guard} is not available until {next_available_time}"
            assigned_guards.append(guard)
            # Update guard's next available time to current_time + shift_length
            new_available_time = current_time + shift_length
            temp_queue.append((new_available_time, guard))
            guard_availability[guard] = new_available_time
        # Push updated guards back into the queue
        for item in temp_queue:
            heapq.heappush(guard_queue, item)

        new_shift = Shift(start=current_time, end=current_time + shift_length, guards=assigned_guards)
        new_shifts.append(new_shift)
        current_time += shift_length

    # Combine existing shifts with new shifts
    shifts.extend(new_shifts)
    shifts.sort(key=lambda s: s.start)

    if not args.dry_run:
        with schedule_file.open('w', newline='') as csvfile:
            fieldnames = ['start', 'end', 'guards']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            for shift in shifts:
                writer.writerow({
                    'start': shift.start.isoformat(),
                    'end': shift.end.isoformat(),
                    'guards': ','.join(shift.guards)
                })
    else:
        print("Dry run: The following shifts are scheduled:")
        for shift in shifts:
            print(shift)
        compute_stats(shifts)

if __name__ == '__main__':
    import doctest
    doctest.testmod()
    main()
