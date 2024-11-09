from datetime import datetime, timedelta
from dataclasses import dataclass
from queue import PriorityQueue
from typing import List
from pickle import dump, load
from pprint import pprint

@dataclass()
class Guard:
    name: str
    guarded: timedelta = timedelta(0)
    last_guard_shift: datetime = datetime(2023,12,2)
    already_guarded: list[(datetime, datetime)] = None
    def add_guard_shift(self, shift_length, end):
        if self.already_guarded is None:
            self.already_guarded = []
        self.guarded += shift_length
        self.last_guard_shift = end
        self.already_guarded.append((end-shift_length, end))
    def __gt__(self,other):
        if self.last_guard_shift > other.last_guard_shift:
            return True
        if self.guarded > other.guarded:
            return True
        else:
            return False

@dataclass()
class CItem:
    start: datetime
    end: datetime
    who: List[Guard]

@dataclass()
class Calendar:
    slots: List[CItem]
    def add(self, start, end, who):
        who = sorted(who,key=lambda w: w.name)
        self.slots.append(CItem(start, end, who))
    def __repr__(self):
        dformat = '%d/%m %H:%M'
        return "\n".join(list(
            map(lambda s: f"{s.start.strftime(dformat)} - {s.end.strftime(dformat)} | {' '.join(map(lambda w: w.name, s.who))}", self.slots)))

@dataclass()
class Roster:
    guards: List[Guard]
    start: datetime = datetime.now()
    shift_length: timedelta = timedelta(hours=1)
    num_positions: int = 2
    cal: Calendar = Calendar([])
    def schedule(self, td):
        current = self.start
        q = PriorityQueue()
        for g in self.guards:
            q.put(g)
        while current - self.start < td:
            end = current+self.shift_length
            sguards=[]
            for _ in range(self.num_positions):
                next_guard = q.get()
                next_guard.add_guard_shift(self.shift_length, end)
                #TODO add code to prevent back to back shifts
                sguards.append(next_guard)
                q.put(next_guard)
            self.cal.add(current, end, sguards)
            current = end
