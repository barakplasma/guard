from datetime import datetime, timedelta
from typing import List, Dict
from argparse import ArgumentParser
from pydantic import BaseModel
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

def compute_stats(shifts: List[Shift]):
    total_hours: Dict[str, float] = {}
    for shift in shifts:
        duration_hours = (shift.end - shift.start).total_seconds() / 3600
        for guard in shift.guards:
            total_hours[guard] = total_hours.get(guard, 0) + duration_hours
    sorted_stats = sorted([(hours, guard) for guard, hours in total_hours.items()])
    print("Hours for each guard:")
    pprint.pprint(sorted_stats)
    if len(sorted_stats) > 0:
        vari = statistics.pvariance([s[0] for s in sorted_stats])
        print("Population variance for guard shifts:")
        print(round(vari, 3))

def main():
    parser = ArgumentParser(description='Generates guard shift schedules')
    parser.add_argument('start', type=lambda s: datetime.fromisoformat(s), help='Start time for schedule')
    parser.add_argument('end', type=lambda s: datetime.fromisoformat(s), help='End time for schedule')
    parser.add_argument('length', type=int, help='Length of each shift in minutes')
    parser.add_argument('positions', type=int, help='Number of guard positions per shift')
    parser.add_argument('guards', nargs="+", help='List of guards')

    parser.add_argument('--dry_run', action='store_true', help='Dry run without saving to disk')
    parser.add_argument('--seed', type=int, default=None, help='Seed for shuffling guards')

    args = parser.parse_args()

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
        for _ in range(args.positions):
            if not guard_queue:
                raise Exception("Not enough guards to fill positions")

            next_available_time, guard = heapq.heappop(guard_queue)
            assigned_guards.append(guard)
            # Update guard's next available time to current_time + shift_length
            new_available_time = current_time + shift_length
            heapq.heappush(guard_queue, (new_available_time, guard))
            guard_availability[guard] = new_available_time

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
        for shift in shifts:
            print(shift)
        compute_stats(shifts)

if __name__ == '__main__':
    main()
